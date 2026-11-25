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
    querySelectorAll: () => [],
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

for (const columns of [5, 3, 2]) {
  test(`launcher vertical arrows follow the rendered ${columns}-column grid`, async () => {
    const element = (_tag, attrs, ...children) => ({
      children, listeners: {},
      get childNodes() { return this.children; },
      append(...kids) { this.children.push(...kids); },
      replaceChildren(...kids) { this.children = kids; },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(type, fn) { this.listeners[type] = fn; },
    });
    const elements = { body: element(), title: element(), actions: element() };
    const launched = [];
    const apps = Array.from({ length: 12 }, (_, i) => ({ name: `App ${i}`, path: `app-${i}.lnk` }));
    const context = {
      location: { search: '?widget=start' }, URLSearchParams,
      document: { getElementById: (id) => elements[id] },
      getComputedStyle: () => ({ gridTemplateColumns: Array(columns).fill('88px').join(' ') }),
      OB: { init: () => new Promise(() => {}), state: {} },
      api: { invoke: async (name, value) => {
        if (name === 'apps:list') return apps;
        if (name === 'launch') launched.push(value.path);
        return '';
      } },
      h: element, icon: element, setTimeout() {},
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel.js'), 'utf8'), context);
    await vm.runInContext('draw(true)', context);
    const input = elements.body.children[0].children[1];
    const press = (key) => input.listeners.keydown({ key, preventDefault() {} });
    press('ArrowDown');
    press('Enter');
    press('ArrowUp');
    press('Enter');
    assert.deepEqual(launched, [`app-${columns}.lnk`, 'app-0.lnk']);
  });
}
