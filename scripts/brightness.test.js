'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { test } = require('node:test');
const vm = require('node:vm');
const { registerBrightnessIpc, runBrightness } = require('../src/main/brightness');

test('brightness accepts only valid readings and keeps zero distinct from unavailable', async () => {
  assert.deepEqual(await runBrightness(undefined, async () => ({ stdout: '{"level":0,"levels":[25,-1,0,25,"50"]}' })),
    { level: 0, levels: [0, 25], failed: false });
  for (const stdout of ['', '{}', '{"level":"50"}', '{"level":101}', '{"level":null}']) {
    assert.deepEqual(await runBrightness(undefined, async () => ({ stdout })), { level: null, levels: [], failed: false });
  }
  assert.deepEqual(await runBrightness(62, async () => { throw new Error('timeout'); }), { level: null, levels: [], failed: true });
  assert.deepEqual(await runBrightness('62', () => assert.fail('invalid values must not spawn PowerShell')), { level: null, levels: [], failed: true });
});

test('brightness settings IPC opens only fixed Windows pages for the active widget', async () => {
  const handlers = new Map(), opened = [], active = {}, inactive = {};
  registerBrightnessIpc({ handle: (channel, handler) => handlers.set(channel, handler) },
    { openExternal: async (url) => opened.push(url) }, (event) => event === active, true);
  const settings = handlers.get('brightness:settings');
  assert.equal(await settings(inactive, 'display'), false);
  assert.equal(await settings(active, 'constructor'), false);
  assert.equal(await settings(active, 'ms-settings:privacy'), false);
  assert.deepEqual(await handlers.get('brightness:set')(inactive, 37), { level: null, levels: [], failed: false });
  assert.equal(await settings(active, 'display'), true);
  assert.equal(await settings(active, 'nightlight'), true);
  assert.deepEqual(opened, ['ms-settings:display', 'ms-settings:nightlight']);
});

test('separate arrow presses advance through coarse hardware brightness levels', async () => {
  const levels = [0, 20, 75, 100], writes = [];
  let slider, timer;
  const h = (tag) => {
    const events = {};
    const node = { events, dataset: {}, style: { setProperty() {} }, append() {},
      addEventListener: (kind, fn) => { events[kind] = fn; } };
    if (tag === 'input') slider = node;
    return node;
  };
  const file = path.join(__dirname, '../src/renderer/brightness-panel.js');
  const context = vm.createContext({
    h, icon() {}, document: { addEventListener() {} }, body: h('div'),
    api: { invoke: async (channel, value) => {
      if (channel === 'brightness:get') return { level: 20, levels };
      writes.push(value);
      return { level: value === 75 ? 73 : value === 21 ? 20 : value, levels };
    } },
    setTimeout: (fn) => { timer = fn; },
    clearTimeout: () => { timer = undefined; },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nmountBrightness(body);', context);
  await new Promise(setImmediate);
  async function press(key, delta) {
    let handled = false;
    slider.events.keydown?.({ key, preventDefault: () => { handled = true; } });
    if (!handled) {
      slider.valueAsNumber = Number(slider.value) + delta;
      slider.events.input();
    }
    await timer();
  }
  await press('ArrowRight', 1);
  await press('ArrowUp', 1);
  await press('ArrowDown', -1);
  assert.deepEqual(writes, [75, 100, 75]);
});

test('Windows brightness pairs active WMI instances and returns hardware readback, not the requested number',
  { skip: process.platform !== 'win32' }, async () => {
    const exec = promisify(execFile);
    const fixture = (returnValue) => async (file, args, options) => {
      const prefix = `
function Get-CimInstance($Namespace, $ClassName, $InputObject) {
  if ($InputObject) { return @{ CurrentBrightness = 73 } }
  if ($ClassName -eq 'WmiMonitorBrightness') {
    @{ Active = $false; InstanceName = 'disconnected'; CurrentBrightness = 10 }
    @{ Active = $true; InstanceName = 'panel'; CurrentBrightness = 20; Level = @(0,20,75,100) }
  } elseif ($ClassName -eq 'WmiMonitorBrightnessMethods') {
    @{ Active = $true; InstanceName = 'another display' }
    @{ Active = $true; InstanceName = 'panel' }
  }
}
function Invoke-CimMethod($InputObject, $MethodName, $Arguments) {
  if ($InputObject.InstanceName -ne 'panel' -or $MethodName -ne 'WmiSetBrightness' -or $Arguments.Brightness -ne 75) {
    throw 'Wrong display or brightness level'
  }
  return @{ ReturnValue = ${returnValue} }
}
`;
      const command = prefix + Buffer.from(args.at(-1), 'base64').toString('utf16le');
      return exec(file, [...args.slice(0, -1), Buffer.from(command, 'utf16le').toString('base64')], options);
    };
    const levels = [0, 20, 75, 100];
    assert.deepEqual(await runBrightness(undefined, fixture(0)), { level: 20, levels, failed: false });
    assert.deepEqual(await runBrightness(70, fixture(0)), { level: 73, levels, failed: false });
    assert.deepEqual(await runBrightness(70, fixture(1)), { level: 20, levels, failed: true });
  });
