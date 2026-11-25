'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
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
