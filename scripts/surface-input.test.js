'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('floating surfaces debounce padding entry, keep edge hysteresis, and restore input immediately', () => {
  const events = new Map();
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
    window: { openbar: { send: (...args) => sends.push(args) } },
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

  // Within the 4px hysteresis halo outside the surface rim: stays clickable.
  hit = {};
  move({ buttons: 0, clientX: 21, clientY: 50 });
  flushTimers();
  assert.deepEqual(sends, []);

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
