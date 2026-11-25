'use strict';
const path = require('path');
const { stat } = require('fs/promises');
const { app, BrowserWindow, dialog, ipcMain, screen, shell, Notification, Tray, Menu, nativeImage, nativeTheme, powerMonitor, safeStorage } = require('electron');
const { JsonFile, DEFAULT_SETTINGS, DEFAULT_DATA } = require('./store');
const { shortcutTarget } = require('./custom-tabs');
const TaskbarRecovery = require('./taskbar-recovery');
const sources = require('./sources');
const { registerBrightnessIpc } = require('./brightness');
const calendar = require('./calendar');
const startmenu = require('./startmenu');
const devin = require('./devin');
const DevinCompanion = require('./devin-companion');
const { bluetoothLayoutMigration, registerBluetoothIpc } = require('./bluetooth');
const { createVolume, volumeChange, UNAVAILABLE: VOLUME_UNAVAILABLE } = require('./volume');
const { hasVolumeWidget, volumeLayoutMigration } = require('./volume-layout');
const { createBattery, openPowerSettings } = require('./battery');
const { WindowPreviewController } = require('./window-preview');
const { TrayApps, trayLayoutMigration } = require('./tray-apps');
const windowPoll = require('./window-poll');
const { SurfaceInput } = require('./surface-input');

const isWin = process.platform === 'win32';
const win32 = isWin ? require('./win32') : null;
const APP_ID = 'xyz.openbar.app';
let readVolume;

function refreshVolume(change) {
  let next = VOLUME_UNAVAILABLE;
  if (isWin) {
    try {
      readVolume ||= createVolume(require('koffi'));
      next = readVolume(change);
    } catch (_) { /* Core Audio unavailable */ }
  }
  const prev = state.volume;
  if (prev?.status !== next.status || prev.volume !== next.volume || prev.muted !== next.muted) {
    state.volume = next;
    if (bar && !bar.isDestroyed()) bar.webContents.send('state', { volume: next });
    if (panelWidget === 'volume' && panel?.isVisible()) panel.webContents.send('state', { volume: next });
  }
  return next;
}

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId(APP_ID);

let settingsStore, dataStore, devinStore, taskbarRecovery, companion, windowPreview;
let bar = null, panel = null, settingsWin = null, tray = null;
let barHwnd = 0;
let panelWidget = null;
let devinPanelSize = null;
let batteryNative, batteryEstimate, trayApps;
const state = {
  system: null, disk: null, media: null, net: null, windows: [], activeHwnd: 0, recentHwnds: [], windowAppOrder: [],
  weather: null, calendar: { events: [], errors: [] }, github: null, crypto: null, commands: {},
  errors: {},
};

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const S = () => settingsStore.get();
const D = () => dataStore.get();

function broadcast(channel, payload) {
  for (const w of [bar, panel, settingsWin, windowPreview?.win]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------------- geometry ----------------
function barBounds(contentWidth) {
  const s = S();
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const h = s.height + 2 * s.margin;
  const full = s.layout === 'full';
  const w = full ? b.width : Math.min(b.width, Math.max(320, Math.round(contentWidth || 900) + 2 * s.margin));
  const x = full ? b.x : b.x + Math.round((b.width - w) / 2);
  const y = s.position === 'top' ? b.y : b.y + b.height - h;
  return { x, y, width: w, height: h };
}

function reserveSpace() {
  if (!isWin || !barHwnd) return;
  const s = S();
  const d = screen.getPrimaryDisplay();
  if (!s.reserveSpace) { win32.appBarRemove(barHwnd); appBarRegistered = false; return; }
  if (!appBarRegistered) appBarRegistered = win32.appBarRegister(barHwnd);
  const thickness = s.height + s.margin;
  const dip = { x: d.bounds.x, y: s.position === 'top' ? d.bounds.y : d.bounds.y + d.bounds.height - thickness, width: d.bounds.width, height: thickness };
  const px = screen.dipToScreenRect(null, dip);
  const rc = win32.appBarSetPos(barHwnd, s.position, { left: px.x, top: px.y, right: px.x + px.width, bottom: px.y + px.height });
  return screen.screenToDipRect(null, { x: rc.left, y: rc.top, width: rc.right - rc.left, height: rc.bottom - rc.top });
}
let appBarRegistered = false;
let lastContentWidth = 0;

function layoutBar() {
  if (!bar) return;
  const b = barBounds(lastContentWidth);
  const reserved = reserveSpace();
  // Align the visible dock edge to the work area after Windows positions the strip.
  if (reserved && reserved.height > 0) {
    const { margin, position } = S();
    b.y = position === 'top' ? reserved.y + reserved.height - b.height + margin : reserved.y - margin;
  }
  bar.setBounds(padBounds(b, barShadowPadding()));
  syncBackdrop(bar);
  bar.setAlwaysOnTop(true, 'screen-saver');
  companion?.configure(S(), b);
  companion?.raise();
}

// ---------------- floating surfaces ----------------
const SHADOW_PADDING = 24; // --surface-padding in theme.css
const barShadowPadding = () => Math.max(0, SHADOW_PADDING - S().margin);
function padBounds({ x, y, width, height }, padding) {
  return { x: x - padding, y: y - padding, width: width + 2 * padding, height: height + 2 * padding };
}

const backdrops = new WeakMap();
let glassMode = 'off';
function transparencyEnabled() {
  try {
    const key = require('path').win32.join('HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Themes', 'Personalize');
    const out = require('child_process').execFileSync('reg', ['query', key, '/v', 'EnableTransparency'], { encoding: 'utf8', windowsHide: true });
    return !/REG_DWORD\s+0x0\b/.test(out);
  } catch { return true; }
}
function applyBackdrop(hwnd, mode) {
  try { return win32.setBackdrop(hwnd, mode); } catch (e) { console.error('backdrop', e); return 'off'; }
}
function refreshGlass() {
  if (!isWin) return;
  const backdrop = backdrops.get(bar);
  glassMode = backdrop ? applyBackdrop(backdrop.hwnd, transparencyEnabled() ? 'blur' : 'off') : 'off';
  const panelBackdrop = backdrops.get(panel);
  if (panelBackdrop) applyBackdrop(panelBackdrop.hwnd, glassMode);
  const previewBackdrop = windowPreview?.win && backdrops.get(windowPreview.win);
  if (previewBackdrop) applyBackdrop(previewBackdrop.hwnd, glassMode);
  state.glass = glassMode;
  broadcast('state', { glass: glassMode });
  syncBackdrop(bar);
  syncBackdrop(panel);
  if (windowPreview?.win) syncBackdrop(windowPreview.win);
}

function createSurfaceWindow(options) {
  if (!isWin) return new BrowserWindow(options);
  const backdrop = new BrowserWindow({
    frame: false, transparent: true, resizable: false, focusable: false, skipTaskbar: true, show: false, hasShadow: false,
  });
  backdrop.setIgnoreMouseEvents(true);
  backdrop.setAlwaysOnTop(true, 'screen-saver');
  const hwnd = win32.hwndFromBuffer(backdrop.getNativeWindowHandle());
  applyBackdrop(hwnd, glassMode);
  // The native blur is clipped inside the CSS rim; the visible edge and shadow are never region-clipped.
  const win = new BrowserWindow({ ...options, parent: backdrop });
  const layers = { window: backdrop, hwnd, surface: null, lastSync: null };
  const input = layers.input = new SurfaceInput(win, () => screen.getCursorScreenPoint(), () => layers.surface);
  backdrops.set(win, layers);
  win.on('show', () => syncBackdrop(win));
  win.on('hide', () => {
    layers.lastSync = null;
    input.stop();
    if (!backdrop.isDestroyed()) backdrop.hide();
  });
  win.once('closed', () => { input.stop(); if (!backdrop.isDestroyed()) backdrop.destroy(); });
  return win;
}

function syncBackdrop(win) {
  const backdrop = backdrops.get(win);
  if (!backdrop) return;
  const { window, hwnd, surface } = backdrop;
  if (glassMode === 'off' || !surface || !win.isVisible()) {
    backdrop.lastSync = null;
    if (window.isVisible()) window.hide();
    return;
  }
  const bounds = win.getBounds();
  const { x, y, width, height, radius } = surface;
  const inside = padBounds({ x: bounds.x + x, y: bounds.y + y, width, height }, -1);
  const { scaleFactor } = screen.getDisplayMatching(bounds);
  const px = (v) => Math.round(v * scaleFactor);
  const region = { width: px(inside.width), height: px(inside.height), radius: px(radius - 1) };
  const prev = backdrop.lastSync;
  const boundsChanged = !prev || prev.x !== inside.x || prev.y !== inside.y || prev.width !== inside.width || prev.height !== inside.height;
  const regionChanged = !prev || prev.rw !== region.width || prev.rh !== region.height || prev.rr !== region.radius;
  if (boundsChanged) window.setBounds(inside);
  if (regionChanged) {
    try {
      win32.setRoundRegion(hwnd, region);
    } catch (e) {
      console.error('region', e);
      backdrop.lastSync = null;
      window.hide();
      return;
    }
  }
  backdrop.lastSync = { ...inside, rw: region.width, rh: region.height, rr: region.radius };
  if (!window.isVisible()) window.showInactive();
}

function registerSurfaceIpc() {
  ipcMain.on('surface:bounds', (e, surface) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const backdrop = backdrops.get(win);
    if (!backdrop || !surface) return;
    const { x, y, width, height, radius } = surface;
    if (![x, y, width, height, radius].every(Number.isFinite) || width <= 2 || height <= 2 || radius < 1) return;
    backdrop.surface = { x, y, width, height, radius };
    syncBackdrop(win);
  });
  ipcMain.on('surface:mouse', (e, overPadding) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    backdrops.get(win)?.input.update(overPadding === true);
  });
  ipcMain.on('panel:ready', (e, seq) => {
    if (panel && !panel.isDestroyed() && e.sender === panel.webContents) showPanel(seq);
  });
}

