'use strict';
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { activeSession } = require('../renderer/devin-motion');
const CLOUD_PAGE_LIMIT = 5;

class DevinCompanion {
  constructor({ preload, listLocal, listCloud, foregroundBounds }) {
    Object.assign(this, { preload, listLocal, listCloud, foregroundBounds });
    this.cloud = [];
    this.cloudAt = 0;
    this.revision = 0;
    this.dockVisible = false;
  }

  configure(settings, dock, credentialsChanged = false) {
    const changed = this.cursor !== settings.devinCursor || this.otter !== settings.devinOtter;
    this.cursor = settings.devinCursor;
    this.otter = settings.devinOtter;
    this.dock = dock && { ...dock, margin: settings.margin, position: settings.position };
    const enabled = this.cursor || this.otter;
    if (credentialsChanged || !enabled) {
      this.revision++;
      this.cloudAt = 0;
      this.cloud = [];
      this.request = null;
    }
    if (enabled && !this.timer) this.timer = setInterval(() => this.poll(), 1000);
    if (!enabled) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (enabled && (changed || credentialsChanged)) this.poll();
    else this.present();
  }

  poll() {
    const now = Date.now();
    this.activity = activeSession(this.listLocal(), this.cloud, now);
    this.present();
    if (this.request || now - this.cloudAt < 20000) return;
    this.cloudAt = now;
    const revision = this.revision;
    this.request = this.listCloudPages(revision).then((page) => {
      if (revision !== this.revision) return;
      this.request = null;
      if (page.sessions) this.cloud = page.sessions;
      else if (['missing', 'auth', 'organization', 'storage'].includes(page.error)) this.cloud = [];
      this.activity = activeSession(this.listLocal(), this.cloud, Date.now());
      this.present();
    });
  }

  async listCloudPages(revision) {
    const sessions = [];
    const seen = new Set();
    let cursor;
    for (let i = 0; i < CLOUD_PAGE_LIMIT; i++) {
      const page = await this.listCloud(cursor);
      if (revision !== this.revision) return {};
      if (!page.sessions) return i === 0 ? page : { sessions };
      sessions.push(...page.sessions);
      cursor = page.next;
      if (cursor == null || seen.has(cursor)) break;
      seen.add(cursor);
    }
    return { sessions };
  }

  present() {
    if (!this.dock || !this.dockVisible) return;
    const working = !!this.activity && (this.cursor || this.otter);
    if (!this.window && !this.otter && !(this.cursor && working)) return;
    const display = screen.getPrimaryDisplay();
    const bounds = display.bounds;
    const foreground = this.cursor && working ? this.foregroundBounds() : null;
    const loc = (r) => ({ x: r.x - bounds.x, y: r.y - bounds.y, width: r.width, height: r.height });
    const workArea = display.workArea;
    const frame = foreground && intersect(foreground, workArea);
    const payload = {
      otter: this.otter, cursor: this.cursor, working, session: working ? this.activity : null,
      dock: { ...this.dock, ...loc(this.dock) },
      region: loc(frame || workArea),
    };
    if (!this.window) this.create(bounds);
    const { window } = this;
    const boundsKey = JSON.stringify(bounds);
    if (this.boundsKey !== boundsKey) {
      this.boundsKey = boundsKey;
      window.setBounds(bounds);
    }
    const key = JSON.stringify(payload);
    this.payload = payload;
    if (key === this.key) return;
    this.key = key;
    if (this.ready) {
      window.webContents.send('devin:motion', payload);
      if (!window.isVisible() && (this.otter || (this.cursor && working))) window.showInactive();
    }
  }

  create(bounds) {
    const window = this.window = new BrowserWindow({
      ...bounds, frame: false, transparent: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, skipTaskbar: true, focusable: false, hasShadow: false, show: false,
      webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.key = null;
      this.present();
    });
    window.on('closed', () => { this.window = null; this.ready = false; this.key = null; });
    window.loadFile(path.join(__dirname, '..', 'renderer', 'devin-overlay.html'));
  }

  setDockVisible(visible) {
    if (this.dockVisible === visible) return;
    this.dockVisible = visible;
    if (visible) {
      this.key = null;
      this.present();
    } else {
      if (this.ready) this.window.webContents.send('devin:motion-pause');
      this.window?.hide();
    }
  }

  hideIfIdle(sender) {
    if (sender === this.window?.webContents && !this.otter && !(this.cursor && this.payload.working)) this.window.hide();
  }

  raise() {
    if (this.window?.isVisible()) this.window.moveTop();
  }

  stop() {
    clearInterval(this.timer);
    this.revision++;
  }
}

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 48 && height > 48 ? { x, y, width, height } : null;
}

module.exports = DevinCompanion;
