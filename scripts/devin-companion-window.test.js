'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const bounds = { x: 0, y: 0, width: 1600, height: 1200 };
const { activeSession } = require('../src/renderer/devin-motion');

function loadCompanion() {
  const source = fs.readFileSync(path.join(__dirname, '../src/main/devin-companion.js'), 'utf8');
  const mod = { exports: {} };
  const screen = { getPrimaryDisplay: () => ({ bounds, workArea: bounds }) };
  vm.runInNewContext(source, {
    require: (id) => id === 'electron' ? { screen } : id === 'path' ? path : { activeSession },
    module: mod, clearInterval, setInterval,
  });
  return mod.exports;
}

test('cloud activity on a later page reaches the companion', async () => {
  const Companion = loadCompanion();
  const cursors = [];
  const companion = new Companion({
    listLocal: () => [],
    listCloud: (cursor) => {
      cursors.push(cursor);
      if (!cursor) return { sessions: [{ id: 'finished', status: 'finished' }], next: 'page-2' };
      return { sessions: [{ id: 'working', status: 'running' }], next: null };
    },
  });
  companion.poll();
  await companion.request;
  assert.deepEqual(cursors, [undefined, 'page-2']);
  assert.equal(companion.activity, 'working');
});

test('the companion caps pagination and stops on repeated cursors', async () => {
  const Companion = loadCompanion();
  for (const [next, expected] of [[(cursor) => (cursor || 0) + 30, 5], [() => 'repeat', 2]]) {
    let calls = 0;
    const companion = new Companion({
      listLocal: () => [],
      listCloud: (cursor) => { calls++; return { sessions: [], next: next(cursor) }; },
    });
    companion.poll();
    await companion.request;
    assert.equal(calls, expected);
  }
});