// ---------------- Windows taskbar ----------------
let taskbarWork, appliedTaskbar;
function scheduleTaskbar(force = false) {
  if (!isWin || cleanedUp || (taskbarWork && !force)) return;
  const current = Promise.resolve(taskbarWork).then(() => {
    if (!cleanedUp) return applyTaskbar();
  }).catch((error) => console.error('Windows taskbar:', error)).finally(() => {
    if (taskbarWork === current) taskbarWork = null;
  });
  taskbarWork = current;
}

async function applyTaskbar() {
  if (!isWin || trayApps?.busy) return;
  const pending = taskbarRecovery.pending();
  if (pending && pending.id !== taskbarRecovery.id) {
    taskbarRecovery.resume(pending);
    return;
  }
  const mode = S().taskbar;
  if (mode === 'keep') return restoreTaskbar();
  const windows = win32.taskbarWindows();
  if (!windows.length) { appliedTaskbar = null; return; }
  const visible = mode !== 'hide';
  const original = D().taskbarRestore;
  const legacy = original && !original.guarded;
  const overridden = pending && pending.phase !== 'prepared';
  const matches = win32.taskbarVisibilityIs(visible, windows);
  const key = [mode, ...windows].join(':');
  if (appliedTaskbar === key && matches && (!overridden || taskbarRecovery.ready())) return;
  appliedTaskbar = null;
  const autohide = (await win32.getTaskbarState(windows[0]) & win32.ABS_AUTOHIDE) !== 0;
  const alreadySet = autohide && matches;
  if (alreadySet && !legacy && !pending) { appliedTaskbar = key; return; }
  const baseline = legacy ? !!original.autohide : autohide;
  if (!taskbarRecovery.arm(baseline)) {
    if (overridden) await restoreTaskbar();
    return;
  }
  if (alreadySet && pending?.phase === 'applied') { appliedTaskbar = key; return; }
  // Journal intent before touching Explorer or replacing a legacy baseline.
  if (!taskbarRecovery.recordOverride(baseline)) return;
  if (pending?.phase === 'prepared') {
    dataStore.set({ taskbarRestore: { autohide: baseline, guarded: true, id: taskbarRecovery.id } });
    dataStore.save(true);
  }
  if (!autohide) await win32.setTaskbarAutoHide(true, windows[0]);
  if (await win32.setTaskbarVisible(visible, windows) && (await win32.getTaskbarState(windows[0]) & win32.ABS_AUTOHIDE)) {
    taskbarRecovery.markApplied();
    appliedTaskbar = key;
  }
}

