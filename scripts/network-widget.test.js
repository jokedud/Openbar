'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

if (process.versions.electron) {
  measureNetworkWidget().then((samples) => {
    process.stdout.write(JSON.stringify(samples) + '\n', () => process.exit(0));
  }, (error) => {
    process.stderr.write(`${error.stack}\n`, () => process.exit(1));
  });
} else {
  const test = require('node:test');
  const samples = promisify(execFile)(require('electron'), [__filename], { timeout: 30000 })
    .then(({ stdout }) => JSON.parse(stdout));

  test('network download and upload use the same font size', async () => {
    for (const { rates, sizes } of await samples) {
      if (!rates) continue;
      assert.equal(sizes.length, 2);
      assert.equal(sizes[0], sizes[1]);
    }
  });

  test('network tile and requested pill width stay stable as rates change', async () => {
    const measurements = await samples;
    for (const { rates, tileWidth, pillWidth, fits } of measurements) {
      assert.equal(tileWidth, measurements[0].tileWidth, `Tile width at ${JSON.stringify(rates)}: ${tileWidth} vs ${measurements[0].tileWidth}`);
      assert.equal(pillWidth, measurements[0].pillWidth, `Requested pill width at ${JSON.stringify(rates)}: ${pillWidth} vs ${measurements[0].pillWidth}`);
      assert.ok(fits, `Rate text overflows at ${JSON.stringify(rates)}`);
    }
  });
}

async function measureNetworkWidget() {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const src = path.join(__dirname, '..', 'src');
  const samples = [];
  const ratesToRender = [
    { down: 0, up: 0 },
    { down: 1023, up: 99 },
    { down: 1024 ** 2 - 1, up: 2 * 1024 ** 2 },
    { down: 1024 ** 3 - 1, up: 0 },
    { down: 1024 ** 4 - 1, up: 1024 ** 5 - 1 },
    null,
  ];
  await app.whenReady();
  let pillWidth;
  ipcMain.handle('init', () => ({
    settings: { layout: 'pill', left: [], center: ['network'], right: [], customTabs: [] },
    data: {},
    state: { net: null },
  }));
  ipcMain.handle('bar:width', (_event, width) => { pillWidth = width; });
  ipcMain.handle('test:width', () => pillWidth);
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(src, 'preload.js'), backgroundThrottling: false },
  });
  await window.loadFile(path.join(src, 'renderer', 'bar.html'));
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    const animation = document.getElementById('bar').getAnimations()[0];
    if (animation) animation.finished.then(resolve);
    else resolve();
  })`);
  for (const rates of ratesToRender) {
    const result = await window.webContents.executeJavaScript(`(async () => {
      OB.state.net = ${JSON.stringify(rates)};
      render();
      const tile = document.querySelector('[data-w="network"]');
      const lines = [...tile.querySelectorAll('.val')];
      return {
        sizes: lines.map((line) => getComputedStyle(line).fontSize),
        tileWidth: tile.getBoundingClientRect().width,
        fits: lines.every((line) => line.scrollWidth <= line.clientWidth),
        pillWidth: await api.invoke('test:width'),
      };
    })()`);
    samples.push({ rates, ...result });
  }
  return samples;
}
