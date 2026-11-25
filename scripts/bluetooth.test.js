'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { bluetoothLayoutMigration, normalizeBluetoothState, registerBluetoothIpc } = require('../src/main/bluetooth');

test('Bluetooth migration adds one item without reordering a custom layout', () => {
  const saved = { left: ['clock', 'start'], center: ['apps'], right: ['battery', 'weather'], style: 'midnight' };
  const patch = bluetoothLayoutMigration(saved);
  assert.deepEqual(patch, { bluetoothWidgetLayoutV1: true, right: ['battery', 'weather', 'bluetooth'] });
  assert.deepEqual(saved.right, ['battery', 'weather']);
  assert.deepEqual(bluetoothLayoutMigration({ ...saved, center: ['bluetooth', 'apps'] }), { bluetoothWidgetLayoutV1: true });
  assert.equal(bluetoothLayoutMigration({ ...saved, bluetoothWidgetLayoutV1: true }), null);
});

test('Bluetooth maps absent, denied, and invalid native data without claiming the radio is off', () => {
  for (const status of ['no-adapter', 'denied', 'disabled', 'multiple', 'unsupported']) {
    assert.deepEqual(normalizeBluetoothState({ status }), { status, devices: null, error: null });
  }
  assert.deepEqual(normalizeBluetoothState({ status: 'unexpected', devices: {} }), {
    status: 'unavailable', devices: null, error: null,
  });
  assert.deepEqual(normalizeBluetoothState({ status: 'off', error: 'denied' }), {
    status: 'off', devices: null, error: 'denied',
  });
});

test('Bluetooth preserves actual, unknown, and empty device connection results', () => {
  assert.deepEqual(normalizeBluetoothState({ status: 'on', devices: [] }).devices, []);
  assert.deepEqual(normalizeBluetoothState({ status: 'on', devices: [
    { name: ' Headset ', connected: true }, { name: 'Keyboard', connected: false },
    { name: 'Phone', connected: 0 }, { name: '' }, null,
  ] }).devices, [
    { name: 'Headset', connected: true }, { name: 'Keyboard', connected: false }, { name: 'Phone', connected: null },
  ]);
});

test('Bluetooth IPC rejects hidden-panel requests and non-allowlisted mutations or destinations', async () => {
  const handlers = new Map();
  const shell = {
    openExternal: () => assert.fail('An unapproved shortcut opened'),
    openPath: () => assert.fail('An unapproved file opened'),
  };
  const activePanel = {};
  registerBluetoothIpc({ handle: (channel, action) => handlers.set(channel, action) }, shell, (event) => event === activePanel);
  assert.equal(handlers.get('bluetooth:state')({}), null);
  assert.equal(handlers.get('bluetooth:toggle')({}, true), null);
  assert.equal(handlers.get('bluetooth:toggle')(activePanel, 'on'), null);
  assert.equal(await handlers.get('bluetooth:open')({}, 'add'), false);
  assert.equal(await handlers.get('bluetooth:open')(activePanel, 'ms-settings:privacy'), false);
});