async function restoreTaskbar() {
  if (!isWin || !taskbarRecovery) return;
  appliedTaskbar = null;
  const pending = taskbarRecovery.pending();
  if (pending && pending.id !== taskbarRecovery.id) return;
  const r = D().taskbarRestore;
  const original = pending && pending.phase !== 'prepared' ? pending : (r && !r.guarded ? r : null);
  if (original) {
    const windows = win32.taskbarWindows();
    if (!windows.length) return;
    await win32.setTaskbarAutoHide(!!original.autohide, windows[0]);
    if (!await win32.setTaskbarVisible(true, windows) || !win32.hasTaskbar() ||
        ((await win32.getTaskbarState(windows[0]) & win32.ABS_AUTOHIDE) !== 0) !== !!original.autohide) return;
  }
  taskbarRecovery.restored();
  if (r) {
    dataStore.set({ taskbarRestore: null });
    dataStore.save(true);
  }
}

// ---------------- running windows + screen time ----------------
const iconCache = new Map();
function windowsSettingsIcon() {
  if (!isWin) return null;
  const images = path.join(process.env.SystemRoot || 'C:/Windows', 'ImmersiveControlPanel', 'images');
  const unplated = nativeImage.createFromPath(path.join(images, 'logo.targetsize-256_altform-unplated.png'));
  return unplated.isEmpty() ? nativeImage.createFromPath(path.join(images, 'logo.png')) : unplated;
}

async function exeIcon(file) {
  if (!file) return '';
  if (iconCache.has(file)) return iconCache.get(file);
  iconCache.set(file, '');
  try {
    const img = /^ms-settings:$/i.test(file) ? windowsSettingsIcon() : await app.getFileIcon(file, { size: 'normal' });
    if (img && !img.isEmpty()) iconCache.set(file, img.toDataURL());
  } catch (_) { /* no icon */ }
  return iconCache.get(file);
}

let lastTick = Date.now();
let windowPollInFlight;
function pollWindows() {
  if (!isWin || cleanedUp) return;
  windowPollInFlight ||= updateWindows().finally(() => { windowPollInFlight = null; });
  return windowPollInFlight;
}

async function updateWindows() {
  const own = new Set([process.pid]);
  for (const m of app.getAppMetrics()) own.add(m.pid);
  let snapshot;
  try {
    snapshot = await windowPoll.poll(own);
    delete state.errors.windows;
  } catch (e) {
    if (!cleanedUp) state.errors.windows = String(e.message);
    return;
  }
  if (cleanedUp) return;
  const { windows: list, active } = snapshot;
  for (const w of list) {
    w.exe = w.path ? path.basename(w.path) : w.cls;
    w.icon = await exeIcon(w.path);
  }
  if (cleanedUp) return;
  // screen time: credit the elapsed time to the foreground app
  const now = Date.now();
  const dt = Math.min(5, (now - lastTick) / 1000);
  lastTick = now;
  const fg = list.find((w) => w.hwnd === active);
  if (fg && powerMonitor.getSystemIdleTime() < 120) {
    const day = localDay();
    const st = D().screenTime;
    const today = st[day] || {};
    today[fg.exe] = (today[fg.exe] || 0) + dt;
    const keep = Object.keys(st).sort().slice(-14);
    const trimmed = {};
    for (const k of keep) trimmed[k] = st[k];
    trimmed[day] = today;
    dataStore.value.screenTime = trimmed;
    dataStore.save();
    if (now - (pollWindows.stSent || 0) > 30000) { pollWindows.stSent = now; broadcast('data', D()); }
  }
  const previousOrder = new Map(state.windows.map((w, i) => [w.hwnd, i]));
  const rank = (w) => previousOrder.get(w.hwnd) ?? previousOrder.size;
  const recentHwnds = list.map((w) => w.hwnd);
  const appKeys = new Set(list.map((w) => (w.path || w.exe).toLowerCase()));
  const windowAppOrder = state.windowAppOrder.filter((key) => appKeys.delete(key)).concat([...appKeys]);
  list.sort((a, b) => rank(a) - rank(b));
  const sig = JSON.stringify([list.map((w) => [w.hwnd, w.title, w.minimized, w.maximized]), active, recentHwnds, windowAppOrder]);
  if (sig !== pollWindows.sig) {
    pollWindows.sig = sig;
    const windowState = { windows: list, activeHwnd: active, recentHwnds, windowAppOrder };
    Object.assign(state, windowState);
    broadcast('state', windowState);
    windowPreview?.syncWindows();
  }
}

// ---------------- data sources ----------------
async function refresh(key, fn) {
  try {
    state[key] = await fn();
    delete state.errors[key];
  } catch (e) {
    state.errors[key] = String((e && e.message) || e);
  }
  broadcast('state', { [key]: state[key], errors: state.errors });
}

const refreshers = {
  system: () => refresh('system', async () => sources.system()),
  disk: () => refresh('disk', () => sources.disk()),
  weather: () => refresh('weather', () => sources.weather(S().weather)),
  calendar: () => refresh('calendar', () => calendar.fetchAll(S().calendars)),
  github: () => refresh('github', () => sources.github(S().github)),
  crypto: () => refresh('crypto', () => sources.crypto(S().crypto)),
};

function refreshBattery() {
  if (!batteryNative) return;
  const s = S();
  if (!['left', 'center', 'right'].some((zone) => s[zone].includes('battery')) &&
      !s.customTabs.some((tab) => tab.items.some((item) => item.widget === 'battery'))) return;
  const next = batteryNative.read();
  if (state.battery && Object.keys(next).every((key) => next[key] === state.battery[key])) return;
  state.battery = next;
  broadcast('state', { battery: next });
}

function stopBatteryEstimate() {
  batteryEstimate?.abort();
  batteryEstimate = null;
}

const cmdTimers = new Map();
function scheduleCommands() {
  for (const t of cmdTimers.values()) clearInterval(t);
  cmdTimers.clear();
  for (const c of S().commands || []) {
    if (!c.command) continue;
    const run = async () => {
      state.commands[c.id] = await sources.runCommand(c.command);
      broadcast('state', { commands: state.commands });
    };
    run();
    cmdTimers.set(c.id, setInterval(run, Math.max(5, c.intervalSec || 60) * 1000));
  }
}

let lastNet = null;
function onHelper(msg) {
  if ('media' in msg) state.media = msg.media;
  if (msg.net) {
    if (lastNet && msg.net.t > lastNet.t) {
      const s = (msg.net.t - lastNet.t) / 1000;
      state.net = { down: Math.max(0, (msg.net.rx - lastNet.rx) / s), up: Math.max(0, (msg.net.tx - lastNet.tx) / s) };
    }
    lastNet = msg.net;
  }
  broadcast('state', { media: state.media, net: state.net });
}

function localDay() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function every(ms, fn) { fn(); return setInterval(fn, ms); }

