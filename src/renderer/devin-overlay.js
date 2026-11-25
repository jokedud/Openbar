'use strict';
const { cursorTransition, focusStop, DROP_MS, HOLD_MS, FRAME_MS } = window.devinMotion;
const { Otter, ELEVATOR_FRAMES } = window.otterAnimation;
const cursor = document.getElementById('cursor');
const fold = document.getElementById('fold');
const arcs = document.getElementById('arcs');
const ripple = document.getElementById('ripple');
const otter = new Otter(document.getElementById('otter'));
const api = window.openbar;

let data, phase = 'off', phaseAt = 0, workAt = 0, lostAt = -Infinity, caught = false;
let elevator, animation = 0, tick = 0, idleSent = false;
let x = 0, y = 0, vx = 0, vy = 0, tx = 0, ty = 0, previousFrame = 0, landedAt = -Infinity;
let startX = 0, startY = 0;
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(max, min));
const mix = (a, b, t) => a + (b - a) * t;

function target(now) {
  const { x, y, width, height } = data.region;
  const [u, v] = focusStop(now - workAt);
  return [clamp(x + width * u, 13, innerWidth - 52), clamp(y + height * v, 13, innerHeight - 52)];
}

function dockAnchor() {
  const { x, y, width, height, margin, position } = data.dock;
  const scale = position === 'top' ? 2 : 3;
  const right = Math.min(innerWidth - 26 * scale, x + width - margin);
  return {
    left: Math.round(right - 22 * scale),
    floor: Math.round(position === 'top' ? Math.max(21 * scale, y + height - margin) : y + margin + 8),
    scale,
  };
}

function drawCursor(now) {
  animation = 0;
  const elapsed = now - phaseAt;
  const dt = clamp((now - previousFrame) / 1000, 0, .025);
  previousFrame = now;
  let scale, squash, tilt, bob, opacity = 1;
  if (phase === 'work') {
    const [nextX, nextY] = target(now);
    if (nextX !== tx || nextY !== ty) {
      tx = nextX; ty = nextY;
      landedAt = -Infinity;
    }
    vx += ((tx - x) * 125 - vx * 17) * dt;
    vy += ((ty - y) * 125 - vy * 17) * dt;
    x += vx * dt; y += vy * dt;
    if (landedAt === -Infinity && Math.hypot(tx - x, ty - y) < 5 && Math.hypot(vx, vy) < 65) landedAt = now;
    const pulse = clamp((now - landedAt) / 540, 0, 1);
    const arrival = Math.sin(pulse * Math.PI) * .13;
    scale = 1 - arrival;
    squash = 1 + arrival * .55;
    tilt = clamp(vx * .038, -20, 20) + Math.sin(now / 520) * 2;
    bob = Math.sin(now / 360) * 3.5;
    ripple.style.opacity = (1 - pulse) ** 2;
    ripple.style.transform = `scale(${.7 + pulse * 1.8})`;
    arcs.style.transform = `rotate(${now * .065}deg)`;
    arcs.style.opacity = .68 + Math.sin(now / 380) * .3;
  } else if (phase === 'drop') {
    const t = clamp(elapsed / DROP_MS, 0, 1);
    const { left, floor, scale: pixel } = dockAnchor();
    x = mix(startX, left + 8 * pixel, t * t * (3 - 2 * t)) + Math.sin(t * Math.PI) * 44;
    y = mix(startY, floor - 9 * pixel, t ** 2) - Math.sin(t * Math.PI) * 36;
    scale = mix(1, data.otter ? .31 : .45, t * t);
    squash = 1 + t * .2;
    tilt = 20 * Math.sin(Math.PI * t) - t * 14;
    bob = 0;
    opacity = data.otter ? 1 : 1 - t ** 4;
    arcs.style.opacity = 1 - t;
    ripple.style.opacity = 0;
    if (t === 1) {
      phase = 'hold';
      cursor.hidden = true;
      signalIdle();
      return;
    }
  } else return;
  cursor.hidden = false;
  cursor.style.opacity = opacity;
  cursor.style.transform = `translate3d(${x - 9}px,${y + bob - 9}px,0)`;
  fold.style.transform = `rotate(${tilt}deg) scale(${scale},${scale * squash})`;
  animation = requestAnimationFrame(drawCursor);
}

function signalIdle() {
  if (!idleSent && !data.otter && elevator === ELEVATOR_FRAMES && phase !== 'work' && phase !== 'drop') {
    idleSent = true;
    api.send('devin:motion-idle');
  }
}

function drawOtter() {
  tick = 0;
  const elapsed = performance.now() - lostAt;
  const terminal = data.otter ? 0 : ELEVATOR_FRAMES;
  let clip, frame;
  if (elevator !== terminal || !data.otter) {
    clip = 'elevator';
    frame = elevator;
    elevator += Math.sign(terminal - elevator);
  } else if (data.working) clip = 'work';
  else if (caught && elapsed < DROP_MS) { clip = 'catch'; frame = 0; }
  else if (caught && elapsed < DROP_MS + HOLD_MS) {
    clip = 'catch'; frame = 1 + Math.floor((elapsed - DROP_MS) / FRAME_MS) % 7;
  } else if (elapsed < (caught ? DROP_MS + HOLD_MS : 0) + 1000) clip = 'happy';
  else clip = 'idle';
  otter.draw(clip, frame, dockAnchor(), data.otter);
  if (data.otter || frame < ELEVATOR_FRAMES) tick = setTimeout(drawOtter, FRAME_MS);
  else signalIdle();
}

api.on('devin:motion', (next) => {
  const prior = data;
  data = next;
  idleSent = false;
  const now = performance.now();
  if (elevator == null) elevator = next.otter ? 0 : ELEVATOR_FRAMES;
  const leavingWork = prior?.working && !next.working;
  const nextPhase = cursorTransition(next, phase);
  if (leavingWork) {
    lostAt = now;
    caught = nextPhase === 'drop' && next.otter && elevator === 0;
  }
  if (phase !== nextPhase || (nextPhase === 'work' && prior.session !== next.session)) {
    if (nextPhase === 'work') {
      workAt = now;
      landedAt = -Infinity;
      if (phase !== 'work' && phase !== 'drop') {
        const [a, b] = target(now);
        x = a + 44; y = b + 37;
        vx = 0; vy = 0;
      }
    } else if (nextPhase === 'drop') {
      startX = x; startY = y;
    }
    phase = nextPhase;
    phaseAt = now;
  }
  if (phase === 'work' || phase === 'drop') {
    if (!animation) {
      previousFrame = now;
      animation = requestAnimationFrame(drawCursor);
    }
  } else {
    cancelAnimationFrame(animation);
    animation = 0;
    cursor.hidden = true;
  }
  if (!tick) drawOtter();
});
