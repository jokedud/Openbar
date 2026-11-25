'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_NOTIFICATIONS = 50;
const MAX_DISMISSED_IDS = 200;
const SAFE_LAUNCH_URL = /^(?:ms-settings:[a-z0-9._-]+|https?:\/\/\S+)$/i;

const KNOWN_APPS = {
  'xyz.openbar.app': 'OpenBar',
  'windows.systemtoast.startupapp': 'Startup Apps',
  'windows.systemtoast.securityandmaintenance': 'Windows Security',
  'windows.systemtoast.windowsupdate': 'Windows Update',
  'windows.systemtoast.lowdisk': 'Storage',
  'windows.systemtoast.bthquickpair': 'Bluetooth',
  'windows.systemtoast.wi-fi': 'Wi-Fi',
  'windows.systemtoast.autoplay': 'AutoPlay',
  'windows.systemtoast.print.notification': 'Printers',
  'microsoft.windows.explorer': 'File Explorer',
  'microsoft.windows.secHealthui_cw5n1h2txyewy!sechealthui': 'Windows Security',
  'docker.dockerforwindows.settings': 'Docker Desktop',
};

const NOISE_SEGMENTS = new Set([
  'com', 'org', 'net', 'io', 'app', 'desktop', 'settings', 'squirrel',
  'windows', 'microsoft', 'systemtoast', 'exe', 'client', 'launcher', 'helper',
]);

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function splitCamelCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatAppName(primaryId, displayName) {
  if (typeof displayName === 'string') {
    const clean = displayName.trim();
    if (clean && !clean.startsWith('ms-resource:') && !clean.startsWith('@{')) return clean;
  }
  const raw = typeof primaryId === 'string' ? primaryId.trim() : '';
  if (!raw) return 'Windows';
  const lower = raw.toLowerCase();
  if (Object.hasOwn(KNOWN_APPS, lower)) return KNOWN_APPS[lower];

  // Strip UWP package family hash (e.g. Microsoft.Teams_8wekyb3d8bbwe!App)
  const withoutFamily = raw.replace(/_[a-z0-9]{13}(?:!.*)?$/i, '');
  // Strip executable paths if PrimaryId is a file path
  const base = /[\\/]/.test(withoutFamily)
    ? path.win32.basename(withoutFamily).replace(/\.exe$/i, '')
    : withoutFamily;
  const parts = base.split(/[.:!]+/).filter(Boolean);
  const meaningful = parts.filter((part) => !NOISE_SEGMENTS.has(part.toLowerCase()));
  const chosen = meaningful[meaningful.length - 1] || parts[parts.length - 1] || raw;
  const formatted = splitCamelCase(chosen);
  return formatted || 'Windows';
}

function safeLaunchUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SAFE_LAUNCH_URL.test(trimmed) ? trimmed : null;
}

