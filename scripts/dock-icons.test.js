
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '../src/main/main.js');
const barPath = path.join(__dirname, '../src/renderer/bar.js');

function loadDock(pin, hasLogo) {
  const app = {
    requestSingleInstanceLock: () => true,
    setAppUserModelId() {},
    on() {},
    whenReady: () => ({ then() {} }),
    getFileIcon: async () => { throw new Error('No file icon'); },
  };
  const systemRoot = 'D:/Windows';
  const logo = path.join(systemRoot, 'ImmersiveControlPanel', 'images', 'logo.targetsize-256_altform-unplated.png');
  const dataUrl = 'data:image/png;base64,settings';
  const nativeImage = {
    createFromPath: (file) => ({ isEmpty: () => !hasLogo || file !== logo, toDataURL: () => dataUrl }),
  };
  const handlers = new Map();
  const ipcMain = { handle: (name, fn) => handlers.set(name, fn) };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8') + '\nregisterIpc();', {
    __dirname: path.dirname(mainPath),
    process: { platform: 'win32', env: { SystemRoot: systemRoot }, on() {} },
    require: (id) => ({ path, electron: { app, nativeImage, ipcMain }, './bluetooth': require('../src/main/bluetooth') }[id] || {}),
  }, { filename: mainPath });

  const pending = [];
  const context = vm.createContext({
    OB: {
      settings: { pinned: [pin] },
      state: { windows: [] },
      init: () => new Promise(() => {}),
    },
    api: { invoke: (channel, file) => {
      const result = handlers.get(channel)(null, file);
      pending.push(result);
      return result;
    } },
    h: (tag, attrs, ...children) => ({ tag, attrs, children, append: (...nodes) => children.push(...nodes) }),
    document: { addEventListener() {} },
    navigator: {},
    requestAnimationFrame: () => 1,
  });
  vm.runInContext(fs.readFileSync(barPath, 'utf8'), context, { filename: barPath });
  return {
    dataUrl,
    async icon() {
      const renderIcon = () => vm.runInContext('W.apps().children[0].children[0]', context);
      renderIcon();
      await Promise.all(pending);
      return renderIcon();
    },
  };
}

test('the pinned Settings URI renders the installed Windows Settings icon', async () => {
  const dock = loadDock({ name: 'Settings', path: 'ms-settings:' }, true);
  const icon = await dock.icon();
  assert.equal(icon.tag, 'img');
  assert.equal(icon.attrs.src, dock.dataUrl);
});

test('a Settings pin uses a letter tile when the Windows logo is unavailable', async () => {
  const dock = loadDock({ name: 'Settings', path: 'ms-settings:' }, false);
  const icon = await dock.icon();
  assert.equal(icon.tag, 'span');
  assert.equal(icon.attrs.class, 'ph');
  assert.equal(icon.children[0], 'S');
});
