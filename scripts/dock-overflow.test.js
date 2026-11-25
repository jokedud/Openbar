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
    const { wide, narrow, tab, restored, width, groups, actions, tightTab, fullCenter, crowded, tabFolder } = JSON.parse(stdout);
    assert.equal(wide.more, false);
    assert.equal(wide.labels, true);
    assert.ok(wide.firstTile > narrow.firstTile);
    assert.equal(narrow.more, true);
    assert.equal(narrow.labels, false);
    assert.equal(narrow.preview, 4);
    assert.match(narrow.badge, /^\+\d+$/);
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
    assert.equal(groups.columns, 3);
    assert.equal(groups.opened, true);
    assert.deepEqual(actions, ['close', [10, 'focus'], 'close'], 'selection closes before focus, and Escape closes');
    assert.equal(tightTab.moreVisible, true, `Overflow button must fit in the selected tab: ${JSON.stringify(tightTab)}`);
    assert.equal(tightTab.rightFits, true, `Right controls must stay inside a crowded pill: ${JSON.stringify(tightTab)}`);
    assert.equal(tightTab.lastControlReachable, true, 'Scrolling the right zone reaches its last control');
    assert.equal(fullCenter.moreVisible, true, `Centered overflow button must fit in the full bar: ${JSON.stringify(fullCenter)}`);
    assert.equal(fullCenter.moreClickable, true, `Right widgets must not cover centered overflow: ${JSON.stringify(fullCenter)}`);
    assert.equal(fullCenter.rightFits, true);
    for (const [mode, result] of Object.entries(crowded)) {
      assert.equal(result.moreClickable && result.zonesFit, true, `${mode}: ${JSON.stringify(result)}`);
      assert.equal(result.opened, true, `${mode}: More apps opens with hidden windows`);
    }
    assert.equal(tabFolder.visible, true);
    assert.equal(tabFolder.preview, 4);
    assert.match(tabFolder.badge, /^\+\d+$/);
    assert.equal(tabFolder.title, 'More tabs');
    assert.deepEqual(tabFolder.shown, tabFolder.clipped);
    assert.equal(tabFolder.selected, 'tab-12');
    assert.equal(tabFolder.scrolled, true);
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
  let width, entries, onClose, onFocus, onOverflow, onTabs;
  let customTabs = [{ id: 'work', name: 'Work', items: [{ id: 'apps', kind: 'widget', widget: 'apps' }] }];
  ipcMain.handle('init', () => ({
    settings: {
      layout: 'pill', groupWindows: true, showLabels: true, pinned: [], left: ['apps'], center: [], right: [],
      customTabs,
    },
    data: {},
    state: { windows, windowAppOrder: [...new Set(windows.map((w) => w.exe.toLowerCase()))] },
  }));
  ipcMain.handle('bar:width', (_event, demand) => { width = demand; });
  ipcMain.handle('panel:toggle', (_event, widget, _anchor, items) => {
    assert.ok(widget === 'overflow' || widget === 'tabOverflow');
    entries = items;
    if (widget === 'overflow') onOverflow?.(items);
    else onTabs?.(items);
  });
  ipcMain.handle('panel:overflow', () => entries);
  ipcMain.handle('panel:close', () => { actions.push('close'); onClose?.(); });
  ipcMain.handle('win:action', (_event, ...args) => { actions.push(args); onFocus?.(); });
  const webPreferences = { preload: path.join(src, 'preload.js'), backgroundThrottling: false };
  const win = new BrowserWindow({
    width: 1700, height: 140, show: false, webPreferences,
  });
  ipcMain.handle('panel:select-tab', (_event, id) => { win.webContents.send('bar:select-tab', id); });
  await win.loadFile(path.join(src, 'renderer', 'bar.html'));
  const measure = () => win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const label = document.querySelector('.app .label');
    const button = document.querySelector('.app-more');
    resolve({
      more: !button.hidden,
      preview: button.firstElementChild.childElementCount,
      badge: button.lastElementChild.textContent,
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
      group.firstElementChild.click();
      const entries = [...document.querySelectorAll('button.overflow-cell, .overflow-row')];
      resolve({
        label: group.getAttribute('aria-label'),
        titles: entries.map(row => row.title),
        nested: [...group.querySelectorAll('.overflow-nested button')].map(row => row.title),
        icons: entries.filter(row => row.querySelector('img')).length,
        columns: getComputedStyle(group.parentElement).gridTemplateColumns.split(' ').length,
        opened: group.open,
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
    const right = document.getElementById('right');
    const rightBounds = right.getBoundingClientRect(), bar = document.getElementById('bar').getBoundingClientRect();
    right.lastElementChild.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 800 }));
    return { zoneWidth: left.clientWidth, moreVisible: !more.hidden && tile.width > 0 && tile.right <= zone.right + 1,
      rightFits: rightBounds.width > 0 && rightBounds.right <= bar.right,
      lastControlReachable: right.scrollLeft > 0 && right.lastElementChild.getBoundingClientRect().right <= rightBounds.right + 1 };
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
      moreClickable: more.contains(document.elementFromPoint(tile.x + tile.width / 2, tile.y + tile.height / 2)),
      rightFits: rightWidget.left >= tile.right && rightWidget.right <= bar.right };
  })()`);
  const crowded = {};
  for (const [mode, layout, zone] of [
    ['centered full-width', 'full', 'center'],
    ['default full-width', 'full', 'left'],
    ['default pill', 'pill', 'right'],
    ['selected pill tab', 'pill', 'left'],
    ['selected full-width tab', 'full', 'left'],
  ]) {
    const widgets = ['search', 'desktop', 'clock', 'quick', 'start', 'system'];
    const settings = { layout, left: widgets, center: widgets, right: widgets };
    settings[zone] = [...widgets, 'apps', 'volume'];
    if (mode.startsWith('selected')) {
      settings.customTabs = [{
        id: 'work', name: 'Work', items: settings.left.map((widget) => ({ id: widget, kind: 'widget', widget })),
      }];
    } else settings.customTabs = [];
    let opened = false;
    onOverflow = (items) => { opened = items.some(({ hwnds }) => hwnds.length); };
    const result = await win.webContents.executeJavaScript(`(async () => {
      Object.assign(OB.settings, ${JSON.stringify(settings)});
      applyTheme();
      render();
      document.querySelector('[data-tab=work]')?.click();
      render();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bar = document.getElementById('bar').getBoundingClientRect();
      const zones = [...document.querySelector('#bar').children].map(el => el.getBoundingClientRect());
      const more = document.querySelector('.app-more');
      const tile = more.getBoundingClientRect();
      const hit = document.elementFromPoint(tile.x + tile.width / 2, tile.y + tile.height / 2);
      const moreClickable = !more.hidden && tile.width > 0 && tile.left >= bar.left &&
        tile.right <= bar.right && more.contains(hit);
      if (moreClickable) await showAppOverflow(more.previousElementSibling, more);
      return { moreClickable, zonesFit: zones.every((z) => z.left >= bar.left && z.right <= bar.right),
        tileLeft: tile.left, tileRight: tile.right, barRight: bar.right };
    })()`);
    crowded[mode] = { ...result, opened };
  }
  customTabs = Array.from({ length: 12 }, (_, i) => ({ id: `tab-${i + 1}`, name: `Workspace ${i + 1}`, items: [] }));
  const clipped = new Promise(resolve => { onTabs = resolve; });
  const tabPreview = await win.webContents.executeJavaScript(`(async () => {
    OB.settings.customTabs = ${JSON.stringify(customTabs)};
    render();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const button = document.querySelector('.tab-more');
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const visible = !button.hidden && button.contains(hit);
    if (visible) button.click();
    return { visible, preview: button.firstElementChild.childElementCount, badge: button.lastElementChild.textContent };
  })()`);
  const tabItems = tabPreview.visible ? await clipped : [];
  const tabPanel = new BrowserWindow({ show: false, webPreferences });
  await tabPanel.loadFile(path.join(src, 'renderer', 'panel.html'), { query: { widget: 'tabOverflow' } });
  const tabGrid = await tabPanel.webContents.executeJavaScript(`new Promise(resolve => {
    const check = () => {
      if (!document.querySelector('#panel.enter')) return requestAnimationFrame(check);
      const cells = [...document.querySelectorAll('button.overflow-cell')];
      cells.find(cell => cell.title === 'Workspace 12')?.click();
      resolve({ title: document.getElementById('title').textContent, shown: cells.map(cell => cell.title) });
    };
    check();
  })`);
  const tabState = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const strip = document.querySelector('.tab-strip');
    strip.firstElementChild.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 160 }));
    resolve({ selected: document.getElementById('bar').dataset.customTab, scrolled: strip.scrollLeft > 0 });
  })))`);
  const tabFolder = { ...tabPreview, ...tabGrid, ...tabState,
    clipped: tabItems.map(({ id }) => customTabs.find((tab) => tab.id === id)?.name || 'Default widgets') };
  return { wide, narrow, tab, restored: { ...restored, width: restoredWidth }, width: naturalWidth,
    groups, actions, tightTab, fullCenter, crowded, tabFolder };
}
