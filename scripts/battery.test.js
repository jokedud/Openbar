'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { decodeStatus, estimateChargeTime, openPowerSettings } = require('../src/main/battery');

function windowsBattery(build, functions) {
  const file = path.join(__dirname, '..', 'src', 'main', 'battery.js');
  const module = { exports: {} };
  const koffi = {
    load: () => ({ func: (signature) => functions[signature.match(/(\w+)\(/)[1]] }),
    decode: (buffer, offset, type) => offset === 20 ? buffer.readUInt32LE(offset) :
      offset === 'uint8_t' ? buffer.subarray(0, type) : buffer,
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, Buffer, process, require: (name) => name === 'koffi' ? koffi :
      name === 'node:os' ? { release: () => '10.0.' + build } : require(name),
  });
  return module.exports.createBattery();
}

function status(ac, flags, percent, saver, time = 0xffffffff) {
  const raw = Buffer.alloc(12);
  raw.set([ac, flags, percent, saver]);
  raw.writeUInt32LE(time, 4);
  return decodeStatus(raw);
}

test('Win32 battery data distinguishes plugged-in desktops, full batteries, and unknown hardware', () => {
  assert.deepEqual(status(1, 128, 255, 0), {
    present: false, pluggedIn: true, level: null, charging: false, remaining: null, saver: null, low: false,
  });
  assert.deepEqual(status(1, 1, 100, 0), {
    present: true, pluggedIn: true, level: 100, charging: false, remaining: null, saver: false, low: false,
  });
  assert.deepEqual(status(255, 255, 255, 255), decodeStatus(null));
  assert.equal(status(1, 8, 62, 0, 400).charging, true);
  assert.equal(status(1, 8, 62, 0, 400).remaining, null);
});

test('remaining time and low battery are meaningful only when Windows reports battery power', () => {
  assert.deepEqual(status(0, 2, 12, 1, 3600), {
    present: true, pluggedIn: false, level: 12, charging: false, remaining: 3600, saver: true, low: true,
  });
  assert.equal(status(0, 4, 255, 0).low, true);
  assert.equal(status(1, 2, 12, 0, 3600).low, false);
  assert.equal(status(0, 0, 42, 0).remaining, null);
});

test('Windows 11 Energy Saver notifications override a legacy Off flag and block mode changes', () => {
  const saverGuid = Buffer.from('00840e559be2d441a716446655440000', 'hex');
  let notify, writes = 0, changes = 0;
  const battery = windowsBattery(26100, {
    GetSystemPowerStatus: (raw) => { raw.set([0, 0, 80, 0]); return 1; },
    RegisterPowerSettingNotification: (_hwnd, setting) => { assert.deepEqual(setting, saverGuid); return 7; },
    UnregisterPowerSettingNotification: (handle) => assert.equal(handle, 7),
    PowerGetActualOverlayScheme: () => 0,
    PowerSetActiveOverlayScheme: () => { writes++; return 0; },
    PowerGetActiveScheme: (_root, out) => { out[0] = Buffer.from('22421b3894f6f0419685ff5bb260df2e', 'hex'); return 0; },
    LocalFree() {},
  });
  const stop = battery.watchSaver({
    hookWindowMessage: (message, fn) => { assert.equal(message, 0x0218); notify = fn; },
    isDestroyed: () => false,
    unhookWindowMessage: (message) => { assert.equal(message, 0x0218); notify = null; },
  }, 1, () => changes++);
  const payload = Buffer.alloc(24);
  saverGuid.copy(payload);
  payload.writeUInt32LE(4, 16);
  assert.equal(battery.read().saver, false);
  payload.writeUInt32LE(1, 20);
  notify(0x8013, payload);
  assert.equal(battery.read().saver, true);
  assert.equal(battery.setMode('balanced'), false);
  assert.equal(writes, 0);
  payload.writeUInt32LE(2, 20);
  notify(0x8013, payload);
  assert.equal(battery.read().saver, true);
  payload.writeUInt32LE(0, 20);
  notify(0x8013, payload);
  assert.equal(battery.read().saver, false);
  assert.equal(changes, 2);
  stop();
  assert.equal(notify, null);
});

test('time to full requires a charging report with current capacity and a positive charging rate', () => {
  const report = { Status: 'Charging', FullChargeCapacityInMilliwattHours: 45000,
    RemainingCapacityInMilliwattHours: 35000, ChargeRateInMilliwatts: 20000 };
  assert.equal(estimateChargeTime(report), 1800);
  assert.equal(estimateChargeTime({ ...report, Status: 'NotPresent' }), null);
  assert.equal(estimateChargeTime({ ...report, ChargeRateInMilliwatts: -20000 }), null);
  assert.equal(estimateChargeTime({ ...report, RemainingCapacityInMilliwattHours: null }), null);
});

test('only known settings targets launch fixed Windows URIs', async () => {
  const uris = [];
  const shell = { openExternal: async (uri) => uris.push(uri) };
  assert.equal(await openPowerSettings(shell, 'power'), true);
  assert.equal(await openPowerSettings(shell, 'saver'), true);
  assert.equal(await openPowerSettings(shell, 'file:///anything'), false);
  assert.deepEqual(uris, ['ms-settings:powersleep', 'ms-settings:batterysaver']);
});

test('battery panel retains its power mode control and discards a pending refresh on unmount', async () => {
  const nodes = [];
  function h(tag, attrs, ...children) {
    const el = { tag, attrs, children, dataset: {}, style: { setProperty() {} }, textContent: '',
      append(...kids) { children.push(...kids); }, replaceChildren() {}, setAttribute() {} };
    nodes.push(el);
    return el;
  }
  let tick, complete;
  const ctx = vm.createContext({ h, icon: () => ({}), body: h('body'), title() {},
    setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { tick = null; },
    api: { invoke: () => new Promise((resolve) => { complete = resolve; }) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'battery-panel.js'), 'utf8'), ctx);
  const unmount = vm.runInContext('mountBatteryPanel(body, title)', ctx);
  complete({ present: false, pluggedIn: true, mode: 'balanced' });
  await new Promise(setImmediate);
  const select = nodes.find((el) => el.tag === 'select');
  const initialNodeCount = nodes.length;
  assert.equal(select.value, 'balanced');
  const refresh = tick();
  complete({ present: false, pluggedIn: true, mode: 'efficiency' });
  await refresh;
  assert.equal(nodes.length, initialNodeCount);
  assert.equal(select.value, 'efficiency');
  const pending = tick();
  unmount();
  assert.equal(tick, null);
  complete({ present: false, pluggedIn: true, mode: 'performance' });
  await pending;
  assert.equal(select.value, 'efficiency');
});
