'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createVolume, volumeChange } = require('../src/main/volume');
const { volumeLayoutMigration } = require('../src/main/volume-layout');

test('volume migration preserves zone order, existing placement and later removal', () => {
  const settings = { left: ['apps'], center: ['clock'], right: ['quick', 'custom'] };
  const patch = volumeLayoutMigration(settings);
  assert.deepEqual(patch, { volumeWidgetMigrated: true, right: ['quick', 'custom', 'volume'] });
  assert.deepEqual(settings.right, ['quick', 'custom']);
  assert.deepEqual(volumeLayoutMigration({ ...settings, left: ['volume', 'apps'] }), { volumeWidgetMigrated: true });
  assert.equal(volumeLayoutMigration({ ...settings, ...patch, right: [] }), null);
});

test('volume IPC accepts only finite levels and explicit mute booleans', () => {
  assert.deepEqual(volumeChange('volume', -1), { volume: 0 });
  assert.deepEqual(volumeChange('volume', 200), { volume: 100 });
  assert.deepEqual(volumeChange('volume', 36.6), { volume: 37 });
  for (const value of [Infinity, NaN, null, '34', true]) assert.equal(volumeChange('volume', value), null);
  assert.deepEqual(volumeChange('mute', false), { muted: false });
  assert.equal(volumeChange('mute', 1), null);
  assert.equal(volumeChange('other', 0), null);
});

test('Core Audio applies changes to the default multimedia playback endpoint and reads them back', () => {
  const calls = [];
  let volume = 0.68, muted = 0, missing = false;
  const pointer = (methods) => methods.map((fn) => fn);
  const release = (self) => calls.push(self);
  const enumerator = pointer([null, null, release, null, (_, flow, role, device) => {
    assert.deepEqual([flow, role], [0, 1]);
    if (missing) return 0x80070490 | 0;
    device[0] = output;
    return 0;
  }]);
  const output = pointer([null, null, release, (_, _iid, _ctx, _params, result) => { result[0] = endpoint; return 0; }]);
  const endpoint = pointer([]);
  endpoint[2] = release;
  endpoint[7] = (_, scalar) => { volume = scalar; return 0; };
  endpoint[9] = (_, result) => { result[0] = volume; return 0; };
  endpoint[14] = (_, mute) => { muted = mute; return 0; };
  endpoint[15] = (_, result) => { result[0] = muted; return 0; };
  const ffi = {
    load: () => ({ func(signature) {
      if (signature.includes('CoInitializeEx')) return () => 1;
      if (signature.includes('CoUninitialize')) return () => calls.push('uninit');
      return (_clsid, _outer, _ctx, _iid, result) => { result[0] = enumerator; return 0; };
    } }),
    sizeof: () => 8,
    proto: (signature) => signature,
    decode: (ptr, offset) => typeof offset === 'number' ? ptr[offset / 8] : ptr,
    call: (fn, _type, ...args) => fn(...args),
  };
  const audio = createVolume(ffi);
  assert.deepEqual(audio(), { status: 'ready', volume: 68, muted: false });
  assert.deepEqual(calls.splice(0), [endpoint, output, enumerator, 'uninit']);
  assert.deepEqual(audio({ volume: 29 }), { status: 'ready', volume: 29, muted: false });
  assert.deepEqual(audio({ muted: true }), { status: 'ready', volume: 29, muted: true });
  assert.deepEqual(audio({ muted: false }), { status: 'ready', volume: 29, muted: false });
  calls.length = 0;
  missing = true;
  assert.deepEqual(audio({ volume: 10 }), { status: 'no-output' });
  assert.deepEqual(calls, [enumerator, 'uninit']);
  assert.equal(volume, 0.29);
});

const ready = (volume, muted = false) => ({ status: 'ready', volume, muted });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('volume panel keeps controls stable, ignores stale writes and unsubscribes on removal', async () => {
  const requests = [];
  const listeners = new Set();
  const emit = (volume) => listeners.forEach((fn) => fn('state', { volume }));
  function node(tag, attrs, ...children) {
    return {
      tag, ...attrs, children, dataset: {}, classList: { toggle() {} }, style: { setProperty() {} },
      textContent: children[0],
      append(...kids) { children.push(...kids); },
      addEventListener(type, fn) { this[type] = fn; },
      setAttribute(key, value) { this[key] = value; },
    };
  }
  const context = vm.createContext({
    h: node, icon: () => node('icon'),
    OB: { on(fn) { listeners.add(fn); return () => listeners.delete(fn); } },
    api: { invoke: (...args) => new Promise((resolve) => requests.push({ args, resolve })) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/volume-panel.js'), 'utf8'), context);
  const body = node('body');
  const stop = context.mountVolumePanel(body);
  const [card, settings] = body.children[0].children;
  const [status, controls] = card.children;
  const [mute, track, readout] = controls.children;
  const slider = track.children[0];
  assert.equal(slider.disabled, true);
  assert.equal(mute.disabled, true);
  assert.deepEqual(requests[0].args, ['volume:read']);
  requests.shift().resolve({ status: 'no-output' });
  await flush();
  assert.match(status.textContent, /No audio output device/);
  assert.equal(readout.textContent, '—');
  assert.equal(slider.disabled, true);
  settings.onclick();
  assert.deepEqual(requests.shift().args, ['open', 'ms-settings:sound']);
  emit(ready(45));
  assert.equal(slider.disabled, false);
  assert.equal(slider.value, 45);
  slider.value = '48'; slider.input();
  slider.value = '55'; slider.input();
  const old = requests.shift(), latest = requests.shift();
  assert.deepEqual(old.args, ['volume:change', 'volume', 48]);
  assert.deepEqual(latest.args, ['volume:change', 'volume', 55]);
  latest.resolve(ready(55));
  await flush();
  old.resolve(ready(48));
  await flush();
  assert.equal(slider.value, 55);
  assert.strictEqual(track.children[0], slider);
  mute.click();
  const pending = requests.shift();
  assert.deepEqual(pending.args, ['volume:change', 'mute', true]);
  assert.equal(mute['aria-pressed'], 'true');
  stop();
  assert.equal(listeners.size, 0);
  pending.resolve(ready(60, false));
  await flush();
  assert.equal(slider.value, 55);
  assert.equal(mute['aria-pressed'], 'true');
});
