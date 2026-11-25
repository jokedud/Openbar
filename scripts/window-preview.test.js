'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function loadPreviewModule(electronMock) {
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'window-preview.js'), 'utf8');
  vm.runInNewContext(source, {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id === 'path') return path;
      if (id === 'electron') return electronMock;
      throw new Error(`Unexpected require: ${id}`);
    },
    setTimeout,
    clearTimeout,
  });
  return mod.exports;
}

test('fitThumbnailRect preserves aspect ratio and scales to physical pixels', () => {
  const { fitThumbnailRect } = loadPreviewModule({ Menu: {}, screen: {} });

  // 16:9 window inside a 200x120 slot at 125% DPI
  const landscape = fitThumbnailRect({ x: 20, y: 40, width: 200, height: 120 }, { width: 1920, height: 1080 }, 1.25);
  assert.deepEqual({ ...landscape }, { left: 25, top: 55, right: 275, bottom: 196 });

  // Tall portrait window centered horizontally inside a wide slot
  const portrait = fitThumbnailRect({ x: 10, y: 10, width: 200, height: 100 }, { width: 400, height: 800 }, 1);
  assert.deepEqual({ ...portrait }, { left: 85, top: 10, right: 135, bottom: 110 });

  assert.equal(fitThumbnailRect({ x: 0, y: 0, width: 0, height: 100 }, { width: 800, height: 600 }, 1), null);
});

test('computePreviewBounds anchors above/below dock, clamps to monitor, and falls back to compact list', () => {
  const { computePreviewBounds, CARD_WIDTH, CARD_GAP, SURFACE_PAD } = loadPreviewModule({ Menu: {}, screen: {} });
  const displayBounds = { x: 0, y: 0, width: 1280, height: 720 };
  const bottomBar = { x: 200, y: 656, width: 880, height: 54 };

  const single = computePreviewBounds({ anchorX: 400, barRect: bottomBar, displayBounds, windowCount: 1, position: 'bottom', shadowPadding: 24 });
  assert.equal(single.compact, false);
  assert.equal(single.surface.width, CARD_WIDTH + 2 * SURFACE_PAD);
  assert.equal(single.surface.y + single.surface.height, bottomBar.y - 8);
  assert.equal(single.bounds.width, single.surface.width + 48);

  // Near left edge should clamp to displayBounds.x + 8
  const leftEdge = computePreviewBounds({ anchorX: 20, barRect: bottomBar, displayBounds, windowCount: 2, position: 'bottom', shadowPadding: 24 });
  assert.equal(leftEdge.surface.x, 8);
  assert.equal(leftEdge.surface.width, 2 * CARD_WIDTH + CARD_GAP + 2 * SURFACE_PAD);

  // Top dock places preview below bar
  const topBar = { x: 200, y: 10, width: 880, height: 54 };
  const top = computePreviewBounds({ anchorX: 640, barRect: topBar, displayBounds, windowCount: 1, position: 'top', shadowPadding: 24 });
  assert.equal(top.surface.y, topBar.y + topBar.height + 8);

  // Many windows exceeding display width switch to compact list mode
  const crowded = computePreviewBounds({ anchorX: 640, barRect: bottomBar, displayBounds, windowCount: 10, position: 'bottom', shadowPadding: 24 });
  assert.equal(crowded.compact, true);
  assert.equal(crowded.surface.width, 280);
});

