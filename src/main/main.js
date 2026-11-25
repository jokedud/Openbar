'use strict';
const path = require('path');
const { stat } = require('fs/promises');
const { app, BrowserWindow, dialog, ipcMain, screen, shell, Notification, Tray, Menu, nativeImage, nativeTheme, powerMonitor } = require('electron');
const { JsonFile, DEFAULT_SETTINGS, DEFAULT_DATA } = require('./store');
const { shortcutTarget } = require('./custom-tabs');
const TaskbarRecovery = require('./taskbar-recovery');
const sources = require('./sources');
const calendar = require('./calendar');
const startmenu = require('./startmenu');

const isWin = process.platform === 'win32';
const win32 = isWin ? require('./win32') : null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('xyz.openbar.app');

let settingsStore, dataStore, taskbarRecovery;
let bar = null, panel = null, settingsWin = null, tray = null;
let barHwnd = 0, panelHwnd = 0;
let panelWidget = null;
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
  for (const w of [bar, panel, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
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
  const thickness = s.height + 2 * s.margin;
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
  // Windows may move the reserved strip (e.g. above a visible taskbar); follow it.
  if (reserved && reserved.height > 0) b.y = reserved.y;
  bar.setBounds(b);
  clipGlass(bar, barHwnd, S().margin, barRadius(S().height), b);
  bar.setAlwaysOnTop(true, 'screen-saver');
}

// ---------------- glass ----------------
// Same ratios as --bar-r / --panel-r in theme.css and common.js, so the blur region matches the CSS shape.
const barRadius = (height) => Math.round(height * 0.3);
const PANEL_RADIUS = 18;
let glassMode = 'off';
function transparencyEnabled() {
  try {
    const key = require('path').win32.join('HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Themes', 'Personalize');
    const out = require('child_process').execFileSync('reg', ['query', key, '/v', 'EnableTransparency'], { encoding: 'utf8', windowsHide: true });
    return !/REG_DWORD\s+0x0\b/.test(out);
  } catch { return true; }
}
function setBackdrop(hwnd, mode) {
  try { return win32.setBackdrop(hwnd, mode); } catch (e) { console.error('backdrop', e); return 'off'; }
}
// The bar decides whether glass is on; panels follow it so both windows always share one tint.
function enableGlass(hwnd) {
  if (!isWin || !hwnd) return;
  glassMode = setBackdrop(hwnd, transparencyEnabled() ? 'blur' : 'off');
  state.glass = glassMode;
  broadcast('state', { glass: glassMode });
}
// Windows broadcasts a theme change when "Transparency effects" is toggled.
function refreshGlass() {
  enableGlass(barHwnd);
  if (panel && !panel.isDestroyed() && panelHwnd) setBackdrop(panelHwnd, glassMode);
  layoutBar();
}
// Windows applies a resize lazily, so callers pass the size they just set instead of reading it back.
function clipGlass(win, hwnd, inset, radius, size = win.getContentBounds()) {
  if (!isWin || !hwnd) return;
  const { width, height } = size;
  const k = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  const px = (v) => Math.round(v * k);
  // Opaque windows drop the clip so a resized window is never cut to an old shape.
  const region = glassMode === 'off' ? null
    : { x: px(inset), y: px(inset), width: px(width - 2 * inset), height: px(height - 2 * inset), radius: px(radius) + 1 };
  try { win32.setRoundRegion(hwnd, region); } catch (e) { console.error('region', e); }
}

// ---------------- Windows taskbar ----------------
function applyTaskbar() {
  if (!isWin) return;
  const pending = taskbarRecovery.pending();
  if (pending && pending.id !== taskbarRecovery.id) {
    taskbarRecovery.resume(pending);
    return;
  }
  const mode = S().taskbar;
  if (mode === 'keep') { restoreTaskbar(); return; }
  if (!win32.hasTaskbar()) return;
  const visible = mode !== 'hide';
  const original = D().taskbarRestore;
  const autohide = (win32.getTaskbarState() & win32.ABS_AUTOHIDE) !== 0;
  const alreadySet = autohide && win32.taskbarVisibilityIs(visible);
  const legacy = original && !original.guarded;
  const overridden = pending && pending.phase !== 'prepared';
  if (alreadySet && !legacy && !overridden) return;
  const baseline = legacy ? !!original.autohide : autohide;
  if (!taskbarRecovery.arm(baseline)) {
    if (overridden) restoreTaskbar();
    return;
  }
  if (alreadySet && pending?.phase === 'applied') return;
  // Journal intent before touching Explorer or replacing a legacy baseline.
  if (!taskbarRecovery.recordOverride(baseline)) return;
  if (pending?.phase === 'prepared') {
    dataStore.set({ taskbarRestore: { autohide: baseline, guarded: true, id: taskbarRecovery.id } });
    dataStore.save(true);
  }
  if (!autohide) win32.setTaskbarAutoHide(true);
  if (win32.setTaskbarVisible(visible) && (win32.getTaskbarState() & win32.ABS_AUTOHIDE)) {
    taskbarRecovery.markApplied();
  }
}

function restoreTaskbar() {
  if (!isWin || !taskbarRecovery) return;
  const pending = taskbarRecovery.pending();
  if (pending && pending.id !== taskbarRecovery.id) return;
  const r = D().taskbarRestore;
  const original = pending && pending.phase !== 'prepared' ? pending : (r && !r.guarded ? r : null);
  if (original) {
    if (!win32.hasTaskbar()) return;
    win32.setTaskbarAutoHide(!!original.autohide);
    if (!win32.setTaskbarVisible(true) || !win32.hasTaskbar() ||
        ((win32.getTaskbarState() & win32.ABS_AUTOHIDE) !== 0) !== !!original.autohide) return;
  }
  taskbarRecovery.restored();
  if (r) {
    dataStore.set({ taskbarRestore: null });
    dataStore.save(true);
  }
}

// ---------------- running windows + screen time ----------------
const iconCache = new Map();
async function exeIcon(file) {
  if (!file) return '';
  if (iconCache.has(file)) return iconCache.get(file);
  iconCache.set(file, '');
  try {
    const img = await app.getFileIcon(file, { size: 'normal' });
    iconCache.set(file, img.toDataURL());
  } catch (_) { /* no icon */ }
  return iconCache.get(file);
}

const pidPath = new Map();
let lastTick = Date.now();
async function pollWindows() {
  if (!isWin) return;
  const own = new Set([process.pid]);
  for (const m of app.getAppMetrics()) own.add(m.pid);
  let list = [];
  try { list = win32.listTaskbarWindows(own); } catch (e) { state.errors.windows = String(e.message); }
  for (const w of list) {
    if (!pidPath.has(w.pid)) pidPath.set(w.pid, win32.processPath(w.pid));
    w.path = pidPath.get(w.pid);
    w.exe = w.path ? path.basename(w.path) : w.cls;
    w.icon = await exeIcon(w.path);
  }
  const active = win32.foregroundWindow();
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
  const sig = JSON.stringify([list.map((w) => [w.hwnd, w.title, w.minimized]), active, recentHwnds, windowAppOrder]);
  if (sig !== pollWindows.sig) {
    pollWindows.sig = sig;
    const windowState = { windows: list, activeHwnd: active, recentHwnds, windowAppOrder };
    Object.assign(state, windowState);
    broadcast('state', windowState);
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
  bar = new BrowserWindow({
    ...barBounds(), frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
    maximizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
    title: 'OpenBar', icon: ICON, webPreferences,
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.webContents.on('render-process-gone', () => {
    if (!cleanedUp && isWin && D().taskbarRestore) app.quit();
  });
  bar.loadFile(path.join(RENDERER, 'bar.html'));
  bar.once('ready-to-show', () => { bar.showInactive(); layoutBar(); });
  if (isWin) { barHwnd = win32.hwndFromBuffer(bar.getNativeWindowHandle()); enableGlass(barHwnd); nativeTheme.on('updated', refreshGlass); }
  bar.on('closed', () => { bar = null; });
}

const PANEL_SIZES = { calendar: [380, 520], weather: [380, 540], system: [360, 420], todos: [360, 460], notes: [380, 420], media: [360, 260], pomodoro: [320, 300], github: [360, 420], crypto: [320, 340], clock: [340, 480], apps: [520, 560], screenTime: [360, 440], network: [320, 220], battery: [300, 200], quick: [320, 320], start: [520, 560] };

function togglePanel(widget, anchorX) {
  if (panel && !panel.isDestroyed() && panel.isVisible() && panelWidget === widget) { panel.hide(); panelWidget = null; return; }
  const [w, preferredH] = PANEL_SIZES[widget] || [360, 420];
  const bb = bar.getBounds();
  const d = screen.getDisplayMatching(bb).workArea;
  const db = screen.getDisplayMatching(bb).bounds;
  const room = S().position === 'top' ? db.y + db.height - (bb.y + bb.height) : bb.y - db.y;
  const h = Math.min(preferredH, room - 14);
  let x = Math.round(bb.x + (anchorX || bb.width / 2) - w / 2);
  x = Math.max(db.x + 8, Math.min(x, db.x + db.width - w - 8));
  const gap = 6;
  const y = S().position === 'top' ? bb.y + bb.height + gap : bb.y - h - gap;
  if (!panel || panel.isDestroyed()) {
    panel = new BrowserWindow({
      x, y, width: w, height: h, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true,
      show: false, hasShadow: false, title: 'OpenBar panel', icon: ICON, webPreferences,
    });
    panel.setAlwaysOnTop(true, 'screen-saver');
    panel.on('blur', () => { if (panel && !panel.webContents.isDevToolsOpened()) { panel.hide(); panelWidget = null; broadcast('panel', null); } });
    panel.on('closed', () => { panel = null; panelWidget = null; });
    panel.loadFile(path.join(RENDERER, 'panel.html'), { query: { widget } });
    panelHwnd = isWin ? win32.hwndFromBuffer(panel.getNativeWindowHandle()) : 0;
    if (panelHwnd) setBackdrop(panelHwnd, glassMode);
    clipGlass(panel, panelHwnd, 0, PANEL_RADIUS, { width: w, height: h });
    panel.once('ready-to-show', () => { panel.show(); panel.focus(); });
  } else {
    panel.setBounds({ x, y, width: w, height: h });
    clipGlass(panel, panelHwnd, 0, PANEL_RADIUS, { width: w, height: h });
    panel.webContents.send('panel:widget', widget);
    panel.show(); panel.focus();
  }
  void d;
  panelWidget = widget;
  broadcast('panel', widget);
}

function openSettings(tab) {
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
function applySettings(prev) {
  const s = S();
  layoutBar();
  if (prev.taskbar !== s.taskbar) applyTaskbar();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!s.launchAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
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

function registerIpc() {
  ipcMain.handle('init', () => ({ settings: S(), data: D(), state, platform: process.platform, version: app.getVersion() }));
  ipcMain.handle('settings:set', (_e, patch) => { const prev = JSON.parse(JSON.stringify(S())); settingsStore.set(patch); applySettings(prev); return S(); });
  ipcMain.handle('settings:replace', (_e, v) => { const prev = JSON.parse(JSON.stringify(S())); settingsStore.replace(v); applySettings(prev); return S(); });
  ipcMain.handle('settings:reset', () => { const prev = JSON.parse(JSON.stringify(S())); settingsStore.replace(DEFAULT_SETTINGS); applySettings(prev); return S(); });
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
  ipcMain.handle('panel:toggle', (_e, widget, x) => togglePanel(widget, x));
  ipcMain.handle('panel:close', () => { if (panel && !panel.isDestroyed()) panel.hide(); panelWidget = null; broadcast('panel', null); });
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

// ---------------- lifecycle ----------------
const stoppers = [];
app.on('second-instance', () => openSettings());

app.whenReady().then(() => {
  settingsStore = new JsonFile('settings.json', DEFAULT_SETTINGS);
  dataStore = new JsonFile('data.json', DEFAULT_DATA);
  if (isWin) taskbarRecovery = new TaskbarRecovery(app.getPath('userData'));
  const firstRun = !require('fs').existsSync(settingsStore.file);
  if (firstRun && isWin) {
    settingsStore.set({ pinned: [
      { name: 'File Explorer', path: path.join(process.env.SystemRoot || 'C:/Windows', 'explorer.exe') },
      { name: 'Settings', path: 'ms-settings:' },
    ] });
    settingsStore.save(true);
  }
  registerIpc();
  createBar();
  createTray();
  applyTaskbar();

  const timers = [
    every(1000, pollWindows),
    every(2000, () => { refreshers.system(); runAutomations(); tickPomodoro(); }),
    every(3000, applyTaskbar),
    every(60 * 1000, refreshers.disk),
    every(15 * 60 * 1000, refreshers.weather),
    every(5 * 60 * 1000, refreshers.calendar),
    every(10 * 60 * 1000, refreshers.github),
    every(5 * 60 * 1000, refreshers.crypto),
  ];
  stoppers.push(() => timers.forEach(clearInterval));
  scheduleCommands();
  if (isWin) stoppers.push(sources.startHelper(onHelper));

  screen.on('display-metrics-changed', layoutBar);
  screen.on('display-added', layoutBar);
  screen.on('display-removed', layoutBar);
  powerMonitor.on('resume', () => { layoutBar(); Object.values(refreshers).forEach((f) => f()); });
  if (firstRun) setTimeout(() => openSettings('welcome'), 1200);
});

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try { stoppers.forEach((f) => f()); } catch (_) { /* ignore */ }
  try { if (isWin && barHwnd) win32.appBarRemove(barHwnd); } catch (_) { /* ignore */ }
  try { restoreTaskbar(); } catch (_) { /* ignore */ }
  try { settingsStore.save(true); dataStore.save(true); } catch (_) { /* ignore */ }
}
app.on('before-quit', cleanup);
app.on('window-all-closed', (e) => e.preventDefault());
process.on('SIGINT', () => { cleanup(); app.exit(0); });
process.on('SIGTERM', () => { cleanup(); app.exit(0); });
process.on('uncaughtException', (err) => { console.error(err); });
