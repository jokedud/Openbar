'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '..', 'src', 'main', 'main.js');
const main = fs.readFileSync(mainPath, 'utf8');
const bounds = { x: 0, y: 0, width: 1000, height: 800 };
const scale = (rect, factor) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * factor)]));

for (const [position, requested, returned, expectedPillY] of [
  ['bottom', { top: 920, bottom: 1000 }, { top: 870, bottom: 950 }, 696],
  ['top', { top: 0, bottom: 80 }, { top: 50, bottom: 130 }, 52],
]) {
  test(`the ${position} appbar ends at the visible dock edge with a displaced strip at 125% DPI`, () => {
    const settings = { position, layout: 'pill', height: 52, margin: 12, reserveSpace: true };
    const app = { requestSingleInstanceLock: () => true, setAppUserModelId() {}, on() {}, whenReady: () => ({ then() {} }) };
    const screen = {
      getPrimaryDisplay: () => ({ bounds }),
      dipToScreenRect: (_window, rect) => scale(rect, 1.25),
      screenToDipRect: (_window, rect) => scale(rect, 0.8),
    };
    const win32 = {
      appBarRegister: () => true,
      appBarSetPos: (_hwnd, edge, rect) => {
        assert.equal(edge, position);
        assert.deepEqual({ ...rect }, { left: 0, right: 1250, ...requested });
        return { left: 0, right: 1250, ...returned };
      },
    };
    let windowBounds;
    const context = vm.createContext({
      __dirname: path.dirname(mainPath),
      process: { platform: 'win32', on() {} },
      require: (id) => ({ path, electron: { app, screen }, './win32': win32 }[id] || {}),
      settings,
      mockBar: { setBounds: (rect) => { windowBounds = rect; }, setAlwaysOnTop() {} },
    });
    vm.runInContext(main, context);
    vm.runInContext('settingsStore = { get: () => settings }; bar = mockBar; barHwnd = 1; layoutBar();', context);
    assert.equal(windowBounds.y + 24, expectedPillY);
    assert.equal(windowBounds.height, 100);
  });
}
