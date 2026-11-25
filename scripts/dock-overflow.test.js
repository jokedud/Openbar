'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

if (process.versions.electron) {
  measureDock().then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
  }, (error) => {
    process.stderr.write(error.stack + '\n', () => process.exit(1));
  });
} else {
  const test = require('node:test');

  test('dock and custom tabs compact apps, expose hidden windows and restore labels when they fit', async () => {
    const { stdout } = await promisify(execFile)(require('electron'), [__filename], { timeout: 30000 });
    const { wide, narrow, tab, restored, width, actions } = JSON.parse(stdout);
    assert.equal(wide.more, false);
    assert.equal(wide.labels, true);
    assert.ok(wide.firstTile > narrow.firstTile);
    assert.equal(narrow.more, true);
    assert.equal(narrow.labels, false);
    assert.equal(tab.more, true);
    assert.equal(tab.labels, false);
    assert.equal(restored.more, false);
    assert.equal(restored.labels, true);
    assert.equal(restored.width, width, 'pill width is based on uncompressed apps');
    assert.ok(actions.menu.some(({ id }) => id === 'w8'));
    assert.ok(actions.menu.every(({ id }) => id !== 'w1'), 'visible apps are not duplicated in the menu');
    assert.deepEqual(actions.menu.at(-1), { label: 'Editor.exe: 2 windows', submenu: [
      { id: 'w9', label: 'Window 9 — notes and research' },
      { id: 'w10', label: 'Window 10 — notes and research' },
    ] });
    assert.deepEqual(actions.focus, [10, 'focus']);
  });
}

async function measureDock() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const src = path.join(__dirname, '..', 'src');
  await app.whenReady();
  const windows = Array.from({ length: 10 }, (_, i) => ({
    hwnd: i + 1, exe: i < 8 ? `App${i + 1}.exe` : 'Editor.exe', title: `Window ${i + 1} — notes and research`,
  }));
  let actions = {}, width;
  ipcMain.handle('init', () => ({
    settings: {
      layout: 'pill', groupWindows: true, showLabels: true, pinned: [], left: ['apps'], center: [], right: [],
      customTabs: [{ id: 'work', name: 'Work', items: [{ id: 'apps', kind: 'widget', widget: 'apps' }] }],
    },
    data: {},
    state: { windows, windowAppOrder: [...new Set(windows.map((w) => w.exe.toLowerCase()))] },
  }));
  ipcMain.handle('bar:width', (_event, demand) => { width = demand; });
  ipcMain.handle('menu', (_event, items) => { actions.menu = items; return 'w10'; });
  ipcMain.handle('win:action', (_event, ...args) => { actions.focus = args; });
  const win = new BrowserWindow({
    width: 1700, height: 140, show: false,
    webPreferences: { preload: path.join(src, 'preload.js'), backgroundThrottling: false },
  });
  await win.loadFile(path.join(src, 'renderer', 'bar.html'));
  const measure = () => win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const label = document.querySelector('.app .label');
    resolve({
      more: !document.querySelector('.app-more').hidden,
      labels: getComputedStyle(label).display !== 'none',
      firstTile: label.parentElement.offsetWidth,
    });
  })))`);
  const wide = await measure();
  const naturalWidth = width;
  win.setContentSize(332, 140);
  const narrow = await measure();
  await win.webContents.executeJavaScript("document.querySelector('[data-tab=work]').click(); render()");
  const tab = await measure();
  await win.webContents.executeJavaScript("showAppOverflow(document.querySelector('.apps'))");
  win.setContentSize(1700, 140);
  const restored = await measure();
  return { wide, narrow, tab, restored: { ...restored, width }, width: naturalWidth, actions };
}
