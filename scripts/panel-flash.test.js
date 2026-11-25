'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const electron = require('electron');

function runElectronProbe() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-panel-flash-'));
  const probe = `
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.setPath('userData', ${JSON.stringify(userData)});
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const settings = {
    theme: 'dark', accent: '#6c91ff', glass: 'off', position: 'bottom', height: 54, margin: 6,
    worldClocks: [], calendars: [], commands: [], pomodoro: { focusMin: 25, breakMin: 5 },
    github: { user: '' }, crypto: { currency: 'usd' },
  };
  const state = {
    system: { cpu: 29, cores: 16, cpuModel: 'Test CPU', memUsed: 8e9, memTotal: 16e9, uptime: 3600 },
    disk: { drive: 'C:\\\\', free: 90e9, used: 860e9, total: 950e9 },
    net: { down: 100, up: 50, online: true },
    errors: {},
  };
  const readySeqs = [];
  const boundsEvents = [];
  const systemCalls = [];
  ipcMain.handle('init', () => ({ settings, data: {}, state, platform: 'win32' }));
  ipcMain.handle('system', (_e, action) => { systemCalls.push(action); });
  ipcMain.handle('wifi:status', () => ({ supported: true, interfaces: [], radios: [] }));
  ipcMain.handle('wifi:state', () => ({ state: 'connected', ssid: 'TestWiFi', adapters: [] }));
  ipcMain.handle('wifi:subscribe', () => true);
  ipcMain.handle('wifi:unsubscribe', () => true);
  ipcMain.on('panel:ready', (_e, seq) => readySeqs.push(seq));
  ipcMain.on('surface:bounds', (_e, b) => boundsEvents.push(b));
  ipcMain.on('surface:mouse', () => {});

  const win = new BrowserWindow({
    width: 408, height: 468, show: false, frame: false,
    webPreferences: { preload: path.join(process.cwd(), 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(process.cwd(), 'src', 'renderer', 'panel.html'), { query: { widget: 'system' } });
  await new Promise((r) => setTimeout(r, 150));

  await win.webContents.executeJavaScript(\`
    window.__probe = { bodyAnimStarts: 0 };
    window.__cpuCard = document.querySelector('#body .card');
    window.__headBtn = document.querySelector('#actions button');
    document.getElementById('body').addEventListener('animationstart', (e) => {
      if (e.animationName === 'rise') window.__probe.bodyAnimStarts++;
    });
  \`);

  // Unrelated net tick should not redraw or replay animations.
  win.webContents.send('state', { net: { down: 4200, up: 300, online: true } });
  await new Promise((r) => setTimeout(r, 50));

  // System tick updates CPU in place without detaching cards or replaying rise animation.
  win.webContents.send('state', {
    system: { cpu: 47, cores: 16, cpuModel: 'Test CPU', memUsed: 9e9, memTotal: 16e9, uptime: 3602 },
  });
  await new Promise((r) => setTimeout(r, 80));

  const afterTick = await win.webContents.executeJavaScript(\`(() => {
    const cpuCard = document.querySelector('#body .card');
    const headBtn = document.querySelector('#actions button');
    headBtn.click();
    return {
      sameCpuCard: cpuCard === window.__cpuCard,
      sameHeadBtn: headBtn === window.__headBtn,
      cpuText: cpuCard.textContent,
      hasEnterBody: document.getElementById('panel').classList.contains('enter-body'),
      bodyAnimStarts: window.__probe.bodyAnimStarts,
    };
  })()\`);

  // Switch panel to network off-screen (matching main.js) and verify panel:ready arrives after paint.
  const boundsBeforeSwitch = boundsEvents.length;
  const readyPromise = new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    ipcMain.once('panel:ready', () => { clearTimeout(timer); resolve(); });
  });
  win.setPosition(-2000, 0);
  win.showInactive();
  win.webContents.send('panel:widget', 'network', 7);
  await readyPromise;
  const afterSwitch = await win.webContents.executeJavaScript(\`(() => ({
    widgetAttr: document.getElementById('panel').dataset.widget,
    title: document.getElementById('title').textContent,
    hasNetworkPanel: !!document.querySelector('#body .wifi-pop'),
    hasSystemCpu: document.getElementById('body').textContent.includes('Test CPU'),
  }))()\`);

  process.stdout.write(JSON.stringify({
    afterTick,
    afterSwitch,
    systemCalls,
    readySeqs,
    boundsSentOnSwitch: boundsEvents.length > boundsBeforeSwitch,
  }));
  win.destroy();
  app.quit();
});
`;
  const scriptFile = path.join(os.tmpdir(), `openbar-panel-flash-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(scriptFile, probe, 'utf8');
  try {
    const out = execFileSync(electron, [scriptFile], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
    });
    return JSON.parse(out.slice(out.indexOf('{')));
  } finally {
    try { fs.unlinkSync(scriptFile); } catch (_) {}
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('widget panels patch live updates without flashing and switch DOM before panel:ready', () => {
  const r = runElectronProbe();
  assert.equal(r.afterTick.sameCpuCard, true, 'system panel card should be patched in place across ticks');
  assert.equal(r.afterTick.sameHeadBtn, true, 'panel header action button should stay attached across ticks');
  assert.match(r.afterTick.cpuText, /47%/, 'system panel should reflect updated CPU percentage');
  assert.equal(r.afterTick.hasEnterBody, false, 'live update should clear enter-body class');
  assert.equal(r.afterTick.bodyAnimStarts, 0, 'live state updates should not replay rise entrance animation');
  assert.deepEqual(r.systemCalls, ['taskmgr'], 'patched header button should keep working click handler');
  assert.equal(r.afterSwitch.widgetAttr, 'network');
  assert.equal(r.afterSwitch.title, 'Network');
  assert.equal(r.afterSwitch.hasNetworkPanel, true);
  assert.equal(r.afterSwitch.hasSystemCpu, false, 'stale System panel DOM should be gone after switch');
  assert.deepEqual(r.readySeqs, [7], 'panel:ready should signal with the switch sequence number');
  assert.equal(r.boundsSentOnSwitch, true, 'panel switch should resync surface bounds before showing');
});
