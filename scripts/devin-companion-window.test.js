'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

test('the tray toggle hides and pauses the overlay, then restores its latest state', () => {
  const Companion = loadCompanion();
  const companion = new Companion({ listLocal: () => [], listCloud: () => ({ error: 'missing' }) });
  const received = [];
  class Window extends EventEmitter {
    constructor() { super(); this.setAlwaysOnTop = () => {}; this.loadFile = () => {}; this.setBounds = () => {}; }
    isVisible() { return !!this.visible; }
    hide() { this.visible = false; this.emit('hide'); }
    showInactive() { this.visible = true; this.emit('show'); }
  }
  const overlay = companion.window = new Window();
  companion.ready = true;
  overlay.webContents = { send: (channel) => received.push(channel) };
  companion.dock = { ...bounds };
  companion.otter = true;
  companion.present();
  const src = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const definitions = ['createBar', 'createTray'].map((name) => src.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`))[0]);
  let menu;
  const tray = class extends EventEmitter {
    setToolTip() {}
    setContextMenu(items) { menu = items; }
  };
  Window.prototype.webContents = new EventEmitter();
  vm.runInNewContext(`${definitions.join('\n')}\ncreateBar(); createTray(); bar.emit('ready-to-show');`, {
    bar: null, tray: null, companion, BrowserWindow: Window, Tray: tray, Menu: { buildFromTemplate: (items) => items },
    barBounds: () => bounds, layoutBar: () => {}, ICON: '', RENDERER: '', webPreferences: {}, path, isWin: false,
    nativeImage: { createFromPath: () => ({ resize: () => {} }) },
  });
  const toggle = menu.find(({ label }) => label === 'Show / hide bar').click;
  assert.equal(overlay.isVisible(), true);
  toggle();
  assert.equal(overlay.isVisible(), false);
  assert.equal(received.at(-1), 'devin:motion-pause');
  companion.present();
  assert.equal(overlay.isVisible(), false);
  toggle();
  assert.equal(overlay.isVisible(), true);
  assert.equal(received.at(-1), 'devin:motion');
});
