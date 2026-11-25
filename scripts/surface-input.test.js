'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { SurfaceInput } = require('../src/main/surface-input');

test('floating surfaces debounce padding entry, keep edge hysteresis, and restore input immediately', () => {
  const events = new Map();
  const ipc = new Map();
  const sends = [];
  const timers = new Map();
  let nextTimer = 1;
  const control = {};
  const rect = { left: 24, top: 24, right: 424, bottom: 78 };
  const surface = {
    contains: (hit) => hit === control,
    getBoundingClientRect: () => rect,
    offsetLeft: 24, offsetTop: 24, offsetWidth: 400, offsetHeight: 54,
  };
  const addEventListener = (type, fn) => events.set(type, fn);
  const document = { addEventListener, documentElement: { addEventListener }, elementFromPoint: () => hit };
  const observerCallbacks = [];
  class Observer {
    constructor(cb) { observerCallbacks.push(cb); }
    observe() {}
  }
  const rafs = [];
  let hit = control;
  const context = vm.createContext({
    document, surface, ResizeObserver: Observer, MutationObserver: Observer,
    getComputedStyle: () => ({ borderTopLeftRadius: '16px' }),
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    setTimeout: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    window: { openbar: { send: (...args) => sends.push(args), on: (channel, fn) => ipc.set(channel, fn) } },
  });
  const flushTimers = () => {
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
  };
  const flushRafs = () => {
    while (rafs.length) rafs.shift()();
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'common.js'), 'utf8'), context);
  vm.runInContext("OB.platform = 'win32'; observeSurface(surface);", context);
  const move = events.get('mousemove');

  // Inside surface: never ignores input.
  move({ buttons: 0, clientX: 100, clientY: 50 });
  flushTimers();
  assert.deepEqual(sends, []);

  // Within the 4px hysteresis halo outside the straight rim: stays clickable.
  hit = {};
  move({ buttons: 0, clientX: 21, clientY: 50 });
  flushTimers();
  assert.deepEqual(sends, []);

  // Outside the rounded corner arc (even inside the axis-aligned bounding box): allows click-through.
  move({ buttons: 0, clientX: 24, clientY: 24 });
  flushTimers();
  assert.deepEqual(sends, [['surface:mouse', true]]);
  move({ buttons: 0, clientX: 21, clientY: 50 });
  assert.deepEqual(sends, [['surface:mouse', true], ['surface:mouse', false]]);
  sends.length = 0;

  // Pressed buttons or touch events over padding never ignore input.
  move({ buttons: 1, clientX: 5, clientY: 5 });
  move({ buttons: 0, clientX: 5, clientY: 5, sourceCapabilities: { firesTouchEvents: true } });
  flushTimers();
  assert.deepEqual(sends, []);

  // Brief excursion into padding cancelled before the debounce expires sends nothing.
  move({ buttons: 0, clientX: 5, clientY: 5 });
  assert.deepEqual(sends, []);
  move({ buttons: 0, clientX: 22, clientY: 50 });
  flushTimers();
  assert.deepEqual(sends, []);

  // Staying over padding enables click-through once; re-entering the halo restores input immediately.
  move({ buttons: 0, clientX: 5, clientY: 5 });
  move({ buttons: 0, clientX: 4, clientY: 5 });
  flushTimers();
  move({ buttons: 0, clientX: 22, clientY: 50 });

  // Mouseleave and hidden visibility immediately restore clickable state.
  move({ buttons: 0, clientX: 5, clientY: 5 });
  flushTimers();
  events.get('mouseleave')({ buttons: 0 });

  move({ buttons: 0, clientX: 5, clientY: 5 });
  flushTimers();
  document.hidden = true;
  events.get('visibilitychange')();
  assert.deepEqual(sends, [true, false, true, false, true, false].map((ignore) => ['surface:mouse', ignore]));
  document.hidden = false;
  move({ buttons: 0, clientX: 5, clientY: 5 });
  ipc.get('surface:mouse-reset')();
  flushTimers();
  assert.equal(sends.length, 6);
  move({ buttons: 0, clientX: 5, clientY: 5 });
  flushTimers();
  ipc.get('surface:mouse-reset')();
  move({ buttons: 0, clientX: 5, clientY: 5 });
  flushTimers();
  assert.deepEqual(sends.slice(-2), [['surface:mouse', true], ['surface:mouse', true]]);

  // Resize/mutation bursts coalesce to one rAF and deduplicate identical bounds.
  sends.length = 0;
  observerCallbacks[0]();
  observerCallbacks[0]();
  observerCallbacks[1]();
  assert.equal(rafs.length, 1);
  flushRafs();
  assert.equal(sends.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sends[0])), ['surface:bounds', { x: 24, y: 24, width: 400, height: 54, radius: 16 }]);

  observerCallbacks[0]();
  flushRafs();
  assert.equal(sends.length, 1);

  surface.offsetWidth = 420;
  observerCallbacks[0]();
  flushRafs();
  assert.equal(sends.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(sends[1])), ['surface:bounds', { x: 24, y: 24, width: 420, height: 54, radius: 16 }]);
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
  point = { x: 133, y: 208 };
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
  point = { x: 114, y: 214 };
  input.update(true);
  assert.equal(tick, null);
  assert.deepEqual(reset, Array(4).fill('surface:mouse-reset'));
});
