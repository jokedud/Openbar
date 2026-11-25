'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { decodeStatus, estimateChargeTime, openPowerSettings } = require('../src/main/battery');

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
