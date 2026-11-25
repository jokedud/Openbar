'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createWifiControls } = require('../src/main/wifi');

const radio = (index, software, hardware) => ({ index, software, hardware });
const adapter = (radios, connected = false, setRadio = () => true) => ({ radios, connected, setRadio });
const controls = (adapters) => createWifiControls(() => {}, () => ({ withAdapters: (use) => use(adapters) }));

test('distinguishes missing WLAN support, no adapters, incomplete reads and a hardware block', async () => {
  const unavailable = createWifiControls(() => {}, () => null);
  assert.deepEqual(await unavailable.status(), { radio: 'unavailable', connected: false, canToggle: false });
  assert.deepEqual(await controls([]).status(), { radio: 'absent', connected: false, canToggle: false });
  assert.deepEqual(await controls([adapter([])]).status(), { radio: 'unknown', connected: false, canToggle: false });
  assert.deepEqual(await controls([adapter([radio(0, 1, 2)])]).status(), { radio: 'blocked', connected: false, canToggle: false });
  assert.equal(await unavailable.setRadio(true), false);
});

test('keeps connection status separate from radio state', async () => {
  assert.deepEqual(await controls([adapter([radio(0, 2, 1)])]).status(), { radio: 'off', connected: false, canToggle: true });
  assert.deepEqual(await controls([adapter([radio(0, 1, 1)], true)]).status(), { radio: 'on', connected: true, canToggle: true });
  const mixed = controls([adapter([radio(0, 1, 1)], true), adapter([])]);
  assert.deepEqual(await mixed.status(), { radio: 'on', connected: true, canToggle: false });
  assert.equal(await mixed.setRadio(false), false);
});

test('writes only known, hardware-enabled PHYs that need a change and reports failures', async () => {
  const writes = [];
  const write = (r, state) => { writes.push([r.index, state]); return r.index !== 0; };
  const wifi = controls([
    adapter([radio(0, 1, 1), radio(1, 1, 2), radio(2, 2, 1)], true, write),
    adapter([radio(3, 1, 1)], false, write),
  ]);
  assert.equal(await wifi.setRadio(false), false);
  assert.deepEqual(writes, [[0, 2], [3, 2]]);
  writes.length = 0;
  assert.equal(await wifi.setRadio(true), true);
  assert.deepEqual(writes, [[2, 1]]);
  assert.equal(await wifi.setRadio('false'), false);
  assert.deepEqual(writes, [[2, 1]]);
});

test('hands discovery to Windows and falls back to Settings without accepting arbitrary URIs', async () => {
  const opened = [];
  const wifi = createWifiControls(async (url) => {
    opened.push(url);
    if (url !== 'ms-settings:network') throw new Error('Unavailable');
  });
  assert.equal(await wifi.open('networks'), true);
  assert.deepEqual(opened, ['ms-availablenetworks:', 'ms-settings:network-wifi', 'ms-settings:network']);
  opened.length = 0;
  assert.equal(await wifi.open('settings'), true);
  assert.equal(await wifi.open('https://example.com'), false);
  assert.deepEqual(opened, ['ms-settings:network']);
  assert.equal(await createWifiControls(() => { throw new Error('Unavailable'); }).open('settings'), false);
});
