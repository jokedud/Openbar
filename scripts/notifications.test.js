'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const {
  MAX_DISMISSED_IDS,
  decodeXmlEntities,
  formatAppName,
  safeLaunchUrl,
  parseToastPayload,
  readWindowsNotifications,
  buildNotificationState,
  hasNotificationsWidget,
  notificationsLayoutMigration,
  createNotificationService,
  registerNotificationsIpc,
} = require('../src/main/notifications');
const { normalizeCustomTabs } = require('../src/main/custom-tabs');

const FILETIME_EPOCH = 116444736000000000n;
const toFiletime = (ms) => FILETIME_EPOCH + BigInt(ms) * 10000n;

function createTempWpnDb(t, setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-notif-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'wpndatabase.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE NotificationHandler (RecordId INTEGER PRIMARY KEY, PrimaryId TEXT);
    CREATE TABLE HandlerAssets (HandlerId INTEGER, AssetKey TEXT, AssetValue TEXT);
    CREATE TABLE Notification (
      Id INTEGER PRIMARY KEY,
      HandlerId INTEGER,
      Type TEXT,
      Tag TEXT,
      "Group" TEXT,
      ArrivalTime INTEGER,
      ExpiryTime INTEGER,
      Payload BLOB
    );
  `);
  setup(db);
  db.close();
  return dbPath;
}

test('readWindowsNotifications parses Windows wpndatabase.db toast rows, filters expired/non-toast, and decodes XML', (t) => {
  const now = Date.UTC(2026, 10, 25, 19, 30, 0);
  const dbPath = createTempWpnDb(t, (db) => {
    db.prepare('INSERT INTO NotificationHandler (RecordId, PrimaryId) VALUES (?, ?)').run(1, 'Windows.SystemToast.StartupApp');
    db.prepare('INSERT INTO NotificationHandler (RecordId, PrimaryId) VALUES (?, ?)').run(2, 'com.squirrel.slack.Slack');
    db.prepare('INSERT INTO NotificationHandler (RecordId, PrimaryId) VALUES (?, ?)').run(3, 'Docker.DockerForWindows.Settings');
    db.prepare('INSERT INTO HandlerAssets (HandlerId, AssetKey, AssetValue) VALUES (?, ?, ?)').run(2, 'DisplayName', 'Slack');
    db.prepare('INSERT INTO HandlerAssets (HandlerId, AssetKey, AssetValue) VALUES (?, ?, ?)').run(1, 'DisplayName', 'ms-resource:StartupTitle');

    const insert = db.prepare('INSERT INTO Notification (Id, HandlerId, Type, Tag, "Group", ArrivalTime, ExpiryTime, Payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run(10, 1, 'toast', '', '', toFiletime(now - 60_000), toFiletime(now + 86_400_000), Buffer.from(
      '<toast launch="ms-settings:startupapps" activationType="protocol"><visual><binding template="ToastText02"><text id="1">Startup &amp; Apps</text><text id="2">Docker &lt;v4&gt; runs at login.</text></binding></visual></toast>',
    ));
    insert.run(11, 2, 'toast', '', '', toFiletime(now - 10_000), 0n, Buffer.from(
      '<toast launch="https://app.slack.com/client" activationType="protocol"><visual><binding template="ToastGeneric"><text>New message from Alex</text><text>Ready for the demo?</text></binding></visual></toast>',
    ));
    insert.run(12, 3, 'toast', '', '', toFiletime(now - 120_000), toFiletime(now + 10_000), Buffer.from(
      '<toast launch="docker-desktop://dashboard/open" activationType="protocol"><visual><binding template="ToastGeneric"><text>Docker Update</text><text>4.100.1 ready</text></binding></visual></toast>',
    ));
    // Expired toast should be filtered out
    insert.run(13, 2, 'toast', '', '', toFiletime(now - 500_000), toFiletime(now - 1000), Buffer.from(
      '<toast><visual><binding><text>Old expired</text></binding></visual></toast>',
    ));
    // Non-toast row (tile/badge) should be filtered out
    insert.run(14, 2, 'badge', '', '', toFiletime(now - 5_000), 0n, Buffer.from('<badge value="3"/>'));
  });

  const result = readWindowsNotifications({ dbPath, now });
  assert.equal(result.status, 'ready');
  assert.equal(result.items.length, 3);

  assert.deepEqual(result.items[0], {
    id: '11',
    app: 'Slack',
    appId: 'com.squirrel.slack.Slack',
    title: 'New message from Alex',
    body: 'Ready for the demo?',
    arrivalMs: now - 10_000,
    launchUrl: 'https://app.slack.com/client',
  });
  assert.deepEqual(result.items[1], {
    id: '10',
    app: 'Startup Apps',
    appId: 'Windows.SystemToast.StartupApp',
    title: 'Startup & Apps',
    body: 'Docker <v4> runs at login.',
    arrivalMs: now - 60_000,
    launchUrl: 'ms-settings:startupapps',
  });
  // Non-allowlisted custom protocol should not become a launchUrl
  assert.equal(result.items[2].app, 'Docker Desktop');
  assert.equal(result.items[2].launchUrl, null);
});

test('decodeXmlEntities, safeLaunchUrl, parseToastPayload, and formatAppName handle edge cases', () => {
  assert.equal(decodeXmlEntities('A &amp;lt; B &quot;ok&quot; &#39;x&#39; &#x21;'), 'A &lt; B "ok" \'x\' !');
  assert.equal(safeLaunchUrl('ms-settings:notifications'), 'ms-settings:notifications');
  assert.equal(safeLaunchUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeLaunchUrl('javascript:alert(1)'), null);
  assert.equal(safeLaunchUrl('file:///C:/Windows/cmd.exe'), null);
  assert.equal(parseToastPayload('<toast><visual><binding></binding></visual></toast>'), null);

  assert.equal(formatAppName('xyz.openbar.app', null), 'OpenBar');
  assert.equal(formatAppName('Microsoft.Teams_8wekyb3d8bbwe!App', null), 'Teams');
  assert.equal(formatAppName('C:\\Program Files\\MyApp\\MyApp.exe', null), 'My App');
  assert.equal(formatAppName('Anything', '  Custom Name  '), 'Custom Name');
  assert.equal(formatAppName('Microsoft.Windows.Explorer', '@{shell32.dll,-1}'), 'File Explorer');
});

test('notification service tracks unread counts, markAllRead, dismiss, clearAll, and dismissed cap', (t) => {
  let clock = Date.UTC(2026, 10, 25, 20, 0, 0);
  const dbPath = createTempWpnDb(t, (db) => {
    db.prepare('INSERT INTO NotificationHandler (RecordId, PrimaryId) VALUES (?, ?)').run(1, 'xyz.openbar.app');
    const insert = db.prepare('INSERT INTO Notification (Id, HandlerId, Type, ArrivalTime, ExpiryTime, Payload) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run(1, 1, 'toast', toFiletime(clock - 5000), 0n, Buffer.from('<toast><visual><binding><text>First</text></binding></visual></toast>'));
    insert.run(2, 1, 'toast', toFiletime(clock - 2000), 0n, Buffer.from('<toast><visual><binding><text>Second</text></binding></visual></toast>'));
  });

  let persisted = { lastSeenAt: 0, dismissedIds: [] };
  const updates = [];
  const service = createNotificationService({
    isWin: true,
    dbPath,
    getPersisted: () => persisted,
    setPersisted: (next) => { persisted = next; },
    onUpdate: (next) => updates.push(next),
    now: () => clock,
  });

  const initial = service.refresh(true);
  assert.equal(initial.status, 'ready');
  assert.equal(initial.items.length, 2);
  assert.equal(initial.unread, 2);

  const afterRead = service.markAllRead();
  assert.equal(afterRead.unread, 0);
  assert.equal(afterRead.items.every((i) => !i.unread), true);
  assert.ok(persisted.lastSeenAt >= clock);

  const afterDismiss = service.dismiss('2');
  assert.deepEqual(afterDismiss.items.map((i) => i.id), ['1']);
  assert.deepEqual(persisted.dismissedIds, ['2']);

  const afterClear = service.clearAll();
  assert.equal(afterClear.items.length, 0);
  assert.equal(afterClear.unread, 0);
  assert.deepEqual(persisted.dismissedIds, ['2', '1']);
  assert.ok(updates.length >= 4);

  const manyIds = Array.from({ length: MAX_DISMISSED_IDS + 25 }, (_, i) => String(i));
  const capped = buildNotificationState({ status: 'ready', items: [] }, { lastSeenAt: 0, dismissedIds: manyIds });
  assert.equal(capped.status, 'ready');
});

test('notifications layout migration preserves custom layouts and detects custom tabs', () => {
  const settings = { left: ['start', 'apps'], center: [], right: ['clock', 'quick', 'volume'] };
  const patch = notificationsLayoutMigration(settings);
  assert.deepEqual(patch, { notificationsWidgetMigrated: true, right: ['clock', 'notifications', 'quick', 'volume'] });
  assert.deepEqual(settings.right, ['clock', 'quick', 'volume']);

  // Already migrated -> returns null even if user removed it later
  assert.equal(notificationsLayoutMigration({ ...settings, ...patch, right: ['clock'] }), null);

  // Present in a custom tab -> sets flag without duplicating in right zone
  const tabbed = {
    left: ['apps'], center: [], right: ['clock'],
    customTabs: normalizeCustomTabs([
      { id: 'alerts', name: 'Alerts', items: [{ id: 'n1', kind: 'widget', widget: 'notifications' }] },
    ]),
  };
  assert.equal(hasNotificationsWidget(tabbed), true);
  assert.deepEqual(notificationsLayoutMigration(tabbed), { notificationsWidgetMigrated: true });
});

test('notifications IPC rejects inactive senders and only opens allowlisted targets', async () => {
  const handlers = new Map();
  const openedUrls = [];
  const combos = [];
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  const fakeService = {
    refresh: () => ({ status: 'ready', items: [], unread: 0 }),
    markAllRead: () => ({ status: 'ready', items: [], unread: 0 }),
    dismiss: (id) => ({ status: 'ready', items: [], unread: 0, dismissed: id }),
    clearAll: () => ({ status: 'ready', items: [], unread: 0 }),
  };
  registerNotificationsIpc(ipcMain, {
    service: fakeService,
    shell: { openExternal: async (url) => { openedUrls.push(url); } },
    win32: { sendCombo: (keys) => combos.push(keys) },
    isActivePanel: (e) => e.active === true,
    isWin: true,
  });

  assert.equal(await handlers.get('notifications:refresh')({ active: false }), null);
  assert.equal(await handlers.get('notifications:open')({ active: false }, 'settings'), false);

  assert.equal(await handlers.get('notifications:open')({ active: true }, 'settings'), true);
  assert.equal(await handlers.get('notifications:open')({ active: true }, 'center'), true);
  assert.equal(await handlers.get('notifications:open')({ active: true }, 'ms-settings:startupapps'), true);
  assert.equal(await handlers.get('notifications:open')({ active: true }, 'javascript:alert(1)'), false);
  assert.equal(await handlers.get('notifications:open')({ active: true }, 'file:///C:/cmd.exe'), false);

  assert.deepEqual(openedUrls, ['ms-settings:notifications', 'ms-settings:startupapps']);
  assert.equal(combos.length, 1);
  assert.equal(combos[0][0], 0x5B);
});

test('notifications panel renders cards, marks read on mount, handles dismiss/clear, and cleans up', async () => {
  class FakeNode {
    constructor(tag, text) {
      this.tagName = tag;
      this.textContent = text || '';
      this.children = [];
      this.attrs = {};
      this.listeners = new Map();
      this.hidden = false;
      this.style = {};
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(ev, fn) { this.listeners.set(ev, fn); }
    append(...kids) {
      for (const kid of kids.flat()) {
        if (kid != null && kid !== false) this.children.push(kid instanceof FakeNode ? kid : new FakeNode('#text', String(kid)));
      }
    }
    replaceChildren(...kids) { this.children = []; this.append(...kids); }
    findAll(pred, out = []) {
      if (pred(this)) out.push(this);
      for (const c of this.children) c.findAll(pred, out);
      return out;
    }
  }

  const invoked = [];
  const listeners = new Set();
  const state = {
    notifications: {
      status: 'ready',
      unread: 1,
      items: [
        { id: '42', app: 'Slack', title: 'Hello', body: 'World', arrivalMs: Date.now() - 60_000, unread: true, launchUrl: 'https://slack.com' },
      ],
    },
  };
  let headActions = [];
  const context = {
    OB: {
      platform: 'win32',
      state,
      on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    },
    api: {
      invoke: async (channel, ...args) => {
        invoked.push([channel, ...args]);
        if (channel === 'notifications:refresh') return state.notifications;
        return null;
      },
    },
    h: (tag, attrs, ...kids) => {
      const node = new FakeNode(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'hidden') node.hidden = !!v;
        else if (k === 'style') Object.assign(node.style, v);
        else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
      node.append(...kids);
      return node;
    },
    icon: (name) => new FakeNode('span', name),
    actionBtn: (ic, title, onclick) => {
      const b = new FakeNode('button', title);
      b.addEventListener('click', onclick);
      return b;
    },
    Node: FakeNode,
    Date,
    Set,
    Array,
    JSON,
    Math,
    Number,
    String,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'notifications-panel.js'), 'utf8'), context);

  const body = new FakeNode('div');
  const unmount = context.mountNotificationsPanel(body, (_title, ...actions) => { headActions = actions; });
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(invoked.some(([ch]) => ch === 'notifications:mark-read'));
  assert.ok(invoked.some(([ch]) => ch === 'notifications:refresh'));
  const cards = body.findAll((n) => n.attrs?.['data-notif-id'] === '42');
  assert.equal(cards.length, 1);

  // Keyboard Enter/Space on the Dismiss button must not trigger the card's link handler
  const dismissBtn = cards[0].findAll((n) => n.className === 'notif-dismiss')[0];
  let prevented = false;
  cards[0].listeners.get('keydown')({ key: 'Enter', target: dismissBtn, currentTarget: cards[0], preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.ok(!invoked.some(([ch]) => ch === 'notifications:open'));

  // Keyboard Enter on the card itself opens the launch URL
  cards[0].listeners.get('keydown')({ key: 'Enter', target: cards[0], currentTarget: cards[0], preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(invoked.at(-1), ['notifications:open', 'https://slack.com']);

  // Dismiss button calls notifications:dismiss with item id
  dismissBtn.listeners.get('click')({ stopPropagation() {} });
  assert.deepEqual(invoked.at(-1), ['notifications:dismiss', '42']);

  // Clear all button calls notifications:clear
  const clearBtn = headActions.find((b) => b.className?.includes('notif-clear-btn'));
  assert.ok(clearBtn);
  clearBtn.listeners.get('click')();
  assert.deepEqual(invoked.at(-1), ['notifications:clear']);

  // State update with empty list switches to empty state
  for (const fn of listeners) fn('state', { notifications: { status: 'ready', unread: 0, items: [] } });
  const emptyWrap = body.findAll((n) => n.className === 'notif-empty')[0];
  assert.equal(emptyWrap.hidden, false);

  assert.equal(listeners.size, 1);
  unmount();
  assert.equal(listeners.size, 0);
});
