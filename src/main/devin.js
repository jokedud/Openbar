'use strict';

const PAGE_SIZE = 30;
const ORG_ID = /^org-[a-z0-9_-]+$/i;
const SESSION_ID = /^[a-z0-9_-]+$/i;

function sessionUrl(id) {
  return typeof id === 'string' && SESSION_ID.test(id) ? `https://app.devin.ai/sessions/${id}` : null;
}

function parsePage(payload, legacy, offset) {
  const rows = legacy ? payload?.sessions : payload?.items;
  if (!Array.isArray(rows)) throw new Error('Invalid sessions response');
  const sessions = rows.filter((s) => sessionUrl(s?.session_id)).map((s) => {
    const date = s.updated_at;
    const ms = typeof date === 'number' ? date * 1000 : Date.parse(date);
    return {
      id: s.session_id,
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : 'Untitled session',
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

module.exports = { listSessions, sessionUrl, ORG_ID };
