'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

if (process.versions.electron) {
  runInteractionCheck().then((result) => {
    process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
  }, (error) => {
    process.stderr.write(`${error.stack}\n`, () => process.exit(1));
  });
} else {
  const test = require('node:test');
  const result = promisify(execFile)(require('electron'), [__filename], { timeout: 30000 })
    .then(({ stdout }) => JSON.parse(stdout));

  test('dock widget clicks and hover survive live state updates without detaching buttons', async () => {
    const r = await result;
    assert.equal(r.siblingClicks, 1, 'click on sibling weather widget should not be dropped when network updates');
    assert.equal(r.selfClicks, 1, 'click on network widget should not be dropped when its own rates update');
    assert.equal(r.appClicks, 1, 'click on app button should not be dropped when window title updates');
    assert.equal(r.sameWeatherNode, true, 'sibling weather button DOM node should stay attached');
    assert.equal(r.sameNetworkNode, true, 'updating network button DOM node should be patched in place');
    assert.equal(r.sameAppNode, true, 'updating app button DOM node should be patched in place');
    assert.equal(r.hoverLeaves, 0, 'hovered widget should not fire mouseleave across state renders');
    assert.equal(r.hoverPreserved, true, 'hover state on widget should remain active across state renders');
  });
}

async function runInteractionCheck() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const src = path.join(__dirname, '..', 'src');
  await app.whenReady();
  ipcMain.handle('init', () => ({
    settings: {
      layout: 'pill', position: 'bottom', style: 'glass', height: 54, margin: 10,
      left: ['start', 'apps'], center: [], right: ['weather', 'system', 'network', 'clock'],
      pinned: [], customTabs: [], groupWindows: true, showLabels: true,
    },
    data: {},
    state: {
      net: { down: 100, up: 50 },
      system: { cpu: 10, memUsed: 4, memTotal: 16 },
      windows: [{ hwnd: 42, title: 'Notepad - Draft 1', exe: 'notepad.exe', path: 'C:\\Windows\\notepad.exe', icon: '' }],
      windowAppOrder: ['c:\\windows\\notepad.exe'],
      activeHwnd: 0,
      recentHwnds: [],
    },
    platform: 'win32',
    version: '0.1.1',
  }));
  ipcMain.handle('bar:width', () => {});
  ipcMain.handle('panel:toggle', () => {});
  ipcMain.handle('win:action', () => {});

  const win = new BrowserWindow({
    x: 80, y: 80, width: 860, height: 120,
    frame: false, transparent: true, show: false, focusable: false, hasShadow: false,
    webPreferences: { preload: path.join(src, 'preload.js'), backgroundThrottling: false },
  });
  await win.loadFile(path.join(src, 'renderer', 'bar.html'));
  await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const anim = document.getElementById('bar').getAnimations()[0];
    if (anim) anim.finished.then(resolve);
    else resolve();
  })`);

  const pos = await win.webContents.executeJavaScript(`(() => {
    window.__clicks = { weather: 0, network: 0, app: 0 };
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-w="weather"]')) window.__clicks.weather++;
      if (e.target.closest('[data-w="network"]')) window.__clicks.network++;
      if (e.target.closest('button.app')) window.__clicks.app++;
    });
    window.__nodes = {
      weather: document.querySelector('[data-w="weather"]'),
      network: document.querySelector('[data-w="network"]'),
      app: document.querySelector('button.app'),
    };
    const center = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
    return {
      weather: center(window.__nodes.weather),
      network: center(window.__nodes.network),
      app: center(window.__nodes.app),
    };
  })()`);

  // 1. Click weather while network updates between mousedown and mouseup.
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pos.weather.x, y: pos.weather.y, button: 'left', clickCount: 1 });
  await win.webContents.executeJavaScript('OB.state.net = { down: 9999, up: 1234 }; render();');
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pos.weather.x, y: pos.weather.y, button: 'left', clickCount: 1 });

  // 2. Click network while its own rate updates between mousedown and mouseup.
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pos.network.x, y: pos.network.y, button: 'left', clickCount: 1 });
  await win.webContents.executeJavaScript('OB.state.net = { down: 5555, up: 4444 }; render();');
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pos.network.x, y: pos.network.y, button: 'left', clickCount: 1 });

  // 3. Click app button while window title and active state update between mousedown and mouseup.
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pos.app.x, y: pos.app.y, button: 'left', clickCount: 1 });
  await win.webContents.executeJavaScript('OB.state.windows[0].title = "Notepad - Draft 2"; OB.state.activeHwnd = 42; render();');
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pos.app.x, y: pos.app.y, button: 'left', clickCount: 1 });

  // 4. Hover network and ensure :hover stays active without mouseleave across a live rate update.
  const netPos = await win.webContents.executeJavaScript(`(() => {
    window.__hoverLeaves = 0;
    const el = document.querySelector('[data-w="network"]');
    el.addEventListener('mouseleave', () => window.__hoverLeaves++);
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const entered = win.webContents.executeJavaScript(`new Promise((resolve) => {
    const el = document.querySelector('[data-w="network"]');
    if (el.matches(':hover')) return resolve(true);
    el.addEventListener('mouseenter', () => resolve(true), { once: true });
  })`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: netPos.x, y: netPos.y });
  await entered;
  await win.webContents.executeJavaScript('OB.state.net = { down: 12345, up: 6789 }; render();');
  await new Promise((r) => setTimeout(r, 40));

  return win.webContents.executeJavaScript(`({
    siblingClicks: window.__clicks.weather,
    selfClicks: window.__clicks.network,
    appClicks: window.__clicks.app,
    sameWeatherNode: document.querySelector('[data-w="weather"]') === window.__nodes.weather,
    sameNetworkNode: document.querySelector('[data-w="network"]') === window.__nodes.network,
    sameAppNode: document.querySelector('button.app') === window.__nodes.app,
    hoverLeaves: window.__hoverLeaves,
    hoverPreserved: document.querySelector('[data-w="network"]').matches(':hover'),
  })`);
}
