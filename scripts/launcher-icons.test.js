'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('launcher shortcut icons prefer the app icon and fall back to the shortcut', async () => {
  const app = {
    async getFileIcon(file) {
      if (file === 'missing.exe') throw new Error('missing');
      return { isEmpty: () => false, toDataURL: () => file };
    },
  };
  const shell = {
    readShortcutLink: (file) => ({
      target: { 'Notepad.lnk': 'notepad.exe', 'Web App.lnk': 'chrome_proxy.exe' }[file] || 'missing.exe',
      icon: file === 'Web App.lnk' ? 'web-app.ico' : '',
    }),
  };
  const context = vm.createContext({
    module: {},
    process: { platform: 'win32' },
    require: (name) => {
      if (name === 'electron') return { app, shell };
      if (name === './shortcut-icon') return { shortcutIcon: async () => '' };
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'startmenu.js'), 'utf8'), context);
  const { iconFor } = context.module.exports;
  assert.equal(await iconFor('Notepad.lnk'), 'notepad.exe');
  assert.equal(await iconFor('Web App.lnk'), 'Web App.lnk');
  assert.equal(await iconFor('Missing.lnk'), 'Missing.lnk');
  assert.equal(await iconFor('Example.url'), 'Example.url');
});

test('launcher prefers the Windows Shell icon for a shortcut with an icon resource', async () => {
  const lookups = [];
  const context = vm.createContext({
    module: {},
    process: { platform: 'win32' },
    require: (name) => {
      if (name === 'electron') return {
        shell: { readShortcutLink: () => ({ target: 'mmc.exe', icon: 'shell32.dll', iconIndex: -108 }) },
        app: { getFileIcon: async () => ({ isEmpty: () => false, toDataURL: () => 'generic-white-shortcut' }) },
      };
      if (name === './shortcut-icon') return {
        async shortcutIcon(file) { lookups.push(file); return 'resolved-icon'; },
      };
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'startmenu.js'), 'utf8'), context);
  const { iconFor } = context.module.exports;
  assert.equal(await iconFor('Performance Monitor.lnk'), 'resolved-icon');
  assert.equal(await iconFor('Performance Monitor.lnk'), 'resolved-icon');
  assert.deepEqual(lookups, ['Performance Monitor.lnk']);
});