test('WindowPreviewController handles hover open delay, instant switching, surface grace period, live close, and DWM thumbnails', () => {
  let scheduled = [];
  let nextId = 1;
  const timers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      scheduled.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const item = scheduled.find((t) => t.id === id);
      if (item) item.cleared = true;
    },
  };
  const flushTimers = () => {
    const pending = scheduled.filter((t) => !t.cleared);
    scheduled = [];
    for (const t of pending) t.fn();
  };

  const sent = [];
  const winEvents = new Map();
  let winVisible = false;
  let winBounds = { x: 0, y: 0, width: 300, height: 220 };
  const fakeWin = {
    isDestroyed: () => false,
    isVisible: () => winVisible,
    showInactive: () => { winVisible = true; },
    hide: () => { winVisible = false; winEvents.get('hide')?.(); },
    destroy: () => { winVisible = false; },
    getBounds: () => winBounds,
    setBounds: (b) => { winBounds = b; },
    setAlwaysOnTop: () => {},
    getNativeWindowHandle: () => Buffer.alloc(8),
    loadFile: () => {},
    on: (ev, fn) => winEvents.set(ev, fn),
    webContents: {
      on: (ev, fn) => { if (ev === 'did-finish-load') fn(); },
      send: (ch, payload) => sent.push([ch, payload]),
    },
  };

  const thumbOps = [];
  let thumbCounter = 100;
  const win32 = {
    hwndFromBuffer: () => 9999,
    IsWindow: (h) => [10, 11, 20].includes(h),
    registerThumbnail: (dest, src) => { const id = ++thumbCounter; thumbOps.push(['reg', dest, src, id]); return id; },
    unregisterThumbnail: (id) => { thumbOps.push(['unreg', id]); return true; },
    queryThumbnailSourceSize: () => ({ width: 1280, height: 720 }),
    updateThumbnail: (id, props) => { thumbOps.push(['upd', id, props]); return true; },
    focusWindow: (h) => thumbOps.push(['focus', h]),
    minimizeWindow: (h) => thumbOps.push(['minimize', h]),
    maximizeWindow: (h) => thumbOps.push(['maximize', h]),
    restoreWindow: (h) => thumbOps.push(['restore', h]),
    closeWindow: (h) => thumbOps.push(['close', h]),
  };

  const state = {
    activeHwnd: 10,
    windows: [
      { hwnd: 10, title: 'Docs - Chrome', exe: 'chrome.exe', path: 'C:\\chrome.exe', minimized: false, maximized: false },
      { hwnd: 11, title: 'Mail - Chrome', exe: 'chrome.exe', path: 'C:\\chrome.exe', minimized: true, maximized: false },
      { hwnd: 20, title: 'Notes - Notepad', exe: 'notepad.exe', path: 'C:\\notepad.exe', minimized: false, maximized: true },
    ],
  };

  const { WindowPreviewController } = loadPreviewModule({
    Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) },
  });

  const controller = new WindowPreviewController({
    createSurfaceWindow: () => fakeWin,
    syncBackdrop: () => {},
    getBarBounds: () => ({ x: 400, y: 1016, width: 1120, height: 54 }),
    getSettings: () => ({ position: 'bottom', groupWindows: true }),
    getState: () => state,
    win32,
    isWin: true,
    preload: 'preload.js',
    rendererDir: 'renderer',
    iconPath: 'icon.png',
    timers,
  });

  // Hover waits for open delay
  controller.hoverDock({ hwnds: [10, 11], anchorX: 500, appKey: 'c:\\chrome.exe' });
  assert.equal(winVisible, false);
  flushTimers();
  assert.equal(winVisible, true);
  assert.equal(sent.at(-1)[1].windows.length, 2);
  assert.equal(sent.at(-1)[1].switching, false);

  // DWM thumbnail slots register and update
  controller.updateThumbnailSlots([
    { hwnd: 10, x: 30, y: 50, width: 200, height: 120 },
    { hwnd: 11, x: 260, y: 50, width: 200, height: 120 },
  ]);
  assert.equal(thumbOps.filter((op) => op[0] === 'reg').length, 2);
  assert.equal(thumbOps.filter((op) => op[0] === 'upd').length, 2);

  // Moving to another dock app while open switches immediately without delay
  controller.hoverDock({ hwnds: [20], anchorX: 560, appKey: 'c:\\notepad.exe' });
  assert.equal(sent.at(-1)[1].windows.length, 1);
  assert.equal(sent.at(-1)[1].windows[0].hwnd, 20);
  assert.equal(sent.at(-1)[1].switching, true);

  // Leaving dock then entering preview surface cancels auto-hide
  controller.leaveDock();
  controller.enterSurface();
  flushTimers();
  assert.equal(winVisible, true);

  // Performing focus hides preview and activates window
  assert.equal(controller.performAction(20, 'focus'), true);
  assert.equal(winVisible, false);
  assert.ok(thumbOps.some((op) => op[0] === 'focus' && op[1] === 20));
  assert.equal(thumbOps.filter((op) => op[0] === 'unreg').length, 2);

  // Reopen for Notepad, then close its only window -> syncWindows hides preview
  controller.hoverDock({ hwnds: [20], anchorX: 560, appKey: 'c:\\notepad.exe' });
  flushTimers();
  assert.equal(winVisible, true);
  state.windows = state.windows.filter((w) => w.hwnd !== 20);
  controller.syncWindows();
  assert.equal(winVisible, false);
});

test('win32 DWM thumbnail wrappers encode packed properties and return handles', () => {
  const calls = [];
  const methods = {
    DwmRegisterThumbnail: (dest, src, out) => { calls.push(['reg', dest, src]); out[0] = 777; return 0; },
    DwmQueryThumbnailSourceSize: (id, size) => { calls.push(['size', id]); size.cx = 1600; size.cy = 900; return 0; },
    DwmUpdateThumbnailProperties: (id, props) => { calls.push(['upd', id, props]); return 0; },
    DwmUnregisterThumbnail: (id) => { calls.push(['unreg', id]); return 0; },
    ShowWindowAsync: (hwnd, cmd) => { calls.push(['showAsync', hwnd, cmd]); return true; },
    IsZoomed: (hwnd) => hwnd === 55,
  };
  const packedNames = [];
  const koffi = {
    load: () => ({ func: (signature) => methods[signature.match(/(\w+)\(/)[1]] }),
    struct() {},
    pack(name) { packedNames.push(name); },
    proto() {},
  };
  const context = vm.createContext({ require: () => koffi, module: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'win32.js'), 'utf8'), context);
  const w32 = context.module.exports;

  assert.ok(packedNames.includes('DWM_THUMBNAIL_PROPERTIES'));
  assert.equal(w32.registerThumbnail(1, 2), 777);
  assert.deepEqual({ ...w32.queryThumbnailSourceSize(777) }, { width: 1600, height: 900 });
  assert.equal(w32.updateThumbnail(777, { left: 10, top: 20, right: 210, bottom: 140 }), true);
  assert.equal(calls[2][2].dwFlags, 0x1 | 0x4 | 0x8 | 0x10);
  assert.equal(calls[2][2].fVisible, 1);
  assert.equal(w32.unregisterThumbnail(777), true);
  assert.equal(w32.isWindowMaximized(55), true);
  assert.equal(w32.minimizeWindow(55), true);
  assert.equal(w32.maximizeWindow(55), true);
  assert.equal(w32.restoreWindow(55), true);
  assert.deepEqual(calls.slice(-3), [['showAsync', 55, 6], ['showAsync', 55, 3], ['showAsync', 55, 9]]);
});
