'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { listSessions, listLocalSessions, sessionUrl } = require('../src/main/devin');

const account = { token: 'cog_test', orgId: 'org-example' };
const success = (payload) => ({ ok: true, json: async () => payload });

test('lists and normalizes a Devin v3 page with a bearer token and encoded cursor', async () => {
  const page = await listSessions(account, 'next+/=', async (url, options) => {
    assert.equal(url.origin, 'https://api.devin.ai');
    assert.equal(url.pathname, '/v3/organizations/org-example/sessions');
    assert.equal(url.searchParams.get('first'), '30');
    assert.equal(url.searchParams.get('after'), 'next+/=');
    assert.equal(options.headers.Authorization, 'Bearer cog_test');
    assert.equal(options.redirect, 'error');
    return success({
      items: [
        { session_id: 'devin-old', status: 'exit' },
        { session_id: 'devin-new', title: '  Ship a release ', status: 'running', updated_at: 1700000000 },
        { session_id: '../invalid' },
      ],
      end_cursor: 'more',
      has_next_page: true,
    });
  });
  assert.deepEqual(page, {
    sessions: [
      { id: 'devin-new', title: 'Ship a release', status: 'running', updatedAt: 1700000000000 },
      { id: 'devin-old', title: 'Untitled session', status: 'exit', updatedAt: null },
    ],
    next: 'more',
  });
});

test('supports organization-scoped legacy keys and offset pagination', async () => {
  const page = await listSessions({ token: 'apk_user_test' }, 30, async (url) => {
    assert.equal(url.pathname, '/v1/sessions');
    assert.equal(url.searchParams.get('offset'), '30');
    assert.equal(url.searchParams.get('limit'), '30');
    return success({ sessions: Array.from({ length: 30 }, (_, index) => ({
      session_id: `devin-${index}`, status_enum: 'suspend_requested', updated_at: '2026-01-02T03:04:00Z',
    })) });
  });
  assert.equal(page.next, 60);
  assert.equal(page.sessions.length, 30);
  assert.equal(page.sessions[0].status, 'suspend requested');
  assert.equal(page.sessions[0].updatedAt, Date.UTC(2026, 0, 2, 3, 4));
});

test('handles missing setup, API errors, malformed data and no sessions', async () => {
  const noRequest = () => { throw new Error('Unexpected request'); };
  assert.deepEqual(await listSessions({}, null, noRequest), { error: 'missing' });
  assert.deepEqual(await listSessions({ token: 'cog_test', orgId: 'invalid' }, null, noRequest), { error: 'organization' });
  for (const [status, error] of [[401, 'auth'], [403, 'auth'], [404, 'organization'], [429, 'rate'], [500, 'unavailable']]) {
    assert.deepEqual(await listSessions(account, null, async () => ({ ok: false, status })), { error });
  }
  assert.deepEqual(await listSessions(account, null, noRequest), { error: 'offline' });
  assert.deepEqual(await listSessions(account, null, async () => success({})), { error: 'unavailable' });
  assert.deepEqual(await listSessions(account, null, async () => success({ items: [] })), { sessions: [], next: null });
});

test('session links stay on the Devin sessions route', () => {
  assert.equal(sessionUrl('devin-123_abc'), 'https://app.devin.ai/sessions/devin-123_abc');
  for (const id of ['', '../settings', 'run?next=elsewhere', 'https://example.com', null]) assert.equal(sessionUrl(id), null);
});

