'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('the dock defaults to 54 px without overwriting a saved height', () => {
  const module = { exports: {} };
  let saved = '{}';
  const modules = {
    fs: { readFileSync: () => saved },
    path,
    electron: { app: { getPath: () => __dirname } },
    './custom-tabs': require('../src/main/custom-tabs'),
  };
  const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
  vm.runInNewContext(store, { module, require: (name) => modules[name] });
  const { JsonFile, DEFAULT_SETTINGS } = module.exports;
  const height = () => new JsonFile('settings.json', DEFAULT_SETTINGS).get().height;

  assert.equal(height(), 54);
  saved = '{"height":46}';
  assert.equal(height(), 46);
});
