'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TrayApps, parseEntries, trayLayoutMigration } = require('../src/main/tray-apps');

const report = { Items: [
  { Id: 'tray:0', Name: 'Audio', AppName: 'Audio controls', Exe: 'C:\\audio.exe' },
  { Id: 'overflow:4', Name: 'Example app\r\nExtra status' },
  { Id: 'overflow:6', Name: 'OpenBar' },
  { Id: 'overflow:7', Name: 'Our secondary icon', OwnerPid: process.pid },
  { Id: 'overflow:8', Name: 'OpenBar', OwnerPid: process.pid + 1 },
  { Id: 'overflow:4', Name: 'Duplicate' },
  { Id: 'overflow:5', Name: ' ' },
  { Id: 'taskbar:1', Name: 'Unrelated control' },
  null,
] };

test('keeps named tray buttons, preserves the exact native name and displays its first line', () => {
  assert.deepEqual([...parseEntries(report)], [
    ['tray:0', { name: 'Audio', label: 'Audio controls', inOverflow: false, exe: 'C:\\audio.exe', icon: '' }],
    ['overflow:4', { name: 'Example app\r\nExtra status', label: 'Example app', inOverflow: true, exe: '', icon: '' }],
  ]);
  assert.equal(parseEntries(null).size, 0);
});

test('routes each gesture to the verified tray item and invalidates the list after activation', async () => {
  const calls = [];
  const tray = new TrayApps(async (input, onStart) => {
    if (!onStart()) return null;
    calls.push(input);
    return input.id ? { Clicked: true } : report;
  }, async (file) => file === 'C:\\audio.exe' ? 'file-icon' : '');
  const current = () => true;
  assert.deepEqual(await tray.list(current), [
    { id: 'tray:0', label: 'Audio controls', tooltip: 'Audio', inOverflow: false, icon: 'file-icon' },
    { id: 'overflow:4', label: 'Example app', tooltip: 'Example app\r\nExtra status', inOverflow: true, icon: '' },
  ]);
  assert.equal(await tray.activate('tray:99', 'menu', current), false);
  assert.equal(await tray.activate('overflow:4', 'menu', current), true);
  assert.equal(await tray.activate('overflow:4', 'open', current), false);
  assert.equal(await tray.list(() => false), null);
  await tray.list(current);
  assert.equal(await tray.activate('tray:0', 'open', current), true);
  assert.deepEqual(calls, [
    {}, { id: 'overflow:4', name: 'Example app\r\nExtra status', right: true },
    {}, { id: 'tray:0', name: 'Audio', right: false },
  ]);
});

test('uses the live tray image and a clean fallback when no application description is available', () => {
  const png = 'iVBORw0KGgoAAAANS';
  const entries = parseEntries({ Items: [
    { Id: 'overflow:0', Name: 'Docker Desktop is running in Resource Saver mode', IconPng: png },
    { Id: 'overflow:1', Name: 'UltraVNC Server - 192.0.2.1', IconPng: 'not-png' },
  ] });
  assert.equal(entries.get('overflow:0').label, 'Docker Desktop');
  assert.equal(entries.get('overflow:0').icon, `data:image/png;base64,${png}`);
  assert.equal(entries.get('overflow:1').label, 'UltraVNC Server');
  assert.equal(entries.get('overflow:1').icon, '');
});

test('adds the dock control once without moving an existing widget or restoring a removed one', () => {
  const settings = { left: ['start'], center: [], right: ['clock'], customTabs: [] };
  assert.deepEqual(trayLayoutMigration(settings), { trayAppsLayoutV1: true, right: ['clock', 'trayApps'] });
  assert.deepEqual(trayLayoutMigration({ ...settings, center: ['trayApps'] }), { trayAppsLayoutV1: true });
  assert.equal(trayLayoutMigration({ ...settings, trayAppsLayoutV1: true }), null);
});