function parseToastPayload(payload) {
  if (!payload) return null;
  const xml = typeof payload === 'string'
    ? payload
    : Buffer.from(payload).toString('utf8');
  if (!xml.trim()) return null;

  const texts = [];
  const textRe = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let match;
  while ((match = textRe.exec(xml)) !== null) {
    const cleaned = decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    if (cleaned) texts.push(cleaned);
  }
  if (!texts.length) return null;

  let launchUrl = null;
  const toastTag = xml.match(/<toast\b([^>]*)>/i);
  if (toastTag) {
    const attrs = toastTag[1];
    const activation = attrs.match(/\bactivationType\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const launch = attrs.match(/\blaunch\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (activation.toLowerCase() === 'protocol') {
      launchUrl = safeLaunchUrl(decodeXmlEntities(launch));
    }
  }

  return {
    title: texts[0],
    body: texts.slice(1).join(' — '),
    launchUrl,
  };
}

function defaultDbPath(env = process.env) {
  if (env.OPENBAR_NOTIFICATIONS_DB) return env.OPENBAR_NOTIFICATIONS_DB;
  if (!env.LOCALAPPDATA) return null;
  return path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
}

function dbSignature(dbPath) {
  if (!dbPath) return null;
  const parts = [];
  for (const suffix of ['', '-wal']) {
    try {
      const st = fs.statSync(dbPath + suffix);
      parts.push(`${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push('missing');
    }
  }
  return parts[0] === 'missing' ? null : parts.join('|');
}

function readWindowsNotifications({ dbPath = defaultDbPath(), now = Date.now(), limit = MAX_NOTIFICATIONS } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { status: 'unavailable', items: [] };
  }
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`
      SELECT
        n.Id AS Id,
        n.Tag AS Tag,
        n."Group" AS Grp,
        CASE WHEN n.ArrivalTime > 116444736000000000
          THEN (n.ArrivalTime - 116444736000000000) / 10000
          ELSE 0
        END AS ArrivalMs,
        CASE WHEN n.ExpiryTime > 116444736000000000
          THEN (n.ExpiryTime - 116444736000000000) / 10000
          ELSE 0
        END AS ExpiryMs,
        h.PrimaryId AS PrimaryId,
        (
          SELECT a.AssetValue
          FROM HandlerAssets a
          WHERE a.HandlerId = n.HandlerId AND a.AssetKey = 'DisplayName'
          LIMIT 1
        ) AS DisplayName,
        n.Payload AS Payload
      FROM Notification n
      LEFT JOIN NotificationHandler h ON n.HandlerId = h.RecordId
      WHERE n.Type = 'toast'
      ORDER BY n.ArrivalTime DESC
      LIMIT ?
    `).all(limit);

    const items = [];
    for (const row of rows) {
      const expiryMs = Number(row.ExpiryMs) || 0;
      if (expiryMs > 0 && expiryMs <= now) continue;
      const parsed = parseToastPayload(row.Payload);
      if (!parsed) continue;
      const arrivalMs = Number(row.ArrivalMs) || 0;
      items.push({
        id: String(row.Id),
        app: formatAppName(row.PrimaryId, row.DisplayName),
        appId: typeof row.PrimaryId === 'string' ? row.PrimaryId : '',
        title: parsed.title,
        body: parsed.body,
        arrivalMs,
        expiryMs: expiryMs > 0 ? expiryMs : 0,
        launchUrl: parsed.launchUrl,
      });
    }
    return { status: 'ready', items };
  } catch {
    return { status: 'unavailable', items: [] };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function normalizePersistedState(raw) {
  const lastSeenAt = Number.isFinite(raw?.lastSeenAt) && raw.lastSeenAt >= 0 ? raw.lastSeenAt : 0;
  const dismissedIds = Array.isArray(raw?.dismissedIds)
    ? [...new Set(raw.dismissedIds.filter((id) => typeof id === 'string' && id.length > 0))].slice(-MAX_DISMISSED_IDS)
    : [];
  return { lastSeenAt, dismissedIds };
}

function buildNotificationState(rawResult, persisted, currentNow = Date.now()) {
  const { lastSeenAt, dismissedIds } = normalizePersistedState(persisted);
  if (!rawResult || rawResult.status !== 'ready') {
    return {
      status: rawResult?.status || 'unavailable',
      items: [],
      unread: 0,
      lastSeenAt,
    };
  }
  const dismissed = new Set(dismissedIds);
  const items = rawResult.items
    .filter((item) => !dismissed.has(item.id) && !(item.expiryMs > 0 && item.expiryMs <= currentNow))
    .map((item) => ({
      ...item,
      unread: item.arrivalMs > lastSeenAt,
    }));
  const unread = items.reduce((count, item) => count + (item.unread ? 1 : 0), 0);
  return { status: 'ready', items, unread, lastSeenAt };
}

function hasNotificationsWidget(settings) {
  return [settings.left, settings.center, settings.right].some((zone) => Array.isArray(zone) && zone.includes('notifications')) ||
    (settings.customTabs || []).some((tab) => Array.isArray(tab.items) && tab.items.some((item) => item.kind === 'widget' && item.widget === 'notifications'));
}

function notificationsLayoutMigration(settings) {
  if (settings.notificationsWidgetMigrated) return null;
  const patch = { notificationsWidgetMigrated: true };
  if (!hasNotificationsWidget(settings)) {
    const right = Array.isArray(settings.right) ? [...settings.right] : [];
    const quickIdx = right.indexOf('quick');
    if (quickIdx >= 0) right.splice(quickIdx, 0, 'notifications');
    else right.push('notifications');
    patch.right = right;
  }
  return patch;
}

function isWindows11(release = os.release()) {
  const build = Number(String(release).split('.')[2]);
  return Number.isFinite(build) && build >= 22000;
}

function createNotificationService({
  isWin = process.platform === 'win32',
  dbPath = defaultDbPath(),
  getPersisted,
  setPersisted,
  onUpdate,
  reader = readWindowsNotifications,
  now = () => Date.now(),
} = {}) {
  let lastSig = null;
  let lastRaw = isWin ? { status: 'unavailable', items: [] } : { status: 'unsupported', items: [] };
  let current = buildNotificationState(lastRaw, getPersisted?.(), now());

  function emitIfChanged(next) {
    const prevKey = JSON.stringify(current);
    const nextKey = JSON.stringify(next);
    current = next;
    if (prevKey !== nextKey) onUpdate?.(current);
    return current;
  }

  function refresh(force = false) {
    const currentNow = now();
    if (!isWin) return emitIfChanged(buildNotificationState({ status: 'unsupported', items: [] }, getPersisted?.(), currentNow));
    const sig = dbSignature(dbPath);
    if (force || sig !== lastSig) {
      lastSig = sig;
      lastRaw = sig ? reader({ dbPath, now: currentNow }) : { status: 'unavailable', items: [] };
    }
    return emitIfChanged(buildNotificationState(lastRaw, getPersisted?.(), currentNow));
  }

  function markAllRead() {
    const currentNow = now();
    const persisted = normalizePersistedState(getPersisted?.());
    const maxArrival = lastRaw.items.reduce((m, item) => Math.max(m, item.arrivalMs || 0), 0);
    const nextSeen = Math.max(persisted.lastSeenAt, currentNow, maxArrival);
    const updated = { ...persisted, lastSeenAt: nextSeen };
    setPersisted?.(updated);
    return emitIfChanged(buildNotificationState(lastRaw, updated, currentNow));
  }

  function dismiss(id) {
    if (typeof id !== 'string' || !id || id.length > 128) return current;
    const persisted = normalizePersistedState(getPersisted?.());
    const dismissedIds = [...new Set([...persisted.dismissedIds, id])].slice(-MAX_DISMISSED_IDS);
    const updated = { ...persisted, dismissedIds };
    setPersisted?.(updated);
    return emitIfChanged(buildNotificationState(lastRaw, updated, now()));
  }

  function clearAll() {
    const currentNow = now();
    const persisted = normalizePersistedState(getPersisted?.());
    const visibleIds = current.items.map((item) => item.id);
    const dismissedIds = [...new Set([...persisted.dismissedIds, ...visibleIds])].slice(-MAX_DISMISSED_IDS);
    const maxArrival = lastRaw.items.reduce((m, item) => Math.max(m, item.arrivalMs || 0), 0);
    const updated = { lastSeenAt: Math.max(persisted.lastSeenAt, currentNow, maxArrival), dismissedIds };
    setPersisted?.(updated);
    return emitIfChanged(buildNotificationState(lastRaw, updated, currentNow));
  }

  return {
    get: () => current,
    refresh,
    markAllRead,
    dismiss,
    clearAll,
  };
}

function registerNotificationsIpc(ipcMain, { service, shell, win32, isActivePanel, isWin = process.platform === 'win32' }) {
  ipcMain.handle('notifications:refresh', (event) => (isActivePanel(event) ? service.refresh(true) : null));
  ipcMain.handle('notifications:mark-read', (event) => (isActivePanel(event) ? service.markAllRead() : null));
  ipcMain.handle('notifications:dismiss', (event, id) => (isActivePanel(event) ? service.dismiss(id) : null));
  ipcMain.handle('notifications:clear', (event) => (isActivePanel(event) ? service.clearAll() : null));
  ipcMain.handle('notifications:open', async (event, target) => {
    if (!isActivePanel(event) || !isWin) return false;
    try {
      if (target === 'settings') {
        await shell.openExternal('ms-settings:notifications');
        return true;
      }
      if (target === 'center') {
        if (!win32) return false;
        // Win+N opens Notification Center on Windows 11; Win+A opens Action Center on Windows 10 / Server 2022.
        win32.sendCombo([0x5B, isWindows11() ? 0x4E : 0x41]);
        return true;
      }
      const url = safeLaunchUrl(target);
      if (url) {
        await shell.openExternal(url);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
}

module.exports = {
  MAX_DISMISSED_IDS,
  decodeXmlEntities,
  formatAppName,
  safeLaunchUrl,
  parseToastPayload,
  defaultDbPath,
  dbSignature,
  readWindowsNotifications,
  normalizePersistedState,
  buildNotificationState,
  hasNotificationsWidget,
  notificationsLayoutMigration,
  isWindows11,
  createNotificationService,
  registerNotificationsIpc,
};
