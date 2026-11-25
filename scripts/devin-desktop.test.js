'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { createWindowsDesktop } = require('../src/main/devin-desktop');

test('scrolling targets the app under the pointer even with focus-routed wheel input', () => {
  const panel = 1, desktop = 2, child = 3;
  let foreground = panel, mayFocus = true;
  const routed = [];
  const native = {
    WindowFromPoint: () => child,
    GetAncestor: () => desktop,
    GetWindowThreadProcessId: (_, pid) => { pid[0] = 200; },
    IsWindow: () => true,
    SetCursorPos: () => true,
    GetForegroundWindow: () => foreground,
    SetForegroundWindow: (hwnd) => { if (mayFocus) foreground = hwnd; },
    SendInput: (count) => { routed.push(foreground); return count; },
  };
  const koffi = {
    load: () => ({ func: (signature, name) => native[name || signature.match(/(\w+)\(/)[1]] }),
    struct() {}, proto() {}, union() {}, pointer() {}, sizeof: () => 40,
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(path.join(__dirname, '../src/main/win32.js'), 'utf8'), {
    require: () => koffi, module, process: { pid: 100 },
  });
  const display = { id: 1, bounds: { x: 0, y: 0 }, size: { width: 800, height: 600 }, scaleFactor: 1 };
  const screen = { getPrimaryDisplay: () => display, dipToScreenPoint: (point) => point };
  const prepare = createWindowsDesktop({ screen, win32: module.exports });
  const action = prepare({ name: 'mouse_scroll', description: 'Scroll' }, { x: 200, y: 300, steps: -1 });
  action.run();
  assert.deepEqual(routed, [desktop]);
  foreground = panel;
  mayFocus = false;
  assert.throws(() => action.run(), /focus the desktop scroll target/);
  assert.deepEqual(routed, [desktop]);
});
