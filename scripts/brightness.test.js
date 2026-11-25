'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { registerBrightnessIpc, runBrightness } = require('../src/main/brightness');

test('brightness accepts only valid readings and keeps zero distinct from unavailable', async () => {
  assert.deepEqual(await runBrightness(undefined, async () => ({ stdout: '{"level":0}' })), { level: 0, failed: false });
  for (const stdout of ['', '{}', '{"level":"50"}', '{"level":101}', '{"level":null}']) {
    assert.deepEqual(await runBrightness(undefined, async () => ({ stdout })), { level: null, failed: false });
  }
  assert.deepEqual(await runBrightness(62, async () => { throw new Error('timeout'); }), { level: null, failed: true });
  assert.deepEqual(await runBrightness('62', () => assert.fail('invalid values must not spawn PowerShell')), { level: null, failed: true });
});

test('brightness settings IPC opens only fixed Windows pages for the active widget', async () => {
  const handlers = new Map(), opened = [], active = {}, inactive = {};
  registerBrightnessIpc({ handle: (channel, handler) => handlers.set(channel, handler) },
    { openExternal: async (url) => opened.push(url) }, (event) => event === active, true);
  const settings = handlers.get('brightness:settings');
  assert.equal(await settings(inactive, 'display'), false);
  assert.equal(await settings(active, 'constructor'), false);
  assert.equal(await settings(active, 'ms-settings:privacy'), false);
  assert.deepEqual(await handlers.get('brightness:set')(inactive, 37), { level: null, failed: false });
  assert.equal(await settings(active, 'display'), true);
  assert.equal(await settings(active, 'nightlight'), true);
  assert.deepEqual(opened, ['ms-settings:display', 'ms-settings:nightlight']);
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
    assert.deepEqual(await runBrightness(undefined, fixture(0)), { level: 20, failed: false });
    assert.deepEqual(await runBrightness(70, fixture(0)), { level: 73, failed: false });
    assert.deepEqual(await runBrightness(70, fixture(1)), { level: 20, failed: true });
  });
