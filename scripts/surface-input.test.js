'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('floating surfaces only ignore input while the mouse is over the padding', () => {
  const events = new Map();
  const sends = [];
  const control = {};
  const surface = { contains: (hit) => hit === control };
  const addEventListener = (type, fn) => events.set(type, fn);
  const document = { addEventListener, documentElement: { addEventListener }, elementFromPoint: () => hit };
  class Observer { observe() {} }
  let hit = control;
  const context = vm.createContext({
    document, surface, ResizeObserver: Observer, MutationObserver: Observer,
    window: { openbar: { send: (...args) => sends.push(args) } },
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
});
