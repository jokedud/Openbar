'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { Otter, ELEVATOR_FRAMES, elevatorFrame } = require('../src/renderer/otter');
const { palette } = require('../src/renderer/otter-art');

test('the elevator rises at the otter’s perch and stays inside the dock', () => {
  const rects = [];
  let translation = 0;
  const ctx = {
    clearRect() {}, beginPath() {}, rect() {}, clip() {},
    save() {}, restore() {},
    fillRect(x, y, width, height) { rects.push({ x: x + translation, y, width, height }); },
    translate(x) { translation += x; },
  };
  const canvas = { getContext: () => ctx, style: {} };
  const otter = new Otter(canvas);
  const perch = { left: 1200, floor: 1040, scale: 3 };
  const dockRight = 1270;
  otter.draw('elevator', 6, perch, false);
  const shaft = rects.find(({ width, height }) => width === 22 && height === 22);
  const canvasLeft = Number(canvas.style.transform.match(/translate\((-?\d+)px/)[1]);
  const shaftLeft = canvasLeft + shaft.x * perch.scale;
  assert.ok(shaftLeft + shaft.width * perch.scale <= dockRight, `elevator goes past ${dockRight}: ${shaftLeft + shaft.width * perch.scale}`);
  assert.equal(shaftLeft + shaft.width * perch.scale / 2, perch.left + 11 * perch.scale);
});

test('every elevator pose keeps the otter behind the header and doors', () => {
  let path = [];
  let clips = [];
  const stack = [];
  const pixels = [];
  const otterColors = new Set(Object.values(palette));
  const ctx = {
    save() { stack.push(clips); },
    restore() { clips = stack.pop(); },
    beginPath() { path = []; },
    rect(x, y, w, h) { path.push((px, py) => px >= x && px < x + w && py >= y && py < y + h); },
    clip() { clips = [...clips, path]; },
    fillRect(x, y, w, h) {
      if (w === 1 && h === 1 && otterColors.has(this.fillStyle)
        && clips.every((region) => region.some((contains) => contains(x, y)))) {
        pixels.push([x, y]);
      }
    },
  };
  const otter = new Otter({ getContext: () => ctx });
  for (const entering of [false, true]) {
    for (let n = 0; n <= ELEVATOR_FRAMES; n++) {
      pixels.length = 0;
      otter.elevator(n, entering);
      const { depth, gap } = elevatorFrame(n);
      const top = 1 + depth;
      if (n === 0 || n === 10 || n === 14 || n === 20) assert.ok(pixels.length, `otter missing at frame ${n}`);
      for (const [x, y] of pixels) {
        if (x < 0 || y < top) continue;
        assert.ok(x >= 11 - gap && x < 11 + gap && y >= top + 5 && y < top + 20,
          `otter pixel (${x}, ${y}) covers the car at frame ${n}, entering=${entering}`);
      }
    }
  }
});
