'use strict';
const path = require('path');
const { Menu, screen } = require('electron');

const CARD_WIDTH = 224;
const CARD_HEIGHT = 170;
const CARD_GAP = 10;
const SURFACE_PAD = 10;
const LIST_WIDTH = 280;
const LIST_ROW_HEIGHT = 36;
const GAP_FROM_BAR = 8;
const OPEN_DELAY_MS = 260;
const HIDE_DELAY_MS = 260;

function padBounds({ x, y, width, height }, padding) {
  return { x: x - padding, y: y - padding, width: width + 2 * padding, height: height + 2 * padding };
}

function fitThumbnailRect(slot, source, scaleFactor = 1) {
  if (!slot || !Number.isFinite(slot.width) || !Number.isFinite(slot.height) || slot.width <= 0 || slot.height <= 0) {
    return null;
  }
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const slotX = slot.x * sf;
  const slotY = slot.y * sf;
  const slotW = slot.width * sf;
  const slotH = slot.height * sf;

  let drawW = slotW;
  let drawH = slotH;
  if (source && source.width > 0 && source.height > 0) {
    const scale = Math.min(slotW / source.width, slotH / source.height);
    drawW = Math.max(1, source.width * scale);
    drawH = Math.max(1, source.height * scale);
  }

  const left = Math.round(slotX + (slotW - drawW) / 2);
  const top = Math.round(slotY + (slotH - drawH) / 2);
  const right = Math.max(left + 1, Math.round(left + drawW));
  const bottom = Math.max(top + 1, Math.round(top + drawH));
  return { left, top, right, bottom };
}