// ---------------- automations ----------------
const fired = new Set();
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: !S().sounds });
  if (onClick) n.on('click', onClick);
  n.show();
}

function mediaPlaying() { return !!(state.media && state.media.playing); }

function runAutomations() {
  const a = S().automations;
  const now = Date.now();
  for (const ev of (state.calendar && state.calendar.events) || []) {
    if (ev.allDay) continue;
    const mins = (ev.start - now) / 60000;
    if (a.meetingReminders && mins <= a.reminderMinutesBefore && mins > a.reminderMinutesBefore - 1 && !fired.has('r' + ev.id)) {
      fired.add('r' + ev.id);
      notify(`${ev.title} in ${Math.max(1, Math.round(mins))} min`, ev.url ? 'Click to join' : (ev.location || ev.calendar), ev.url ? () => shell.openExternal(ev.url) : null);
    }
    if (a.pauseMusicBeforeMeetings && mins <= a.pauseMinutesBefore && mins > a.pauseMinutesBefore - 1 && !fired.has('p' + ev.id)) {
      fired.add('p' + ev.id);
      if (mediaPlaying()) sources.controlMedia('pause');
    }
  }
  const day = localDay();
  const w = state.weather;
  if (a.umbrellaReminder && w && w.daily && new Date().getHours() >= 7 && !fired.has('u' + day)) {
    fired.add('u' + day);
    const p = (w.daily.precipitation_probability_max || [])[0];
    if (p >= 50) notify('Bring an umbrella', `${p}% chance of rain today in ${w.place || 'your area'}`);
  }
  const dk = state.disk;
  if (a.lowDiskAlert && dk && dk.free / dk.total < 0.05 && !fired.has('d' + day)) {
    fired.add('d' + day);
    notify('Low disk space', `Only ${(dk.free / 1e9).toFixed(1)} GB free on ${dk.drive}`);
  }
  const sys = state.system;
  if (a.highCpuAlert && sys) {
    highCpuSecs = sys.cpu > 90 ? highCpuSecs + 2 : 0;
    if (highCpuSecs >= 60 && !fired.has('c' + Math.floor(now / 600000))) {
      fired.add('c' + Math.floor(now / 600000));
      notify('High CPU usage', `CPU has been above 90% for a minute (${sys.cpu}%)`);
    }
  }
}
let highCpuSecs = 0;

// ---------------- pomodoro ----------------
function pomo() {
  const p = D().pomodoro;
  const day = localDay();
  if (p.day !== day) { p.day = day; p.completedToday = 0; }
  return p;
}
function pomodoroAction(action) {
  const p = pomo();
  const cfg = S().pomodoro;
  const now = Date.now();
  if (action === 'start') {
    if (p.phase === 'paused') { p.phase = p.resumePhase || 'focus'; p.endsAt = now + p.remainingMs; }
    else { p.phase = 'focus'; p.endsAt = now + cfg.focusMin * 60000; }
    if (S().automations.pauseMusicOnPomodoro && mediaPlaying()) sources.controlMedia('pause');
  } else if (action === 'pause' && (p.phase === 'focus' || p.phase === 'break')) {
    p.resumePhase = p.phase; p.remainingMs = Math.max(0, p.endsAt - now); p.phase = 'paused';
  } else if (action === 'reset') {
    p.phase = 'idle'; p.endsAt = 0; p.remainingMs = 0;
  } else if (action === 'skip') {
    if (p.phase === 'paused') p.phase = p.resumePhase || 'focus';
    p.endsAt = now;
    tickPomodoro();
  }
  dataStore.set({ pomodoro: p });
  broadcast('data', D());
}
function tickPomodoro() {
  const p = pomo();
  if ((p.phase === 'focus' || p.phase === 'break') && Date.now() >= p.endsAt) {
    const cfg = S().pomodoro;
    if (p.phase === 'focus') {
      p.completedToday++;
      p.phase = 'break'; p.endsAt = Date.now() + cfg.breakMin * 60000;
      notify('Focus session done', `Take a ${cfg.breakMin} minute break. ${p.completedToday} today.`);
    } else {
      p.phase = 'idle'; p.endsAt = 0;
      notify('Break over', 'Ready for the next focus session?');
    }
    dataStore.set({ pomodoro: p });
    broadcast('data', D());
  }
}

// ---------------- windows ----------------
const ICON = path.join(RENDERER, 'assets', 'icon.png');
const webPreferences = { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false };

