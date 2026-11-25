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
    const { wide, narrow, tab, restored, width, groups, actions, tightTab, fullCenter } = JSON.parse(stdout);
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
    assert.ok(groups.titles.includes('Window 8 — notes and research'));
    assert.ok(!groups.titles.includes('Window 1 — notes and research'), 'visible apps are not duplicated in overflow');
    assert.equal(groups.label, 'Editor.exe: 2 windows');
    assert.deepEqual(groups.nested, ['Window 9 — notes and research', 'Window 10 — notes and research']);
    assert.equal(groups.icons, groups.titles.length);
    assert.deepEqual(actions, ['close', [10, 'focus'], 'close'], 'selection closes before focus, and Escape closes');
    assert.equal(tightTab.moreVisible, true, `Overflow button must fit in the selected tab: ${JSON.stringify(tightTab)}`);
    assert.equal(fullCenter.moreVisible, true, `Centered overflow button must fit in the full bar: ${JSON.stringify(fullCenter)}`);
    assert.equal(fullCenter.moreClickable, true, `Right widgets must not cover centered overflow: ${JSON.stringify(fullCenter)}`);
    assert.equal(fullCenter.rightFits, true);
  });
}

async function measureDock() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const src = path.join(__dirname, '..', 'src');
  await app.whenReady();
  const windows = Array.from({ length: 10 }, (_, i) => ({
    hwnd: i + 1, exe: i < 8 ? `App${i + 1}.exe` : 'Editor.exe', title: `Window ${i + 1} — notes and research`,
    icon: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  }));
  const actions = [];
  let width, entries, onClose, onFocus;
  ipcMain.handle('init', () => ({
    settings: {
      layout: 'pill', groupWindows: true, showLabels: true, pinned: [], left: ['apps'], center: [], right: [],
      customTabs: [{ id: 'work', name: 'Work', items: [{ id: 'apps', kind: 'widget', widget: 'apps' }] }],
    },
    data: {},
    state: { windows, windowAppOrder: [...new Set(windows.map((w) => w.exe.toLowerCase()))] },
  }));
  ipcMain.handle('bar:width', (_event, demand) => { width = demand; });
  ipcMain.handle('panel:toggle', (_event, widget, _anchor, items) => {
    assert.equal(widget, 'overflow');
    entries = items;
  });
  ipcMain.handle('panel:overflow', () => entries);
  ipcMain.handle('panel:close', () => { actions.push('close'); onClose?.(); });
  ipcMain.handle('win:action', (_event, ...args) => { actions.push(args); onFocus?.(); });
  const webPreferences = { preload: path.join(src, 'preload.js'), backgroundThrottling: false };
  const win = new BrowserWindow({
    width: 1700, height: 140, show: false, webPreferences,
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
  await win.webContents.executeJavaScript("showAppOverflow(document.querySelector('.apps'), document.querySelector('.app-more'))");
  win.setContentSize(1700, 140);
  const restored = await measure();
  const restoredWidth = width;
  const panel = new BrowserWindow({ show: false, webPreferences });
  await panel.loadFile(path.join(src, 'renderer', 'panel.html'), { query: { widget: 'overflow' } });
  const groups = await panel.webContents.executeJavaScript(`new Promise(resolve => {
    const check = () => {
      const group = document.querySelector('.overflow-group');
      if (!document.querySelector('#panel.enter') || !group) return requestAnimationFrame(check);
      resolve({
        label: group.getAttribute('aria-label'),
        titles: [...document.querySelectorAll('.overflow-row')].map(row => row.title),
        nested: [...group.querySelectorAll('.overflow-nested button')].map(row => row.title),
        icons: document.querySelectorAll('.overflow-row img').length,
      });
    };
    check();
  })`);
  const focused = new Promise(resolve => { onFocus = resolve; });
  await panel.webContents.executeJavaScript("document.querySelector('.overflow-nested button:last-child').click()");
  await focused;
  const closed = new Promise(resolve => { onClose = resolve; });
  await panel.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
  await closed;
  win.setContentSize(332, 140);
  const tightTab = await win.webContents.executeJavaScript(`(async () => {
    OB.settings.right = ['search', 'desktop', 'clock', 'quick', 'start', 'system'];
    render();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const left = document.getElementById('left');
    const more = left.querySelector('.app-more');
    const tile = more.getBoundingClientRect(), zone = left.getBoundingClientRect();
    return { zoneWidth: left.clientWidth, moreVisible: !more.hidden && tile.width > 0 && tile.right <= zone.right + 1 };
  })()`);
  const fullCenter = await win.webContents.executeJavaScript(`(async () => {
    Object.assign(OB.settings, { layout: 'full', customTabs: [], left: [], center: ['apps'], right: ['search', 'desktop'] });
    applyTheme();
    render();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const center = document.getElementById('center');
    const more = center.querySelector('.app-more');
    const tile = more.getBoundingClientRect(), bar = document.getElementById('bar').getBoundingClientRect();
    const rightWidget = document.querySelector('#right .w').getBoundingClientRect();
    return { zoneWidth: center.clientWidth, barWidth: bar.width,
      moreVisible: !more.hidden && tile.width > 0 && tile.left >= bar.left && tile.right <= bar.right,
      moreClickable: document.elementFromPoint(tile.x + tile.width / 2, tile.y + tile.height / 2) === more,
      rightFits: rightWidget.left >= tile.right && rightWidget.right <= bar.right };
  })()`);
  return { wide, narrow, tab, restored: { ...restored, width: restoredWidth }, width: naturalWidth, groups, actions, tightTab, fullCenter };
}
