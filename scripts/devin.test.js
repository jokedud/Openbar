'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { listSessions, sessionUrl } = require('../src/main/devin');

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
  settings.position = 'top';
  context.dock.y = 0;
  vm.runInContext("panel = null; togglePanel('devin', 350)", context);
  assert.equal(bounds.y, context.dock.y + context.dock.height - settings.margin + 6);
});

function mainIpc(initialConfig) {
  const { deepMerge, DEFAULT_SETTINGS } = requireStore();
  const store = (defaults, initial) => ({
    value: initial, get() { return this.value; }, save() {},
    replace(patch) { this.value = deepMerge(defaults, patch); },
  });
  const settings = store(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, layout: 'full' });
  const credentials = store({ encrypted: '', orgId: '' }, initialConfig);
  const app = {
    requestSingleInstanceLock: () => true, setAppUserModelId() {}, on() {},
    whenReady: () => new Promise(() => {}),
  };
  const handlers = new Map(), sender = { send() {} };
  const electron = { app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
  const context = vm.createContext({
    require: (name) => ({ path, electron, './devin': require('../src/main/devin'), './store': { DEFAULT_SETTINGS } })[name] || {},
    __dirname, settings, credentials, sender, process: { platform: 'test', on() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8'), context);
  vm.runInContext('settingsStore = settings; devinStore = credentials; settingsWin = { webContents: sender, isDestroyed: () => false }; registerIpc();', context);
  return { credentials, invoke: (name, ...args) => handlers.get(name)({ sender }, ...args) };
}

function requireStore() {
  const module = { exports: {} };
  const context = { module, require: (name) => name === 'electron' ? {} : require(name) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8'), context);
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