function computePreviewBounds({ anchorX, barRect, displayBounds, windowCount, position = 'bottom', shadowPadding = 24, compact = false }) {
  const count = Math.max(1, windowCount | 0);
  const marginX = 8;
  const maxAvailW = Math.max(CARD_WIDTH + 2 * SURFACE_PAD, displayBounds.width - 2 * marginX);
  const maxCards = Math.max(1, Math.floor((maxAvailW - 2 * SURFACE_PAD + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));
  const isCompact = compact || count > maxCards;
  const atTop = position === 'top';
  const room = atTop
    ? displayBounds.y + displayBounds.height - (barRect.y + barRect.height) - GAP_FROM_BAR - 8
    : barRect.y - displayBounds.y - GAP_FROM_BAR - 8;

  let width, height;
  if (isCompact) {
    width = Math.min(LIST_WIDTH, maxAvailW);
    const maxRows = Math.max(3, Math.floor((Math.max(120, room) - 2 * SURFACE_PAD) / LIST_ROW_HEIGHT));
    const rows = Math.min(count, maxRows);
    height = rows * LIST_ROW_HEIGHT + 2 * SURFACE_PAD;
  } else {
    width = count * CARD_WIDTH + (count - 1) * CARD_GAP + 2 * SURFACE_PAD;
    height = CARD_HEIGHT + 2 * SURFACE_PAD;
  }

  const minX = displayBounds.x + marginX;
  const maxX = Math.max(minX, displayBounds.x + displayBounds.width - width - marginX);
  const x = Math.max(minX, Math.min(Math.round(anchorX - width / 2), maxX));

  let y = atTop ? barRect.y + barRect.height + GAP_FROM_BAR : barRect.y - height - GAP_FROM_BAR;
  const minY = displayBounds.y + 8;
  const maxY = Math.max(minY, displayBounds.y + displayBounds.height - height - 8);
  y = Math.max(minY, Math.min(Math.round(y), maxY));

  const surface = { x, y, width, height };
  return { surface, bounds: padBounds(surface, shadowPadding), compact: isCompact };
}

class WindowPreviewController {
  constructor({
    createSurfaceWindow, syncBackdrop, getBarBounds, getSettings, getState,
    win32, isWin, preload, rendererDir, iconPath, shadowPadding = 24,
    onPollWindows, timers = {},
  }) {
    this.createSurfaceWindow = createSurfaceWindow;
    this.syncBackdrop = syncBackdrop;
    this.getBarBounds = getBarBounds;
    this.getSettings = getSettings;
    this.getState = getState;
    this.win32 = win32;
    this.isWin = isWin;
    this.preload = preload;
    this.rendererDir = rendererDir;
    this.iconPath = iconPath;
    this.shadowPadding = shadowPadding;
    this.onPollWindows = onPollWindows || (() => {});
    this.setTimer = timers.setTimeout || setTimeout;
    this.clearTimer = timers.clearTimeout || clearTimeout;

    this.win = null;
    this.hwnd = 0;
    this.ready = false;
    this.visible = false;
    this.pointerInPreview = false;
    this.menuOpen = false;
    this.openTimer = null;
    this.hideTimer = null;
    this.current = null; // { appKey, hwnds, anchorX, compact }
    this.thumbnails = new Map(); // srcHwnd -> thumbId
    this.lastPayload = null;
  }

  isOpen() {
    return !!(this.visible && this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  webContentsMatches(sender) {
    return !!(this.win && !this.win.isDestroyed() && sender === this.win.webContents);
  }

  clearTimers() {
    if (this.openTimer) { this.clearTimer(this.openTimer); this.openTimer = null; }
    if (this.hideTimer) { this.clearTimer(this.hideTimer); this.hideTimer = null; }
  }

  resolveWindows(request) {
    const state = this.getState();
    const all = state.windows || [];
    if (!request) return [];
    let list = [];
    if (request.appKey && this.getSettings().groupWindows) {
      list = all.filter((w) => (w.path || w.exe || '').toLowerCase() === request.appKey);
    }
    if (!list.length && Array.isArray(request.hwnds) && request.hwnds.length) {
      const set = new Set(request.hwnds);
      list = all.filter((w) => set.has(w.hwnd));
    }
    return list;
  }

  hoverDock({ hwnds, anchorX, appKey }) {
    const cleanHwnds = Array.isArray(hwnds) ? hwnds.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    const normalizedKey = typeof appKey === 'string' ? appKey.toLowerCase() : '';
    const req = { hwnds: cleanHwnds, anchorX: Number(anchorX) || 0, appKey: normalizedKey };

    if (this.hideTimer) { this.clearTimer(this.hideTimer); this.hideTimer = null; }

    const matched = this.resolveWindows(req);
    if (!matched.length) {
      if (this.openTimer) { this.clearTimer(this.openTimer); this.openTimer = null; }
      if (this.visible) this.scheduleHide();
      return;
    }

    if (this.visible) {
      const sameTarget = this.current &&
        this.current.appKey === req.appKey &&
        this.current.hwnds.length === matched.length &&
        this.current.hwnds.every((h, i) => h === matched[i].hwnd);
      if (sameTarget) {
        this.current.anchorX = req.anchorX;
        return;
      }
      // Switch immediately when moving across dock icons while already open.
      if (this.openTimer) { this.clearTimer(this.openTimer); this.openTimer = null; }
      this.showFor(req, matched, true);
      return;
    }

    if (this.openTimer) this.clearTimer(this.openTimer);
    this.openTimer = this.setTimer(() => {
      this.openTimer = null;
      const live = this.resolveWindows(req);
      if (live.length) this.showFor(req, live, false);
    }, OPEN_DELAY_MS);
  }

  leaveDock() {
    if (this.openTimer) { this.clearTimer(this.openTimer); this.openTimer = null; }
    if (this.visible && !this.pointerInPreview && !this.menuOpen) {
      this.scheduleHide();
    }
  }

  enterSurface() {
    this.pointerInPreview = true;
    if (this.hideTimer) { this.clearTimer(this.hideTimer); this.hideTimer = null; }
  }

  leaveSurface() {
    this.pointerInPreview = false;
    if (this.visible && !this.menuOpen) {
      this.scheduleHide();
    }
  }

  scheduleHide() {
    if (this.hideTimer) this.clearTimer(this.hideTimer);
    this.hideTimer = this.setTimer(() => {
      this.hideTimer = null;
      if (!this.pointerInPreview && !this.menuOpen) this.hide();
    }, HIDE_DELAY_MS);
  }

  ensureWindow(bounds) {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const webPreferences = {
      preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
    };
    this.win = this.createSurfaceWindow({
      ...bounds, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false, show: false,
      title: 'OpenBar window preview', icon: this.iconPath, webPreferences,
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    if (this.isWin && this.win32) {
      this.hwnd = this.win32.hwndFromBuffer(this.win.getNativeWindowHandle());
    }
    this.ready = false;
    this.win.webContents.on('did-finish-load', () => {
      this.ready = true;
      if (this.visible && this.lastPayload && this.win && !this.win.isDestroyed()) {
        this.win.webContents.send('preview:data', this.lastPayload);
      }
    });
    this.win.on('hide', () => this.clearThumbnails());
    this.win.on('closed', () => {
      this.clearThumbnails();
      this.win = null;
      this.hwnd = 0;
      this.ready = false;
      this.visible = false;
      this.current = null;
    });
    this.win.loadFile(path.join(this.rendererDir, 'preview.html'));
    return this.win;
  }

  showFor(req, windows, switching) {
    const barRect = this.getBarBounds();
    if (!barRect) return;
    const display = screen.getDisplayMatching(barRect);
    const settings = this.getSettings();
    const state = this.getState();

    const layout = computePreviewBounds({
      anchorX: req.anchorX,
      barRect,
      displayBounds: display.bounds,
      windowCount: windows.length,
      position: settings.position,
      shadowPadding: this.shadowPadding,
    });

    this.current = {
      appKey: req.appKey,
      hwnds: windows.map((w) => w.hwnd),
      anchorX: req.anchorX,
      compact: layout.compact,
    };

    const win = this.ensureWindow(layout.bounds);
    const prevBounds = win.getBounds();
    if (prevBounds.x !== layout.bounds.x || prevBounds.y !== layout.bounds.y ||
        prevBounds.width !== layout.bounds.width || prevBounds.height !== layout.bounds.height) {
      win.setBounds(layout.bounds);
      this.syncBackdrop(win);
    }

    const payload = {
      windows: windows.map((w) => ({
        hwnd: w.hwnd,
        title: w.title,
        exe: w.exe,
        icon: w.icon || '',
        minimized: !!w.minimized,
        maximized: !!w.maximized,
        active: w.hwnd === state.activeHwnd,
      })),
      compact: layout.compact,
      switching: !!switching,
      hasLiveThumbnails: !!(this.isWin && this.win32 && !layout.compact),
    };
    this.lastPayload = payload;
    this.visible = true;

    if (layout.compact) this.clearThumbnails();
    if (this.ready) win.webContents.send('preview:data', payload);
    if (!win.isVisible()) {
      win.showInactive();
      this.syncBackdrop(win);
    }
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  hide() {
    this.clearTimers();
    this.pointerInPreview = false;
    this.menuOpen = false;
    this.visible = false;
    this.current = null;
    this.lastPayload = null;
    this.clearThumbnails();
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
    }
  }

  syncWindows() {
    if (!this.visible || !this.current) return;
    const live = this.resolveWindows(this.current);
    if (!live.length) {
      this.hide();
      return;
    }
    this.showFor(this.current, live, true);
  }

  clearThumbnails() {
    if (this.isWin && this.win32) {
      for (const thumbId of this.thumbnails.values()) {
        try { this.win32.unregisterThumbnail(thumbId); } catch (_) { /* ignore */ }
      }
    }
    this.thumbnails.clear();
  }

  updateThumbnailSlots(slots) {
    if (!this.isWin || !this.win32 || !this.visible || !this.win || this.win.isDestroyed() || !this.hwnd) {
      this.clearThumbnails();
      return;
    }
    if (this.current?.compact || !Array.isArray(slots)) {
      this.clearThumbnails();
      return;
    }

    const wanted = new Set();
    const display = screen.getDisplayMatching(this.win.getBounds());
    const scaleFactor = display?.scaleFactor || 1;

    for (const slot of slots) {
      const srcHwnd = Number(slot?.hwnd);
      if (!Number.isFinite(srcHwnd) || srcHwnd <= 0) continue;
      if (!this.win32.IsWindow(srcHwnd)) continue;
      wanted.add(srcHwnd);

      let thumbId = this.thumbnails.get(srcHwnd);
      if (!thumbId) {
        thumbId = this.win32.registerThumbnail(this.hwnd, srcHwnd);
        if (!thumbId) continue;
        this.thumbnails.set(srcHwnd, thumbId);
      }
      const sourceSize = this.win32.queryThumbnailSourceSize(thumbId);
      const rect = fitThumbnailRect(slot, sourceSize, scaleFactor);
      if (!rect) {
        this.win32.updateThumbnail(thumbId, { left: 0, top: 0, right: 1, bottom: 1, opacity: 0, visible: false });
        continue;
      }
      this.win32.updateThumbnail(thumbId, { ...rect, opacity: 255, visible: true, clientAreaOnly: false });
    }

    for (const [srcHwnd, thumbId] of this.thumbnails.entries()) {
      if (!wanted.has(srcHwnd)) {
        try { this.win32.unregisterThumbnail(thumbId); } catch (_) { /* ignore */ }
        this.thumbnails.delete(srcHwnd);
      }
    }
  }

  performAction(hwnd, action) {
    const h = Number(hwnd);
    if (!this.isWin || !this.win32 || !Number.isFinite(h) || h <= 0 || !this.win32.IsWindow(h)) return false;
    if (action === 'focus') {
      this.win32.focusWindow(h);
      this.hide();
    } else if (action === 'restore') {
      this.win32.restoreWindow(h);
      this.win32.focusWindow(h, { restore: false });
      this.hide();
    } else if (action === 'maximize') {
      this.win32.maximizeWindow(h);
      this.win32.focusWindow(h, { restore: false });
      this.hide();
    } else if (action === 'minimize') {
      this.win32.minimizeWindow(h);
    } else if (action === 'close') {
      this.win32.closeWindow(h);
    } else {
      return false;
    }
    this.setTimer(() => this.onPollWindows(), 120);
    return true;
  }

  openContextMenu(hwnd) {
    const h = Number(hwnd);
    if (!this.win || this.win.isDestroyed() || !Number.isFinite(h) || h <= 0) return;
    const state = this.getState();
    const target = (state.windows || []).find((w) => w.hwnd === h);
    if (!target) return;

    this.menuOpen = true;
    if (this.hideTimer) { this.clearTimer(this.hideTimer); this.hideTimer = null; }

    const menu = Menu.buildFromTemplate([
      { label: 'Restore', enabled: !!(target.minimized || target.maximized), click: () => this.performAction(h, 'restore') },
      { label: 'Minimize', enabled: !target.minimized, click: () => this.performAction(h, 'minimize') },
      { label: 'Maximize', enabled: !target.maximized, click: () => this.performAction(h, 'maximize') },
      { type: 'separator' },
      { label: 'Close window', click: () => this.performAction(h, 'close') },
    ]);
    menu.popup({
      window: this.win,
      callback: () => {
        this.menuOpen = false;
        if (this.visible && !this.pointerInPreview) this.scheduleHide();
      },
    });
  }

  destroy() {
    this.clearTimers();
    this.clearThumbnails();
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
    this.hwnd = 0;
  }
}

module.exports = {
  WindowPreviewController,
  computePreviewBounds,
  fitThumbnailRect,
  CARD_WIDTH,
  CARD_HEIGHT,
  CARD_GAP,
  SURFACE_PAD,
  OPEN_DELAY_MS,
  HIDE_DELAY_MS,
};
