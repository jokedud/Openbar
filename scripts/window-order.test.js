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
    listTaskbarWindows: () => zOrder.map((hwnd) => ({ hwnd, pid: hwnd, cls: hwnd % 2 ? 'notepad' : 'wordpad', title: String(hwnd) })),
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

  const actions = [];
  const renderer = vm.createContext({
    OB: {
      state: vm.runInContext('state', context),
      settings: { pinned: [], groupWindows: true },
      init: () => new Promise(() => {}),
    },
    api: { invoke: (...args) => actions.push(args) },
    navigator: {},
    document: { addEventListener() {} },
    h: (_tag, attrs) => ({ attrs, children: [], append(child) { this.children.push(child); } }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'bar.js'), 'utf8'), renderer);
  const clickNotepad = () => vm.runInContext("cycle(OB.state.windows.filter((w) => w.exe === 'notepad'))", renderer);
  zOrder = [5, 6, 7];
  await poll();
  zOrder = [6, 7, 5];
  await poll();
  clickNotepad();
  assert.deepEqual(actions.pop(), ['win:action', 7, 'focus']);
  zOrder = [7, 6, 5];
  await poll();
  clickNotepad();
  assert.deepEqual(actions.pop(), ['win:action', 5, 'focus']);

  zOrder = [6, 7];
  await poll();
  const groups = vm.runInContext("W.apps().children.map((button) => button.attrs['data-hwnds'])", renderer);
  assert.deepEqual(Array.from(groups), ['7', '6']);
});