test('reads visible Devin Local session metadata from a live SQLite history', (t) => {
  const sqlite = process.getBuiltinModule?.('node:sqlite');
  if (!sqlite) return t.skip('Node does not provide node:sqlite');
  const APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-devin-'));
  t.after(() => fs.rmSync(APPDATA, { recursive: true, force: true }));
  assert.deepEqual(listLocalSessions({ APPDATA }), []);
  const directory = path.join(APPDATA, 'devin', 'cli');
  fs.mkdirSync(directory, { recursive: true });
  const db = new sqlite.DatabaseSync(path.join(directory, 'sessions.db'));
  try {
    db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, last_activity_at INTEGER, hidden INTEGER NOT NULL);
      INSERT INTO sessions VALUES
        ('local-new', '  Local project  ', 1795000000000, 0),
        ('local-old', NULL, 1794000000, 0),
        ('internal-helper', 'Hidden', 1796000000000, 1);`);
    assert.deepEqual(listLocalSessions({ APPDATA }), [
      { id: 'local-new', title: 'Local project', local: true, updatedAt: 1795000000000 },
      { id: 'local-old', title: 'Untitled session', local: true, updatedAt: 1794000000000 },
    ]);
    assert.deepEqual(listLocalSessions({ DEVIN_SESSIONS_DIR: path.join(APPDATA, 'devin') }), listLocalSessions({ APPDATA }));
    db.exec('DROP TABLE sessions');
    assert.deepEqual(listLocalSessions({ APPDATA }), []);
  } finally {
    db.close();
  }
});

function devinPanel(invoke) {
  const h = (tag, attrs, ...children) => ({
    tag, attrs, children, textContent: '', hidden: !!attrs?.hidden,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
  });
  const body = h('div');
  const context = vm.createContext({
    URLSearchParams, location: { search: '?widget=devin' },
    document: { getElementById: () => h('div') }, body, h, icon() {},
    api: { invoke }, OB: { init: () => new Promise(() => {}) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'panel.js'), 'utf8'), context);
  vm.runInContext('P.devin(body)', context);
  const [, list, message, more] = body.children[0].children;
  return { list, message, more };
}

test('shows local rows while the cloud request is pending and without a cloud key', async () => {
  let finishCloud;
  const { list, message } = devinPanel(async (channel) => {
    if (channel === 'devin:list-local') return [{ id: 'local', title: 'Local project', local: true, updatedAt: 1 }];
    assert.equal(channel, 'devin:list');
    return new Promise((resolve) => { finishCloud = resolve; });
  });
  await new Promise(setImmediate);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].tag, 'div');
  assert.equal(list.children[0].children[1].children[0], 'Local');
  finishCloud({ error: 'missing' });
  await new Promise(setImmediate);
  assert.equal(list.children[0].children[0].children[0].children[0], 'Local project');
  assert.match(message.children[0].children[0], /API key/);
});

test('merges cloud pages with local sessions by update time and prefers the cloud row for duplicate IDs', async () => {
  const opened = [];
  let localReads = 0;
  const cloud = (id, title, updatedAt) => ({ id, title, updatedAt, status: 'running' });
  const { list, more } = devinPanel(async (channel, arg) => {
    if (channel === 'devin:list-local') {
      localReads++;
      return [
        { id: 'shared', title: 'Local copy', local: true, updatedAt: 30 },
        { id: 'local', title: 'Local project', local: true, updatedAt: 10 },
      ];
    }
    if (channel === 'devin:list') {
      return arg == null
        ? { sessions: [cloud('cloud', 'Cloud project', 20)], next: 'more' }
        : { sessions: [cloud('shared', 'Cloud copy', 15)], next: null };
    }
    assert.equal(channel, 'devin:open');
    opened.push(arg);
    return true;
  });
  const titles = () => list.children.map((row) => row.children[0].children[0].children[0]);
  await new Promise(setImmediate);
  assert.deepEqual(titles(), ['Local copy', 'Cloud project', 'Local project']);
  assert.equal(more.hidden, false);
  await more.onclick();
  assert.deepEqual(titles(), ['Cloud project', 'Cloud copy', 'Local project']);
  assert.equal(more.hidden, true);
  assert.equal(localReads, 1);
  await list.children[1].attrs.onclick();
  assert.deepEqual(opened, ['shared']);
});

test('the Devin bubble stays six pixels from the visible dock at either edge', () => {
  const display = { x: 0, y: 0, width: 900, height: 800 };
  const settings = { margin: 10, position: 'bottom' };
  const app = {
    requestSingleInstanceLock: () => true, setAppUserModelId() {}, on() {},
    whenReady: () => new Promise(() => {}),
  };
  let bounds;
  class BrowserWindow {
    constructor(options) { bounds = options; this.webContents = { send() {} }; }
    getBounds() { const { x, y, width, height } = bounds; return { x, y, width, height }; }
    setBounds(next) { bounds = next; }
    setAlwaysOnTop() {}
    on() {}
    once() {}
    isDestroyed() { return false; }
    loadFile() {}
  }
  const electron = { app, BrowserWindow, screen: { getDisplayMatching: () => ({ bounds: display, workArea: display }) } };
  const context = vm.createContext({
    require: (name) => ({ path, electron })[name] || {},
    __dirname, settings, process: { platform: 'test', on() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8'), context);
  vm.runInContext('settingsStore = { get: () => settings }; bar = { getBounds: () => dock, isDestroyed: () => false, webContents: { send() {} } };', context);
  context.dock = { x: 150, y: 734, width: 600, height: 66 };
  vm.runInContext("togglePanel('devin', 350)", context);
  assert.equal(bounds.y + bounds.height, context.dock.y + settings.margin - 6);
  assert.equal(bounds.x + bounds.width / 2, 500);
  const maxHeight = bounds.height;
  vm.runInContext("fitDevinPanel({ sender: {} }, 260)", context);
  assert.equal(bounds.height, maxHeight);
  vm.runInContext("fitDevinPanel({ sender: panel.webContents }, 260.4)", context);
  assert.equal(bounds.height, 261);
  assert.equal(bounds.y + bounds.height, context.dock.y + settings.margin - 6);
  vm.runInContext("fitDevinPanel({ sender: panel.webContents }, 850)", context);
  assert.equal(bounds.height, maxHeight);
  assert.equal(bounds.y + bounds.height, context.dock.y + settings.margin - 6);
  settings.position = 'top';
  context.dock.y = 0;
  vm.runInContext("panel = null; togglePanel('devin', 350)", context);
  assert.equal(bounds.y, context.dock.y + context.dock.height - settings.margin + 6);
  vm.runInContext("fitDevinPanel({ sender: panel.webContents }, 175)", context);
  assert.equal(bounds.height, 175);
  assert.equal(bounds.y, context.dock.y + context.dock.height - settings.margin + 6);
});

function mainIpc(initialConfig, storedToken = 'cog_test') {
  const { deepMerge, DEFAULT_SETTINGS } = requireStore();
  const store = (defaults, initial) => ({
    value: initial, get() { return this.value; }, save() {},
    set(patch) { this.value = deepMerge(this.value, patch); },
    replace(patch) { this.value = deepMerge(defaults, patch); },
  });
  const settings = store(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, layout: 'full' });
  const credentials = store({ encrypted: '', orgId: '' }, initialConfig);
  const app = {
    requestSingleInstanceLock: () => true, setAppUserModelId() {}, on() {},
    whenReady: () => new Promise(() => {}),
  };
  const handlers = new Map(), sender = { send() {} };
  const safeStorage = {
    isEncryptionAvailable: () => true,
    decryptString: () => storedToken,
    encryptString: () => Buffer.from('new ciphertext'),
  };
  const electron = { app, safeStorage, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
  const context = vm.createContext({
    require: (name) => ({
      path, electron, './bluetooth': require('../src/main/bluetooth'),
      './devin': require('../src/main/devin'), './store': { DEFAULT_SETTINGS },
    })[name] || {},
    __dirname, Buffer, settings, credentials, sender, process: { platform: 'test', on() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8'), context);
  vm.runInContext('settingsStore = settings; devinStore = credentials; settingsWin = { webContents: sender, isDestroyed: () => false }; registerIpc();', context);
  return { credentials, invoke: (name, ...args) => handlers.get(name)({ sender }, ...args) };
}

function requireStore() {
  const module = { exports: {} };
  const filename = path.join(__dirname, '..', 'src', 'main', 'store.js');
  const localRequire = createRequire(filename);
  const context = { module, require: (name) => name === 'electron' ? {} : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  return module.exports;
}

test('organization-only changes retain the stored encrypted token', () => {
  const { credentials, invoke } = mainIpc({ encrypted: 'existing-ciphertext', orgId: 'org-old' });
  const saved = invoke('devin:save', '', ' org-new ');
  assert.equal(saved.orgId, 'org-new');
  assert.equal(saved.configured, true);
  assert.equal(credentials.get().encrypted, 'existing-ciphertext');
  assert.equal(invoke('devin:save', '', '').error, 'organization');
  assert.equal(credentials.get().orgId, 'org-new');
  assert.equal(mainIpc({ encrypted: '', orgId: '' }).invoke('devin:save', '', 'org-new').error, 'invalid');
});

test('new and stored legacy keys ignore organization IDs and allow a blank field', () => {
  const { credentials, invoke } = mainIpc({ encrypted: 'existing-ciphertext', orgId: 'org-old' }, 'apk_user_test');
  assert.equal(invoke('devin:save', '', '').orgId, '');
  assert.equal(invoke('devin:save', '', 'org-other').orgId, '');
  assert.equal(credentials.get().encrypted, 'existing-ciphertext');
  assert.equal(invoke('devin:save', 'apk_user_new', 'org-other').orgId, '');
  assert.equal(invoke('devin:save', 'apk_user_new', '').configured, true);
  assert.equal(credentials.get().orgId, '');
});

test('reset settings removes the saved Devin token and organization', () => {
  const { credentials, invoke } = mainIpc({ encrypted: 'existing-ciphertext', orgId: 'org-old' });
  let savedNow;
  credentials.save = (now) => { savedNow = now; };
  assert.equal(invoke('settings:reset').layout, 'pill');
  assert.equal(savedNow, true);
  assert.equal(credentials.get().encrypted, '');
  assert.equal(credentials.get().orgId, '');
  assert.equal(invoke('devin:list').error, 'missing');
});
