'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

test('a render tick does not detach a dragged pin before drop', () => {
  const events = new Map();
  const pinned = [{ name: 'A' }, { name: 'B' }];
  const left = { children: [], addEventListener() {}, replaceChildren(...children) { this.children = children; } };
  const zones = { bar: { dataset: {} }, left, center: { children: [] }, right: { children: [] } };
  const OB = {
    settings: { left: ['apps'], center: [], right: [], pinned, customTabs: [] },
    init: () => new Promise(() => {}),
    setSettings: (patch) => Object.assign(OB.settings, patch),
  };
  const context = {
    OB, h: () => ({ isConnected: false }), navigator: {}, document: {
      addEventListener: (name, callback) => events.set(name, callback),
      getElementById: (name) => zones[name],
    },
    requestAnimationFrame: (callback) => { context.frame = callback; return 1; },
  };
  vm.createContext(context);
  const tabs = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'bar-tabs.js'), 'utf8');
  vm.runInContext(tabs, context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'bar.js'), 'utf8');
  vm.runInContext(source, context);
  vm.runInContext("W.apps = () => ({ dataset: {}, outerHTML: OB.settings.pinned.map((pin) => pin.name).join(',') }); render();", context);
  const apps = left.children[0];
  const sourcePin = {
    dataset: { pin: '0' },
    closest: () => sourcePin,
    classList: {
      add: () => { apps.outerHTML = 'dragging A,B'; },
      remove: () => { apps.outerHTML = 'A,B'; },
    },
  };
  events.get('dragstart')({ target: sourcePin });
  vm.runInContext('render()', context);
  assert.equal(left.children[0], apps);

  events.get('drop')({ target: { closest: () => ({ dataset: { pin: '1' } }) } });
  events.get('dragend')({ target: sourcePin });
  context.frame();
  assert.equal(left.children[0].outerHTML, 'B,A');
});
