'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('a foreground owned dialog can guide the companion without being a taskbar window', () => {
  const rect = { left: 420, top: 170, right: 880, bottom: 510 };
  let foreground = 2;
  const windows = new Map([[1, ['Notepad', 9]], [2, ['#32770', 9]], [3, ['Shell_TrayWnd', 8]], [4, ['Chrome_WidgetWin_1', 7]]]);
  const native = {
    EnumWindows: (visit) => { for (const hwnd of windows.keys()) visit(hwnd); },
    IsWindowVisible: () => true,
    IsIconic: () => false,
    GetWindow: (hwnd) => hwnd === 2 ? 1 : 0,
    GetWindowLongPtrW: () => 0,
    GetWindowTextLengthW: () => 4,
    GetWindowTextW: (_, buf) => { buf.write('name', 'utf16le'); return 4; },
    GetClassNameW: (hwnd, buf) => { const [cls] = windows.get(hwnd); buf.write(cls, 'utf16le'); return cls.length; },
    GetWindowThreadProcessId: (hwnd, pid) => { pid[0] = windows.get(hwnd)[1]; },
    DwmGetWindowAttribute: () => 0,
    GetForegroundWindow: () => foreground,
    GetWindowRect: (_, result) => { Object.assign(result, rect); return true; },
  };
  const koffi = {
    load: () => ({ func: (signature) => native[signature.match(/(\w+)\(/)[1]] }),
    struct: () => {}, proto: () => {},
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main/win32.js'), 'utf8'), {
    require: () => koffi, module: mod, Buffer,
  });
  const win32 = mod.exports;
  const state = { windows: win32.listTaskbarWindows(new Set([7])) };
  assert.deepEqual(Array.from(state.windows, (w) => w.hwnd), [1]);
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const source = main.match(/foregroundBounds: (\(\) => \{[\s\S]*?\n    \})/)[1];
  const foregroundBounds = vm.runInNewContext(source, {
    win32, state, process: { pid: 7 },
    screen: { screenToDipRect: (_, bounds) => bounds },
  });
  assert.deepEqual({ ...foregroundBounds() }, { x: 420, y: 170, width: 460, height: 340 });
  foreground = 3;
  assert.equal(foregroundBounds(), null);
  foreground = 4;
  assert.equal(foregroundBounds(), null);
});
