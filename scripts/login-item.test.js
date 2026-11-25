'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function runEntry({ command, registryError = 0, statError }) {
  const paths = [];
  const koffi = {
    load: () => ({
      func: (signature) => signature.includes('RegGetValueW') ? (_key, subKey, name, _flags, _type, data, size) => {
        assert.equal(subKey, 'Software\\Microsoft\\Windows\\CurrentVersion\\Run');
        assert.equal(name, 'xyz.openbar.app');
        if (registryError) return registryError;
        size[0] = data.write(command + '\0', 'utf16le');
        return 0;
      } : undefined,
    }),
    struct() {},
    proto() {},
  };
  const context = vm.createContext({
    Buffer, module: {},
    require: (id) => id === 'koffi' ? koffi : {
      statSync(target) {
        paths.push(target);
        if (statError) throw Object.assign(new Error(statError), { code: statError });
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'win32.js'), 'utf8'), context);
  return { restore: context.module.exports.shouldRestoreLoginItem('xyz.openbar.app'), paths };
}

const exe = 'C:\\OpenBar builds\\OpenBar-portable.exe';

test('startup restores missing and stale Run entries', () => {
  assert.deepEqual(runEntry({ registryError: 2 }), { restore: true, paths: [] });
  assert.deepEqual(runEntry({ command: `"${exe}" --flag`, statError: 'ENOENT' }), { restore: true, paths: [exe] });
});

test('startup keeps live or indeterminate Run entries', () => {
  assert.deepEqual(runEntry({ command: `"${exe}"` }), { restore: false, paths: [exe] });
  assert.deepEqual(runEntry({ command: `"${exe}"`, statError: 'EACCES' }), { restore: false, paths: [exe] });
  assert.deepEqual(runEntry({ registryError: 5 }), { restore: false, paths: [] });
  assert.deepEqual(runEntry({ command: 'not an absolute exe path' }), { restore: false, paths: [] });
});
