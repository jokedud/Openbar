'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { SurfaceInput } = require('../src/main/surface-input');

test('floating surfaces only ignore input while the mouse is over the padding', () => {
  const events = new Map();
  const ipc = new Map();
  const sends = [];
  const control = {};
  const surface = { contains: (hit) => hit === control };
  const addEventListener = (type, fn) => events.set(type, fn);
  const document = { addEventListener, documentElement: { addEventListener }, elementFromPoint: () => hit };
  class Observer { observe() {} }
  let hit = control;
  const context = vm.createContext({
    document, surface, ResizeObserver: Observer, MutationObserver: Observer,
    window: { openbar: { send: (...args) => sends.push(args), on: (channel, fn) => ipc.set(channel, fn) } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'common.js'), 'utf8'), context);
  vm.runInContext("OB.platform = 'win32'; observeSurface(surface);", context);
  const move = events.get('mousemove');
  move({ buttons: 0 });
  assert.deepEqual(sends, []);

  hit = {};
  move({ buttons: 1 });
  move({ buttons: 0, sourceCapabilities: { firesTouchEvents: true } });
  assert.deepEqual(sends, []);
  move({ buttons: 0 });
  move({ buttons: 0 });
  hit = control;
  move({ buttons: 0 });

  hit = {};
  move({ buttons: 0 });
  events.get('mouseleave')({ buttons: 0 });

  move({ buttons: 0 });
  document.hidden = true;
  events.get('visibilitychange')();
  assert.deepEqual(sends, [true, false, true, false, true, false].map((ignore) => ['surface:mouse', ignore]));
  move({ buttons: 0 });
  ipc.get('surface:mouse-reset')();
  move({ buttons: 0 });
  assert.deepEqual(sends.slice(-2), [['surface:mouse', true], ['surface:mouse', true]]);
});

test('Windows padding passes clicks through without forwarding and rearms on entry or exit', () => {
  const changes = [], reset = [];
  let tick;
  let point = { x: 105, y: 220 };
  const input = new SurfaceInput({
    getBounds: () => ({ x: 100, y: 200, width: 160, height: 90 }),
    isVisible: () => true,
    isDestroyed: () => false,
    setIgnoreMouseEvents: (...args) => changes.push(args),
    webContents: { send: (channel) => reset.push(channel) },
  }, () => point, () => ({ x: 12, y: 12, width: 136, height: 66, radius: 16 }), {
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
  });
  input.update(true);
  input.update(false);
  assert.deepEqual(changes, [[true]]);
  point = { x: 113, y: 213 };
  tick();
  assert.deepEqual(changes, [[true]]);
  point = { x: 133, y: 219 };
  tick();
  assert.deepEqual(changes, [[true], [false]]);
  assert.equal(tick, null);
  assert.deepEqual(reset, ['surface:mouse-reset']);

  point = { x: 105, y: 220 };
  input.update(true);
  point = { x: 98, y: 220 };
  tick();
  assert.equal(tick, null);
  assert.deepEqual(changes, [[true], [false], [true], [false]]);
  input.update(true);
  assert.deepEqual(reset, Array(3).fill('surface:mouse-reset'));
});
