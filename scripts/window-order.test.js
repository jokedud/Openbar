'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('window polls retain dock order when Windows changes the Z-order', async () => {
  let zOrder = [1, 2, 3];
  const app = {
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    on() {},
    whenReady: () => new Promise(() => {}),
    getAppMetrics: () => [],
  };
  const win32 = {
    listTaskbarWindows: () => zOrder.map((hwnd) => ({ hwnd, pid: hwnd, cls: 'test', title: String(hwnd) })),
    processPath: () => '',
    foregroundWindow: () => zOrder[0],
  };
  const modules = { path, electron: { app, powerMonitor: { getSystemIdleTime: () => 200 } }, './win32': win32 };
  const context = vm.createContext({
    require: (name) => modules[name] || {},
    __dirname,
    process: { platform: 'win32', pid: 100, on() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8'), context);
  const poll = async () => {
    await vm.runInContext('pollWindows()', context);
    return Array.from(vm.runInContext('state.windows', context), (w) => w.hwnd);
  };
  assert.deepEqual(await poll(), [1, 2, 3]);
  zOrder = [3, 2, 1];
  assert.deepEqual(await poll(), [1, 2, 3]);
  assert.equal(vm.runInContext('state.activeHwnd', context), 3);
  zOrder = [4, 3, 1];
  assert.deepEqual(await poll(), [1, 3, 4]);
});
