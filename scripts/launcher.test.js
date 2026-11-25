'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('the launcher renders cached apps into its new grid on reopen', async () => {
  const element = () => ({
    children: [],
    get childNodes() { return this.children; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelector: () => null,
    addEventListener() {},
  });
  const body = element();
  const elements = { body, title: element(), actions: element() };
  const context = {
    location: { search: '?widget=start' }, URLSearchParams,
    document: { getElementById: (id) => id === 'apps' ? body.children[1] : elements[id] },
    OB: { init: () => new Promise(() => {}), state: {} },
    api: { invoke: async (name) => name === 'apps:list' ? [{ name: 'Notepad', path: 'Notepad.lnk' }] : '' },
    h: element, icon: element, setTimeout() {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel.js'), 'utf8'), context);
  await vm.runInContext('draw(true)', context);
  const initialGrid = body.children[1];
  assert.equal(initialGrid.children.length, 1);
  await vm.runInContext("draw('switch')", context);
  assert.notEqual(body.children[1], initialGrid);
  assert.equal(body.children[1].children.length, 1);
});
