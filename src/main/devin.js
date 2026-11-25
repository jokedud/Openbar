'use strict';

const path = require('path');

const PAGE_SIZE = 30;
const ORG_ID = /^org-[a-z0-9_-]+$/i;
const SESSION_ID = /^[a-z0-9_-]+$/i;

function sessionUrl(id) {
  return typeof id === 'string' && SESSION_ID.test(id) ? `https://app.devin.ai/sessions/${id}` : null;
}

function sessionTitle(title) {
  return typeof title === 'string' && title.trim() ? title.trim() : 'Untitled session';
}

function listLocalSessions({ APPDATA, DEVIN_SESSIONS_DIR } = process.env) {
  const root = DEVIN_SESSIONS_DIR || (APPDATA && path.join(APPDATA, 'devin'));
  if (!root) return [];
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(path.join(root, 'cli', 'sessions.db'), { readOnly: true });
    const rows = db.prepare('SELECT id, title, last_activity_at FROM sessions WHERE hidden = 0 ORDER BY last_activity_at DESC').all();
    return rows.filter((row) => typeof row.id === 'string' && SESSION_ID.test(row.id)).map((row) => ({
      id: row.id,
      title: sessionTitle(row.title),
      local: true,
      updatedAt: Number.isFinite(row.last_activity_at)
        ? (row.last_activity_at < 1e12 ? row.last_activity_at * 1000 : row.last_activity_at) : null,
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function parsePage(payload, legacy, offset) {
  const rows = legacy ? payload?.sessions : payload?.items;
  if (!Array.isArray(rows)) throw new Error('Invalid sessions response');
  const sessions = rows.filter((s) => sessionUrl(s?.session_id)).map((s) => {
    const date = s.updated_at;
    const ms = typeof date === 'number' ? date * 1000 : Date.parse(date);
    return {
      id: s.session_id,
      title: sessionTitle(s.title),
      status: (typeof (s.status_enum || s.status) === 'string' ? s.status_enum || s.status : 'Unknown').replace(/_/g, ' '),
      updatedAt: Number.isFinite(ms) ? ms : null,
    };
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const next = legacy ? (rows.length >= PAGE_SIZE ? offset + rows.length : null)
    : (payload.has_next_page && typeof payload.end_cursor === 'string' && payload.end_cursor ? payload.end_cursor : null);
  return { sessions, next };
}

async function listSessions({ token, orgId }, cursor, fetcher = globalThis.fetch) {
  if (!token) return { error: 'missing' };
  const legacy = token.startsWith('apk_');
  if (!legacy && !ORG_ID.test(orgId)) return { error: 'organization' };
  const offset = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const url = new URL(legacy ? '/v1/sessions' : `/v3/organizations/${orgId}/sessions`, 'https://api.devin.ai');
  if (legacy) {
    url.searchParams.set('limit', PAGE_SIZE);
    url.searchParams.set('offset', offset);
  } else {
    url.searchParams.set('first', PAGE_SIZE);
    if (typeof cursor === 'string' && cursor) url.searchParams.set('after', cursor);
  }
  let response;
  try {
    response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { error: 'offline' };
  }
  if (response.status === 401 || response.status === 403) return { error: 'auth' };
  if (response.status === 404 && !legacy) return { error: 'organization' };
  if (response.status === 429) return { error: 'rate' };
  if (!response.ok) return { error: 'unavailable' };
  try {
    return parsePage(await response.json(), legacy, offset);
  } catch {
    return { error: 'unavailable' };
  }
}

module.exports = { listSessions, listLocalSessions, sessionUrl, ORG_ID };
