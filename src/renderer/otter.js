'use strict';
(() => {
  const { palette, frames } = typeof module === 'object' ? require('./otter-art') : window.otterArt;
  const ELEVATOR_FRAMES = 25;
  const PERCH_GUTTER = 14;
  const newColors = {
    q: '#263b50', d: '#36556c', m: '#557a92', b: '#8eb2c5', a: '#cee5ed',
    r: '#ad625a', p: '#f49a73', e: '#fff0c8',
  };

  const BOOK = [
    ['KKK KKK', 'KeeKeeK', 'KeaKaeK', 'KrrKrrK', ' KKKKK '],
    ['KKKKKK ', 'KeeKeaK', 'KaeKeeK', 'KrrKrrK', ' KKKKK '],
    ['KKK KKK', 'KeeKeeK', 'KaeKeaK', 'KrrKrrK', ' KKKKK '],
  ];
  const MUG = [
    ' KKKK  ',
    'KeeeeK ',
    'KrppKKK',
    'KrrpKeK',
    'KrrpKK ',
    ' KKKK  ',
  ];
  const SLEEP = [
    '        KKKKKKK         ',
    '    KK KHHHHHHHK KK     ',
    '   KDKHFFFFFFFFHKDK     ',
    '   KKFKKKFFKKKFFKK      ',
    '    KKGGBKKGGBKFWK      ',
    '    KWWPWWKWWPWWK SKK   ',
    '    KKWWWWCWWWWCKKFFSK  ',
    '   KSFWWWWWWWWWWFFFFSK  ',
    '  KSSFWWWWWWWWCCFFFSSK  ',
    '   KKKKKKKKKKKKKKKKKK   ',
  ];
  const Z = ['AAA', '  A', ' A ', 'A  ', 'AAA'];
  const WAVE = [
    [' KK', 'KFK', 'KFK', 'KK '],
    ['KK ', 'KFK', 'KFK', ' KK'],
    ['KK', 'KF', 'KFK', ' KK'],
  ];
  const LEGS = [
    ['KKSSKKKSSKK', ' KKK   KKK '],
    ['KKSSKKSSKKK', 'KKK    KK  '],
    [' KSSKKKSSKK', '  KK   KKKK'],
  ];
  const idleLoops = [
    ['sit', 23], ['book', 38], ['coffee', 34], ['stretch', 18], ['sleep', 45], ['stretch', 18],
  ];

  function idleFrame(index) {
    let remaining = index % idleLoops.reduce((total, [, length]) => total + length, 0);
    for (const [name, length] of idleLoops) {
      if (remaining < length) return [name, remaining];
      remaining -= length;
    }
  }

  function elevatorFrame(index) {
    const depth = index < 4 ? [24, 15, 7, 0][index] : index < 22 ? 0 : [7, 15, 24, 24][index - 22];
    const gap = Math.max(0, Math.min(8, (index - 3) * 3, (21 - index) * 3));
    const walk = Math.min(0, Math.max(-PERCH_GUTTER, -index * 4, (index - 14) * 3)) || 0;
    return { depth, gap, walk, pressed: index >= 14 && index <= 17, visible: index < 21 };
  }

  class Otter {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.clip = null;
      this.frame = 0;
    }

    pixels(x, y, rows) {
      rows.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++) {
          const color = palette[row[dx]] || newColors[row[dx]];
          if (!color || x + dx < -PERCH_GUTTER || x + dx >= 48 - PERCH_GUTTER || y + dy >= 24) continue;
          this.ctx.fillStyle = color;
          this.ctx.fillRect(x + dx, y + dy, 1, 1);
        }
      });
    }

    rect(x, y, w, h, color) {
      this.ctx.fillStyle = newColors[color];
      this.ctx.fillRect(x, y, w, h);
    }

    idle(n) {
      const [loop, step] = idleFrame(n);
      const regular = frames.idle[(Math.floor(step / 2) % frames.idle.length)];
      if (loop === 'sit') this.pixels(0, 0, regular);
      if (loop === 'book') {
        this.pixels(0, 0, regular);
        const page = [16, 17, 31, 32].includes(step) ? 1 : step % 16 > 8 ? 2 : 0;
        this.pixels(7, 14, BOOK[page]);
        this.pixels(5, 15, ['KFK', ' KS']);
        this.pixels(14, 15, ['KFK', 'SK ']);
      }
      if (loop === 'coffee') {
        const sip = step % 17;
        const lift = sip >= 6 && sip <= 12 ? (sip === 6 || sip === 12 ? 2 : 4) : 0;
        this.pixels(0, 0, frames.idle[lift === 4 ? 4 : 0]);
        this.pixels(11, 14 - lift, MUG);
        this.pixels(10, 16 - lift, ['KF', 'KS']);
        if (!lift) this.pixels(15 + (sip % 2), 11 - sip % 3, ['b', ' a', 'b']);
      }
      if (loop === 'stretch') {
        const reach = Math.min(3, Math.floor(Math.min(step, 17 - step) / 2));
        this.pixels(0, 0, frames.idle[reach ? 4 : 0]);
        if (reach) {
          this.pixels(2, 12 - reach, WAVE[reach - 1]);
          this.pixels(16, 13 - reach, WAVE[reach - 1].map((row) => [...row].reverse().join('')));
          if (reach === 3) this.pixels(9, 10, ['KKK', 'KPK']);
        }
      }
      if (loop === 'sleep') {
        this.pixels(0, step % 12 < 5 ? 11 : 10, SLEEP);
        this.pixels(19 + Math.floor(step / 5) % 5, 9 - Math.floor(step / 2) % 8, Z);
      }
    }

    elevator(n, entering) {
      const { depth, gap, walk, pressed, visible } = elevatorFrame(n);
      const top = 1 + depth;
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(-PERCH_GUTTER, 0, 48, 22);
      this.ctx.clip();
      this.rect(0, top, 22, 22, 'q');
      this.rect(1, top + 1, 20, 20, 'm');
      this.rect(2, top + 5, 18, 15, 'q');
      this.rect(4, top + 7, 14, 13, 'd');
      this.rect(5, top + 19, 12, 1, 'b');
      const left = 11 - gap, right = 11 + gap;
      this.rect(2, top + 5, left - 2, 15, 'm');
      this.rect(right, top + 5, 20 - right, 15, 'm');
      this.rect(left - 1, top + 5, 1, 15, 'b');
      this.rect(right, top + 5, 1, 15, 'q');
      if (visible) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(-PERCH_GUTTER, 0, PERCH_GUTTER, 22);
        this.ctx.rect(0, 0, 22, top);
        this.ctx.rect(left, top + 5, right - left, 15);
        this.ctx.clip();
        const step = walk ? n % 3 : 0;
        const base = frames.idle[step].slice(0, 19).concat(LEGS[step].map((row) => '.....' + row + '........'));
        this.pixels(walk, walk ? 1 : 0, base);
        if (pressed && !entering) this.pixels(13, 11, ['KKFFK', 'KFFK ', 'KK   ']);
        this.ctx.restore();
      }
      this.rect(8, top + 1, 6, 3, 'q');
      this.pixels(9, top + 1, entering ? [' a ', 'aaa', '   '] : ['   ', 'aaa', ' a ']);
      this.rect(18, top + 9, 2, 2, pressed && !entering ? 'p' : 'a');
      this.rect(0, top + 20, 22, 1, 'a');
      this.ctx.restore();
      if (depth < 24) this.rect(0, 22, 22, 1, 'd');
    }

    draw(clip, n, { left, floor, scale }, entering) {
      this.canvas.hidden = clip === 'elevator' && n === ELEVATOR_FRAMES;
      if (this.canvas.hidden) return;
      this.canvas.style.width = `${48 * scale}px`;
      this.canvas.style.height = `${26 * scale}px`;
      this.canvas.style.transform = `translate(${left - PERCH_GUTTER * scale}px,${floor - 22 * scale}px)`;
      if (clip !== this.clip) { this.clip = clip; this.frame = 0; }
      n ??= this.frame++;
      this.ctx.clearRect(0, 0, 48, 26);
      this.ctx.save();
      this.ctx.translate(PERCH_GUTTER, 0);
      if (clip === 'idle') this.idle(n);
      else if (clip === 'elevator') this.elevator(n, entering);
      else this.pixels(0, 0, frames[clip][n % frames[clip].length]);
      this.ctx.restore();
    }
  }

  const otter = { Otter, ELEVATOR_FRAMES, elevatorFrame, idleFrame };
  if (typeof module === 'object') module.exports = otter;
  else window.otterAnimation = otter;
})();
