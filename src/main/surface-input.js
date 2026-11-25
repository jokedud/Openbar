'use strict';

const CURSOR_INTERVAL_MS = 8;

function inPadding(point, bounds, surface) {
  const x = point.x - bounds.x, y = point.y - bounds.y;
  if (x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return false;
  const sx = x - surface.x, sy = y - surface.y;
  const { width, height } = surface;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return true;
  const r = Math.min(surface.radius, width / 2, height / 2);
  const dx = Math.max(r - sx, sx - (width - r), 0);
  const dy = Math.max(r - sy, sy - (height - r), 0);
  return dx * dx + dy * dy > r * r;
}

class SurfaceInput {
  constructor(win, getCursor, getSurface, timers = { setInterval, clearInterval }) {
    Object.assign(this, { win, getCursor, getSurface, timers });
    this.timer = null;
  }

  cursorInPadding() {
    const surface = this.getSurface();
    return surface && this.win.isVisible() && inPadding(this.getCursor(), this.win.getBounds(), surface);
  }

  update(overPadding) {
    if (this.timer !== null) {
      if (!this.cursorInPadding()) this.stop();
      return;
    }
    if (!overPadding) return;
    if (!this.cursorInPadding()) { this.resetRenderer(); return; }
    // Forwarded mouse moves install a system-wide hook on Electron's UI thread.
    this.win.setIgnoreMouseEvents(true);
    this.timer = this.timers.setInterval(() => {
      if (!this.cursorInPadding()) this.stop();
    }, CURSOR_INTERVAL_MS);
  }

  resetRenderer() {
    this.win.webContents.send('surface:mouse-reset');
  }

  stop() {
    if (this.timer === null) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
    if (!this.win.isDestroyed()) {
      this.win.setIgnoreMouseEvents(false);
      this.resetRenderer();
    }
  }
}

module.exports = { SurfaceInput };
