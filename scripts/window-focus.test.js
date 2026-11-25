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
