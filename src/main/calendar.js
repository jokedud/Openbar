'use strict';
const ical = require('node-ical');

// Fetches iCal feeds (Google / Outlook / iCloud secret links) and expands events for the next 30 days.
async function fetchCalendar(cal) {
  const url = cal.url.replace(/^webcal:\/\//i, 'https://');
  const r = await fetch(url, { headers: { 'User-Agent': 'OpenBar/0.1' } });
  if (!r.ok) throw new Error(`${cal.name || 'calendar'}: HTTP ${r.status}`);
  const data = ical.sync.parseICS(await r.text());
  const from = new Date(Date.now() - 24 * 3600e3);
  const to = new Date(Date.now() + 30 * 24 * 3600e3);
  const out = [];
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    const dur = (ev.end ? +ev.end : +ev.start) - +ev.start;
    const allDay = ev.datetype === 'date';
    const push = (start, src = ev) => {
      const s = src === ev ? +start : +src.start;
      const e = src === ev ? s + dur : (src.end ? +src.end : s + dur);
      if (e < +from || s > +to) return;
      out.push({
        id: `${ev.uid}|${+start}`, title: String(src.summary || '(no title)'), start: s, end: e,
        allDay, location: src.location ? String(src.location) : '', calendar: cal.name || '',
        url: findMeetingUrl(src),
      });
    };
    if (ev.rrule) {
      const excluded = new Set(Object.values(ev.exdate || {}).map((d) => +d));
      // rrule-temporal stops runaway rules (e.g. FREQ=SECONDLY) by throwing; skip only that event.
      let dates = [];
      try { dates = ev.rrule.between(from, to, true); } catch (_) { continue; }
      for (const d of dates) {
        if (excluded.has(+d)) continue;
        const rec = ev.recurrences || {};
        const override = allDay ? rec[d.toISOString().slice(0, 10)] : rec[d.toISOString()];
        if (override && override.status === 'CANCELLED') continue;
        push(d, override || ev);
      }
    } else if (+ev.start <= +to && +ev.start + dur >= +from) {
      push(ev.start);
    }
  }
  return out;
}

const MEETING_HOST = /(^|\.)(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com)$/i;

function findMeetingUrl(ev) {
  const hay = [ev.location, ev.description, ev.url && (ev.url.val || ev.url)].filter(Boolean).join(' ');
  for (const u of String(hay).match(/https:\/\/[^\s"<>]+/gi) || []) {
    try { if (MEETING_HOST.test(new URL(u).hostname)) return u; } catch (_) { /* not a URL */ }
  }
  return '';
}

async function fetchAll(calendars) {
  const results = await Promise.allSettled(calendars.filter((c) => c.url).map(fetchCalendar));
  const events = [], errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') events.push(...r.value); else errors.push(String(r.reason && r.reason.message || r.reason));
  }
  events.sort((a, b) => a.start - b.start);
  return { events, errors, fetchedAt: Date.now() };
}

module.exports = { fetchAll };
