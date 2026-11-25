'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('window focus only synthesizes Alt when direct foreground activation fails', () => {
  const calls = [];
  let blocked = false;
  const methods = {
    IsIconic: () => true,
    ShowWindow: (...args) => calls.push(['restore', ...args]),
    SetForegroundWindow: (hwnd) => { calls.push(['activate', hwnd]); return !blocked; },
    keybd_event: (vk, _scan, flags) => { calls.push(['key', vk, flags]); blocked = false; },
  };
  const koffi = {
    load: () => ({ func: (signature) => methods[signature.match(/(\w+)\(/)[1]] }),
    struct() {},
    proto() {},
  };
  const context = vm.createContext({ require: () => koffi, module: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'win32.js'), 'utf8'), context);
  assert.equal(context.module.exports.focusWindow(42), true);
  assert.deepEqual(calls.splice(0), [['restore', 42, 9], ['activate', 42]]);

  blocked = true;
  assert.equal(context.module.exports.focusWindow(42), true);
  assert.deepEqual(calls, [['restore', 42, 9], ['activate', 42], ['key', 0x12, 0], ['key', 0x12, 2], ['activate', 42]]);
});

test('window focus falls back to AttachThreadInput and SwitchToThisWindow when SetForegroundWindow stays blocked', () => {
  const calls = [];
  let fg = 99;
  let attachAllowsFocus = true;
  const methods = {
    IsIconic: () => false,
    ShowWindow: (...args) => calls.push(['show', ...args]),
    SetForegroundWindow: (hwnd) => {
      calls.push(['activate', hwnd]);
      if (attachAllowsFocus && calls.some((c) => c[0] === 'attach' && c[3] === true)) {
        fg = hwnd;
        return true;
      }
      return false;
    },
    keybd_event: (vk, _scan, flags) => calls.push(['key', vk, flags]),
    GetCurrentThreadId: () => 100,
    GetForegroundWindow: () => fg,
    GetWindowThreadProcessId: (hwnd) => (hwnd === 99 ? 200 : 300),
    AttachThreadInput: (a, b, on) => { calls.push(['attach', a, b, on]); return true; },
    BringWindowToTop: (hwnd) => { calls.push(['top', hwnd]); return true; },
    SwitchToThisWindow: (hwnd, altTab) => { calls.push(['switch', hwnd, altTab]); fg = hwnd; },
  };
  const koffi = {
    load: () => ({ func: (signature) => methods[signature.match(/(\w+)\(/)[1]] }),
    struct() {},
    proto() {},
  };
  const context = vm.createContext({ require: () => koffi, module: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'win32.js'), 'utf8'), context);

  // 1. Succeeds via AttachThreadInput + BringWindowToTop + SetForegroundWindow and detaches both threads.
  assert.equal(context.module.exports.focusWindow(42), true);
  assert.deepEqual(calls.splice(0), [
    ['activate', 42],
    ['key', 0x12, 0], ['key', 0x12, 2],
    ['activate', 42],
    ['attach', 100, 200, true],
    ['attach', 100, 300, true],
    ['top', 42],
    ['activate', 42],
    ['attach', 100, 300, false],
    ['attach', 100, 200, false],
  ]);

  // 2. When SetForegroundWindow still fails (e.g. UIPI / Windows 11 24H2 lock), falls back to SwitchToThisWindow.
  fg = 99;
  attachAllowsFocus = false;
  assert.equal(context.module.exports.focusWindow(42), true);
  assert.deepEqual(calls.slice(-3), [
    ['attach', 100, 300, false],
    ['attach', 100, 200, false],
    ['switch', 42, true],
  ]);

  // 3. Respects { restore: false } so SwitchToThisWindow does not undo a maximize action.
  calls.length = 0;
  fg = 99;
  assert.equal(context.module.exports.focusWindow(42, { restore: false }), true);
  assert.deepEqual(calls.slice(-1), [['switch', 42, false]]);
});