function createBar() {
  bar = createSurfaceWindow({
    ...padBounds(barBounds(), barShadowPadding()), frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
    maximizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    title: 'OpenBar', icon: ICON, webPreferences,
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.webContents.on('render-process-gone', () => {
    if (!cleanedUp && isWin && D().taskbarRestore) app.quit();
  });
  bar.loadFile(path.join(RENDERER, 'bar.html'));
  bar.on('show', () => companion?.setDockVisible(true));
  bar.on('hide', () => companion?.setDockVisible(false));
  bar.once('ready-to-show', () => { bar.showInactive(); layoutBar(); });
  if (isWin) {
    barHwnd = win32.hwndFromBuffer(bar.getNativeWindowHandle());
    stoppers.push(batteryNative.watchSaver(bar, barHwnd, refreshBattery));
    refreshGlass();
    nativeTheme.on('updated', refreshGlass);
  }
  bar.on('closed', () => { bar = null; companion?.setDockVisible(false); });
}

const PANEL_SIZES = { calendar: [380, 520], weather: [380, 540], system: [360, 420], todos: [360, 460], notes: [380, 420], media: [360, 260], pomodoro: [320, 300], github: [360, 420], devin: [374, 444], crypto: [320, 340], clock: [340, 480], apps: [520, 560], screenTime: [360, 440], network: [356, 250], battery: [344, 326], quick: [320, 320], start: [520, 560] };
PANEL_SIZES.bluetooth = [330, 294];
PANEL_SIZES.brightness = [336, 270];
PANEL_SIZES.volume = [324, 232];
PANEL_SIZES.trayApps = [328, 320];

let panelShowSeq = 0;
let panelShowTimer = null;
function cancelPendingPanelShow() {
  panelShowSeq++;
  if (panelShowTimer) { clearTimeout(panelShowTimer); panelShowTimer = null; }
}
function showPanel(seq) {
  if (seq !== panelShowSeq || !panel || panel.isDestroyed() || !panelWidget) return;
  if (panelShowTimer) { clearTimeout(panelShowTimer); panelShowTimer = null; }
  if (!panel.isVisible()) panel.show();
  panel.focus();
  syncBackdrop(panel);
}

function togglePanel(widget, anchorX) {
  windowPreview?.hide();
  if (panelWidget === 'battery') stopBatteryEstimate();
  if (panel && !panel.isDestroyed() && panel.isVisible() && panelWidget === widget) {
    cancelPendingPanelShow();
    panel.hide();
    panelWidget = null;
    broadcast('panel', null);
    return;
  }
  const power = widget === 'battery' ? batteryNative?.read() : null;
  const [w, preferredH] = power?.present === false ?
    [PANEL_SIZES.battery[0], 266] : PANEL_SIZES[widget] || [360, 420];
  const viewport = bar.getBounds();
  const bb = padBounds(viewport, -barShadowPadding());
  const db = screen.getDisplayMatching(bb).bounds;
  const atTop = S().position === 'top';
  const room = atTop ? db.y + db.height - (bb.y + bb.height) : bb.y - db.y;
  const h = Math.min(preferredH, room - 14);
  let x = Math.round(viewport.x + (anchorX || viewport.width / 2) - w / 2);
  x = Math.max(db.x + 8, Math.min(x, db.x + db.width - w - 8));
  const gap = widget === 'devin' ? 6 - S().margin : 6;
  const y = atTop ? bb.y + bb.height + gap : bb.y - h - gap;
  const bounds = padBounds({ x, y, width: w, height: h }, SHADOW_PADDING);
  devinPanelSize = widget === 'devin' ? { maxHeight: h, atTop } : null;
  if (!panel || panel.isDestroyed()) {
    cancelPendingPanelShow();
    panel = createSurfaceWindow({
      ...bounds, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true,
      show: false, hasShadow: false, title: 'OpenBar panel', icon: ICON, webPreferences,
    });
    panel.setAlwaysOnTop(true, 'screen-saver');
    panel.on('blur', () => {
      if (panelWidget === 'trayApps' && trayApps?.busy) return;
      if (panel && panel.isVisible() && !panel.webContents.isDevToolsOpened()) {
        cancelPendingPanelShow();
        panel.hide();
        panelWidget = null;
        broadcast('panel', null);
      }
    });
    panel.on('hide', () => { if (panelWidget === 'volume') panel.webContents.send('volume:hidden'); });
    panel.on('hide', stopBatteryEstimate);
    panel.on('closed', () => { cancelPendingPanelShow(); stopBatteryEstimate(); panel = null; panelWidget = null; });
    panel.loadFile(path.join(RENDERER, 'panel.html'), { query: { widget } });
    panel.once('ready-to-show', () => { panel.show(); panel.focus(); });
  } else {
    const seq = ++panelShowSeq;
    if (panelShowTimer) { clearTimeout(panelShowTimer); panelShowTimer = null; }
    if (panel.isVisible()) panel.hide();
    const backdrop = backdrops.get(panel);
    if (backdrop) { backdrop.surface = null; backdrop.lastSync = null; }
    panel.setBounds(bounds);
    panelWidget = widget;
    broadcast('panel', widget);
    panel.webContents.send('panel:widget', widget, seq);
    panelShowTimer = setTimeout(() => showPanel(seq), 120);
    return;
  }
  panelWidget = widget;
  broadcast('panel', widget);
}

function fitDevinPanel(e, contentHeight) {
  if (panelWidget !== 'devin' || !devinPanelSize || !panel || panel.isDestroyed() ||
      e.sender !== panel.webContents || !Number.isFinite(contentHeight) || contentHeight <= 0) return;
  const bounds = panel.getBounds();
  const height = Math.min(Math.ceil(contentHeight), devinPanelSize.maxHeight) + 2 * SHADOW_PADDING;
  if (height === bounds.height) return;
  const y = devinPanelSize.atTop ? bounds.y : bounds.y + bounds.height - height;
  panel.setBounds({ ...bounds, y, height });
  syncBackdrop(panel);
}

function openSettings(tab) {
  windowPreview?.hide();
  cancelPendingPanelShow();
  if (panelWidget === 'bluetooth' || panelWidget === 'battery') { panelWidget = null; broadcast('panel', null); }
  if (panel && !panel.isDestroyed()) panel.hide();
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); if (tab) settingsWin.webContents.send('settings:tab', tab); return; }
  settingsWin = new BrowserWindow({
    width: 980, height: 720, minWidth: 760, minHeight: 520, title: 'OpenBar Settings', icon: ICON,
    autoHideMenuBar: true, backgroundColor: '#0f1115', show: false, webPreferences,
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'), { query: { tab: tab || '' } });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('OpenBar');
  const menu = Menu.buildFromTemplate([
    { label: 'Settings', click: () => openSettings() },
    { label: 'Show / hide bar', click: () => { if (bar.isVisible()) bar.hide(); else bar.showInactive(); } },
    { label: 'Reload bar', click: () => bar.reload() },
    { type: 'separator' },
    { label: 'Restore Windows taskbar and quit', click: () => { settingsStore.set({ taskbar: 'keep' }); settingsStore.save(true); app.quit(); } },
    { label: 'Quit OpenBar', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => openSettings());
}

// ---------------- IPC ----------------
function syncLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: !!S().launchAtLogin,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
  });
}

function applySettings(prev) {
  const s = S();
  layoutBar();
  if (prev.taskbar !== s.taskbar) scheduleTaskbar(true);
  syncLoginItem();
  if (JSON.stringify(prev.commands) !== JSON.stringify(s.commands)) scheduleCommands();
  if (JSON.stringify(prev.weather) !== JSON.stringify(s.weather)) refreshers.weather();
  if (JSON.stringify(prev.calendars) !== JSON.stringify(s.calendars)) refreshers.calendar();
  if (JSON.stringify(prev.github) !== JSON.stringify(s.github)) refreshers.github();
  if (JSON.stringify(prev.crypto) !== JSON.stringify(s.crypto)) refreshers.crypto();
  broadcast('settings', s);
}

const SAFE_URL = /^(https?|mailto|ms-settings|webcal):/i;
const SYSTEM_ACTIONS = {
  lock: () => win32 && win32.LockWorkStation(),
  sleep: () => require('child_process').exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0'),
  taskmgr: () => shell.openPath('taskmgr.exe'),
  explorer: () => shell.openPath(app.getPath('home')),
  winsettings: () => shell.openExternal('ms-settings:'),
  start: () => win32 && win32.sendCombo([0x5B]),
  search: () => win32 && win32.sendCombo([0x5B, 0x53]),
  desktop: () => win32 && win32.sendCombo([0x5B, 0x44]),
  actioncenter: () => win32 && win32.sendCombo([0x5B, 0x41]),
  emoji: () => win32 && win32.sendCombo([0x5B, 0xBE]),
  snip: () => win32 && win32.sendCombo([0x5B, 0x10, 0x53]),
};

function launch(item) {
  if (!item || !item.path) return;
  if (SAFE_URL.test(item.path)) return shell.openExternal(item.path);
  if (item.args) {
    const { spawn } = require('child_process');
    const p = spawn(item.path, item.args.match(/"[^"]*"|\S+/g).map((a) => a.replace(/^"|"$/g, '')), { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
    return;
  }
  return shell.openPath(item.path);
}

function devinConfigInfo() {
  const { encrypted, orgId } = devinStore.get();
  return { configured: !!encrypted, orgId };
}

function saveDevinConfig(config) {
  const previous = devinStore.get();
  try {
    devinStore.replace(config);
    devinStore.save(true);
    companion?.configure(S(), bar && padBounds(bar.getBounds(), -barShadowPadding()), true);
    return devinConfigInfo();
  } catch {
    devinStore.value = previous;
    return { error: 'storage' };
  }
}

const storageAvailable = () => safeStorage.isEncryptionAvailable()
  && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

function listCloudDevinSessions(cursor) {
  const { encrypted, orgId } = devinStore.get();
  if (!encrypted) return { error: 'missing' };
  try {
    if (!storageAvailable()) return { error: 'storage' };
    return devin.listSessions({ token: safeStorage.decryptString(Buffer.from(encrypted, 'base64')), orgId }, cursor);
  } catch {
    return { error: 'storage' };
  }
}

function registerDevinIpc() {
  ipcMain.handle('devin:config', devinConfigInfo);
  ipcMain.handle('devin:save', (e, key, organization) => {
    if (e.sender !== settingsWin?.webContents) return { error: 'storage' };
    if (typeof key !== 'string' || typeof organization !== 'string') return { error: 'invalid' };
    const token = key.trim(), orgId = organization.trim();
    const saved = devinStore.get();
    if ((!token && !saved.encrypted) || /\s/.test(token)) return { error: 'invalid' };
    if (!storageAvailable()) return { error: 'storage' };
    try {
      const activeToken = token || safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64'));
      const legacy = activeToken.startsWith('apk_');
      if (!legacy && !devin.ORG_ID.test(orgId)) return { error: 'organization' };
      const encrypted = token ? safeStorage.encryptString(token).toString('base64') : saved.encrypted;
      return saveDevinConfig({ encrypted, orgId: legacy ? '' : orgId });
    } catch {
      return { error: 'storage' };
    }
  });
  ipcMain.handle('devin:remove', (e) => {
    if (e.sender !== settingsWin?.webContents) return { error: 'storage' };
    return saveDevinConfig({});
  });
  ipcMain.handle('devin:list-local', () => devin.listLocalSessions());
  ipcMain.handle('devin:list', (_e, cursor) => listCloudDevinSessions(cursor));
  ipcMain.handle('devin:open', async (_e, id) => {
    const url = devin.sessionUrl(id);
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });
}

function registerIpc() {
  registerDevinIpc();
  registerBluetoothIpc(ipcMain, shell, (e) => panelWidget === 'bluetooth' && e.sender === panel?.webContents);
  ipcMain.handle('volume:read', (e) => panelWidget === 'volume' && e.sender === panel?.webContents ? refreshVolume() : VOLUME_UNAVAILABLE);
  ipcMain.handle('volume:change', (e, action, value) => {
    const change = volumeChange(action, value);
    if (!change || panelWidget !== 'volume' || !panel?.isVisible() || e.sender !== panel.webContents) return VOLUME_UNAVAILABLE;
    return refreshVolume(change);
  });
  const batteryPanel = (e) => panelWidget === 'battery' && e.sender === panel?.webContents;
  ipcMain.handle('battery:details', (e) => batteryPanel(e) && batteryNative ?
    { ...batteryNative.read(), mode: batteryNative.mode() } : null);
  ipcMain.handle('battery:mode', (e, mode) => !!(batteryPanel(e) && batteryNative?.setMode(mode)));
  ipcMain.handle('battery:settings', (e, target) => !!batteryNative && batteryPanel(e) && openPowerSettings(shell, target));
  ipcMain.handle('battery:charge-time', async (e) => {
    if (!batteryPanel(e) || !batteryNative?.read().charging || batteryEstimate) return null;
    const request = new AbortController();
    batteryEstimate = request;
    try {
      const seconds = await batteryNative.chargeTime(request.signal);
      return !request.signal.aborted && batteryPanel(e) && batteryNative.read().charging ? seconds : null;
    } finally {
      if (batteryEstimate === request) batteryEstimate = null;
    }
  });
  ipcMain.handle('init', () => ({ settings: S(), data: D(), state, platform: process.platform, version: app.getVersion() }));
  ipcMain.handle('settings:set', (_e, patch) => { const prev = JSON.parse(JSON.stringify(S())); settingsStore.set(patch); applySettings(prev); return S(); });
  ipcMain.handle('settings:replace', (_e, v) => { const prev = JSON.parse(JSON.stringify(S())); settingsStore.replace(v); migrateBluetoothLayout(); applySettings(prev); return S(); });
  ipcMain.handle('settings:reset', () => {
    const { configured, orgId } = devinConfigInfo();
    if ((configured || orgId) && saveDevinConfig({}).error) throw new Error('Could not remove the saved Devin key.');
    const prev = JSON.parse(JSON.stringify(S()));
    settingsStore.replace(DEFAULT_SETTINGS);
    migrateBluetoothLayout();
    applySettings(prev);
    return S();
  });
  ipcMain.handle('data:set', (_e, patch) => { dataStore.set(patch); broadcast('data', D()); return D(); });
  ipcMain.handle('data:replaceKey', (_e, key, value) => { dataStore.value[key] = value; dataStore.save(); broadcast('data', D()); return D(); });
  ipcMain.handle('win:action', (_e, hwnd, action) => {
    if (!isWin || !win32.IsWindow(hwnd)) return;
    if (action === 'focus') win32.focusWindow(hwnd);
    else if (action === 'minimize') win32.minimizeWindow(hwnd);
    else if (action === 'close') win32.closeWindow(hwnd);
    else if (action === 'toggle') {
      const w = state.windows.find((x) => x.hwnd === hwnd);
      if (state.activeHwnd === hwnd && w && !w.minimized) win32.minimizeWindow(hwnd); else win32.focusWindow(hwnd);
    }
    setTimeout(pollWindows, 120);
  });
  ipcMain.handle('launch', (_e, item) => launch(item));
  ipcMain.handle('tabs:target', (_e, kind, value) => shortcutTarget(kind, value));
  ipcMain.handle('tabs:browse', async (e, kind) => {
    if (kind !== 'app' && kind !== 'folder') return null;
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), kind === 'folder'
      ? { title: 'Choose a folder', properties: ['openDirectory'] }
      : { title: 'Choose an app', properties: ['openFile', 'noResolveAliases'], filters: [{ name: 'Apps', extensions: ['exe', 'lnk', 'appref-ms'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('tabs:open', async (e, tabId, itemId) => {
    const item = S().customTabs.find((t) => t.id === tabId)?.items.find((i) => i.id === itemId);
    if (!item || item.kind === 'widget') return;
    let detail;
    try {
      if (item.kind === 'website') await shell.openExternal(item.target);
      else if (item.kind === 'folder' && !(await stat(item.target)).isDirectory()) detail = 'The target is not a folder.';
      else detail = await shell.openPath(item.target);
    } catch (error) { detail = error.message; }
    if (detail) await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), { type: 'error', message: 'Could not open this shortcut', detail });
  });
  ipcMain.handle('apps:list', (_e, force) => startmenu.listApps(force));
  ipcMain.handle('apps:icon', (_e, file) => startmenu.iconFor(file));
  ipcMain.handle('exe:icon', (_e, file) => exeIcon(file));
  ipcMain.handle('media', (_e, action) => isWin && sources.controlMedia(action));
  ipcMain.handle('system', (_e, action) => { const f = SYSTEM_ACTIONS[action]; if (f) f(); });
  ipcMain.handle('open', (_e, url) => { if (SAFE_URL.test(String(url))) shell.openExternal(String(url)); });
  let wifi;
  const networkControls = () => (wifi ||= require('./wifi').createWifiControls((url) => shell.openExternal(url)));
  const fromNetworkPanel = (e) => isWin && panelWidget === 'network' && panel && !panel.isDestroyed() &&
    e.sender === panel.webContents && e.senderFrame === panel.webContents.mainFrame;
  ipcMain.handle('wifi:status', (e) => fromNetworkPanel(e) ? networkControls().status() : null);
  ipcMain.handle('wifi:set-radio', (e, enabled) => fromNetworkPanel(e) && networkControls().setRadio(enabled));
  ipcMain.handle('wifi:open', (e, target) => fromNetworkPanel(e) && networkControls().open(target));
  const fromTrayPanel = (e) => isWin && panelWidget === 'trayApps' && e.sender === panel?.webContents;
  ipcMain.handle('tray-apps:list', async (e) => {
    if (!fromTrayPanel(e) || trayApps.busy) return null;
    const seq = panelShowSeq;
    const isCurrent = () => seq === panelShowSeq && fromTrayPanel(e);
    if (taskbarWork) await taskbarWork;
    if (!isCurrent()) return null;
    const items = await trayApps.list(isCurrent);
    if (isCurrent() && panel.isVisible() && !panel.isFocused()) panel.focus();
    return items;
  });
  ipcMain.handle('tray-apps:activate', async (e, id, kind) => {
    if (!fromTrayPanel(e) || !panel.isVisible()) return false;
    const seq = panelShowSeq;
    if (taskbarWork) await taskbarWork;
    if (seq !== panelShowSeq || !fromTrayPanel(e) || !panel.isVisible()) return false;
    let hidden = false;
    const success = await trayApps.activate(id, kind, () => {
      if (seq !== panelShowSeq || !fromTrayPanel(e)) return false;
      panel.hide();
      hidden = true;
      return true;
    });
    if (seq !== panelShowSeq || !fromTrayPanel(e)) return success;
    if (success) {
      cancelPendingPanelShow();
      panelWidget = null;
      broadcast('panel', null);
    } else if (hidden) showPanel(seq);
    return success;
  });
  ipcMain.handle('panel:toggle', (_e, widget, x) => togglePanel(widget, x));
  ipcMain.handle('panel:fit-devin', fitDevinPanel);
  ipcMain.handle('panel:close', () => { cancelPendingPanelShow(); if (panel && !panel.isDestroyed()) panel.hide(); panelWidget = null; broadcast('panel', null); });
  ipcMain.handle('settings:open', (_e, tab) => openSettings(tab));
  ipcMain.handle('bar:width', (_e, w) => { if (Math.abs(w - lastContentWidth) > 2) { lastContentWidth = w; if (S().layout === 'pill') layoutBar(); } });
  ipcMain.handle('pomodoro', (_e, action) => pomodoroAction(action));
  ipcMain.handle('refresh', (_e, key) => (refreshers[key] ? refreshers[key]() : null));
  ipcMain.handle('cmd:run', async (_e, id) => {
    const c = (S().commands || []).find((x) => x.id === id);
    if (!c) return null;
    state.commands[id] = await sources.runCommand(c.command);
    broadcast('state', { commands: state.commands });
    return state.commands[id];
  });
  ipcMain.handle('menu', (e, items) => new Promise((resolve) => {
    const toTpl = (list) => list.map((it) => (it.type === 'separator' ? { type: 'separator' } : {
      label: it.label, type: it.checked != null ? 'checkbox' : 'normal', checked: !!it.checked, enabled: it.enabled !== false,
      submenu: it.submenu ? toTpl(it.submenu) : undefined, click: it.submenu ? undefined : () => { picked = it.id; },
    }));
    let picked = null;
    const m = Menu.buildFromTemplate(toTpl(items));
    m.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(picked), 0) });
  }));
  ipcMain.handle('quit', () => app.quit());
}

function registerPreviewIpc() {
  ipcMain.on('preview:hover', (e, payload) => {
    if (e.sender !== bar?.webContents || !payload || !bar || bar.isDestroyed()) return;
    if (panel?.isVisible()) return;
    const viewport = bar.getBounds();
    windowPreview?.hoverDock({ ...payload, anchorX: viewport.x + (Number(payload.anchorX) || viewport.width / 2) });
  });
  ipcMain.on('preview:leave-dock', (e) => { if (e.sender === bar?.webContents) windowPreview?.leaveDock(); });
  ipcMain.on('preview:dismiss', (e) => { if (e.sender === bar?.webContents) windowPreview?.hide(); });
  ipcMain.on('preview:enter-surface', (e) => { if (windowPreview?.webContentsMatches(e.sender)) windowPreview.enterSurface(); });
  ipcMain.on('preview:leave-surface', (e) => { if (windowPreview?.webContentsMatches(e.sender)) windowPreview.leaveSurface(); });
  ipcMain.on('preview:slots', (e, slots) => { if (windowPreview?.webContentsMatches(e.sender)) windowPreview.updateThumbnailSlots(slots); });
  ipcMain.on('preview:peek', (e, hwnd) => { if (windowPreview?.webContentsMatches(e.sender)) windowPreview.peekWindow(hwnd); });
  ipcMain.handle('preview:action', (e, hwnd, action) => (windowPreview?.webContentsMatches(e.sender) ? windowPreview.performAction(hwnd, action) : false));
  ipcMain.handle('preview:context-menu', (e, hwnd) => { if (windowPreview?.webContentsMatches(e.sender)) windowPreview.openContextMenu(hwnd); });
}

// ---------------- lifecycle ----------------
const stoppers = [];
app.on('second-instance', () => openSettings());

function migrateBluetoothLayout() {
  const patch = bluetoothLayoutMigration(S());
  if (patch) settingsStore.set(patch);
}

app.whenReady().then(() => {
  settingsStore = new JsonFile('settings.json', DEFAULT_SETTINGS);
  dataStore = new JsonFile('data.json', DEFAULT_DATA);
  devinStore = new JsonFile('devin.json', { encrypted: '', orgId: '' });
  if (isWin) companion = new DevinCompanion({
    preload: PRELOAD, listLocal: devin.listLocalSessions, listCloud: listCloudDevinSessions,
    foregroundBounds: () => {
      const bounds = win32.foregroundWindowBounds(process.pid);
      return bounds ? screen.screenToDipRect(null, bounds) : null;
    },
  });
  if (isWin) {
    taskbarRecovery = new TaskbarRecovery(app.getPath('userData'));
    batteryNative = createBattery();
    trayApps = new TrayApps(undefined, exeIcon);
  }
  windowPreview = new WindowPreviewController({
    createSurfaceWindow,
    syncBackdrop,
    getBarBounds: () => (bar && !bar.isDestroyed() ? padBounds(bar.getBounds(), -barShadowPadding()) : null),
    raiseDock: () => { if (bar && !bar.isDestroyed()) bar.setAlwaysOnTop(true, 'screen-saver'); },
    getSettings: S,
    getState: () => state,
    win32,
    isWin,
    preload: PRELOAD,
    rendererDir: RENDERER,
    iconPath: ICON,
    shadowPadding: SHADOW_PADDING,
    onPollWindows: pollWindows,
  });
  const firstRun = !require('fs').existsSync(settingsStore.file);
  migrateBluetoothLayout();
  const volumeMigration = volumeLayoutMigration(S());
  if (volumeMigration) settingsStore.set(volumeMigration);
  const trayMigration = trayApps && trayLayoutMigration(S());
  if (trayMigration) settingsStore.set(trayMigration);
  if (firstRun && isWin) {
    settingsStore.set({ pinned: [
      { name: 'File Explorer', path: path.join(process.env.SystemRoot || 'C:/Windows', 'explorer.exe') },
      { name: 'Settings', path: 'ms-settings:' },
    ] });
    settingsStore.save(true);
  }
  if (isWin && app.isPackaged && S().launchAtLogin && win32.isLoginItemMissing(APP_ID)) syncLoginItem();
  registerBrightnessIpc(ipcMain, shell, (e) =>
    panelWidget === 'brightness' && panel && !panel.isDestroyed() && e.sender === panel.webContents, isWin);
  registerIpc();
  registerPreviewIpc();
  if (companion) ipcMain.on('devin:motion-idle', (e) => companion.hideIfIdle(e.sender));
  if (isWin) registerSurfaceIpc();
  createBar();
  bar.on('hide', () => windowPreview?.hide());
  createTray();
  const timers = [
    every(1000, pollWindows),
    every(1000, () => {
      if (panelWidget === 'volume' || hasVolumeWidget(S())) refreshVolume();
    }),
    every(2000, () => { refreshers.system(); runAutomations(); tickPomodoro(); }),
    every(3000, scheduleTaskbar),
    every(10000, refreshBattery),
    every(60 * 1000, refreshers.disk),
    every(15 * 60 * 1000, refreshers.weather),
    every(5 * 60 * 1000, refreshers.calendar),
    every(10 * 60 * 1000, refreshers.github),
    every(5 * 60 * 1000, refreshers.crypto),
  ];
  stoppers.push(() => timers.forEach(clearInterval));
  stoppers.push(() => windowPoll.stop());
  stoppers.push(() => companion?.stop());
  stoppers.push(() => windowPreview?.destroy());
  scheduleCommands();
  if (isWin) stoppers.push(sources.startHelper(onHelper));

  screen.on('display-metrics-changed', layoutBar);
  screen.on('display-added', layoutBar);
  screen.on('display-removed', layoutBar);
  powerMonitor.on('resume', () => { layoutBar(); refreshBattery(); Object.values(refreshers).forEach((f) => f()); });
  if (firstRun) setTimeout(() => openSettings('welcome'), 1200);
});

let cleanedUp = false;
async function cleanup() {
  cleanedUp = true;
  stopBatteryEstimate();
  try { stoppers.forEach((f) => f()); } catch (_) { /* ignore */ }
  try { if (isWin && barHwnd) win32.appBarRemove(barHwnd); } catch (_) { /* ignore */ }
  try { await taskbarWork; await restoreTaskbar(); } catch (_) { /* recovery worker restores the journal */ }
  try { settingsStore.save(true); dataStore.save(true); } catch (_) { /* ignore */ }
}
let shutdown;
function quitAfterCleanup(exit) {
  shutdown ||= cleanup().then(exit);
}
app.on('before-quit', (e) => {
  if (cleanedUp && !shutdown) return;
  e.preventDefault();
  quitAfterCleanup(() => { shutdown = null; app.quit(); });
});
app.on('window-all-closed', (e) => e.preventDefault());
process.on('SIGINT', () => quitAfterCleanup(() => app.exit(0)));
process.on('SIGTERM', () => quitAfterCleanup(() => app.exit(0)));
process.on('uncaughtException', (err) => { console.error(err); });
