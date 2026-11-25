'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

if (process.versions.electron) {
  verifyPanel().then(() => process.exit(0), (error) => {
    process.stderr.write(error.stack + '\n', () => process.exit(1));
  });
} else {
  require('node:test').test('Network panel preserves focus, shows confirmed Wi-Fi state and disposes when hidden', async () => {
    await promisify(execFile)(require('electron'), [__filename], { timeout: 30000 });
  });
}

async function verifyPanel() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const src = path.join(__dirname, '..', 'src');
  let status = { radio: 'on', connected: true, canToggle: true };
  let reads = 0, releaseRead, deferRead = false, releaseWrite;
  const opened = [];
  let closed = false;
  app.commandLine.appendSwitch('force-prefers-reduced-motion');
  await app.whenReady();
  ipcMain.handle('init', () => ({ settings: {}, data: {}, state: { net: { down: 1024, up: 0 } } }));
  ipcMain.handle('wifi:status', () => {
    reads++;
    return deferRead ? new Promise((resolve) => { releaseRead = resolve; }) : status;
  });
  ipcMain.handle('wifi:set-radio', (_e, enabled) => new Promise((resolve) => {
    assert.equal(enabled, false);
    releaseWrite = () => {
      status = { radio: 'off', connected: false, canToggle: true };
      resolve(true);
    };
  }));
  ipcMain.handle('wifi:open', (_e, target) => { opened.push(target); return target === 'settings'; });
  ipcMain.handle('panel:close', () => { closed = true; });
  const win = new BrowserWindow({
    show: false, webPreferences: { preload: path.join(src, 'preload.js'), backgroundThrottling: false },
  });
  const run = (code) => win.webContents.executeJavaScript(code);
  const wait = async (condition) => {
    for (let i = 0; i < 80; i++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Condition timed out: ${condition}`);
  };
  const send = (...args) => win.webContents.send(...args);
  await win.loadFile(path.join(src, 'renderer', 'panel.html'), { query: { widget: 'network' } });
  await wait(() => run('document.querySelector(".wifi-hero")?.dataset.radio === "on"'));
  assert.equal(await run('getComputedStyle(document.getElementById("panel")).animationName'), 'none');
  await run('document.querySelector(".wifi-discover").click()');
  await wait(() => run('document.querySelector(".wifi-message").textContent.includes("Could not open")'));
  assert.deepEqual(opened, ['networks']);
  await run('document.querySelector(".wifi-toggle").focus(); document.querySelector(".wifi-toggle").click()');
  await wait(() => releaseWrite);
  send('state', { net: { down: 2048, up: 512 } });
  await wait(() => run('document.querySelector(".wifi-traffic").textContent.includes("512 B/s")'));
  assert.equal(await run('document.activeElement.getAttribute("aria-checked")'), 'true');
  releaseWrite();
  await wait(() => run('document.activeElement.getAttribute("aria-checked") === "false"'));
  assert.equal(await run('document.querySelector(".wifi-discover").getAttribute("aria-disabled")'), 'true');

  deferRead = true;
  send('panel:widget', 'network');
  await wait(() => releaseRead);
  send('panel', null);
  // Simulate a late native read after the invisible, retained panel has closed.
  await wait(() => run('networkPanel === null'));
  releaseRead(status);
  assert.equal(await run('document.querySelector(".wifi-hero").dataset.radio'), 'loading');
  const countAtClose = reads;
  await new Promise((resolve) => setTimeout(resolve, 4100));
  assert.equal(reads, countAtClose);

  deferRead = false;
  status = { radio: 'unavailable', connected: false, canToggle: false };
  send('panel:widget', 'network');
  await wait(() => run('document.querySelector(".wifi-hero").dataset.radio === "unavailable"'));
  assert.equal(await run('getComputedStyle(document.querySelector(".wifi-toggle")).display'), 'none');
  assert.equal(await run('getComputedStyle(document.querySelector(".wifi-discover")).display'), 'none');
  await run('document.querySelector(".wifi-settings").click()');
  await wait(() => closed);
  assert.deepEqual(opened, ['networks', 'settings']);
  send('panel:widget', 'clock');
  await wait(() => run('document.getElementById("panel").dataset.widget === "clock" && networkPanel === null'));
}
