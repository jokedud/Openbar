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
    readShortcutLink: (file) => ({ target: file === 'Notepad.lnk' ? 'notepad.exe' : 'missing.exe' }),
  };
  const context = vm.createContext({
    module: {},
    require: (name) => name === 'electron' ? { app, shell } : require(name),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'startmenu.js'), 'utf8'), context);
  const { iconFor } = context.module.exports;
  assert.equal(await iconFor('Notepad.lnk'), 'notepad.exe');
  assert.equal(await iconFor('Missing.lnk'), 'Missing.lnk');
  assert.equal(await iconFor('Example.url'), 'Example.url');
});
