'use strict';
// Shared renderer helpers: state sync with the main process, formatting, icons.
const api = window.openbar;
const OB = { settings: null, data: null, state: {}, listeners: new Set() };

OB.init = async function init() {
  const r = await api.invoke('init');
  OB.settings = r.settings; OB.data = r.data; OB.state = r.state; OB.platform = r.platform; OB.version = r.version;
  api.on('state', (patch) => { Object.assign(OB.state, patch); OB.emit('state', patch); });
  api.on('settings', (s) => { OB.settings = s; applyTheme(); OB.emit('settings', s); });
  api.on('data', (d) => { OB.data = d; OB.emit('data', d); });
  applyTheme();
  return OB;
};
OB.on = (fn) => { OB.listeners.add(fn); return () => OB.listeners.delete(fn); };
OB.emit = (kind, payload) => { for (const fn of OB.listeners) fn(kind, payload); };
OB.setSettings = async (patch) => { OB.settings = await api.invoke('settings:set', patch); return OB.settings; };
OB.setData = async (patch) => { OB.data = await api.invoke('data:set', patch); return OB.data; };
OB.setDataKey = async (k, v) => { OB.data = await api.invoke('data:replaceKey', k, v); return OB.data; };

function applyTheme() {
  const s = OB.settings || {};
  document.documentElement.dataset.style = s.style || 'glass';
  document.documentElement.dataset.position = s.position || 'bottom';
  document.documentElement.dataset.layout = s.layout || 'full';
  document.documentElement.style.setProperty('--bar-h', (s.height != null ? s.height : 46) + 'px');
  document.documentElement.style.setProperty('--bar-m', (s.margin != null ? s.margin : 6) + 'px');
}

// ---------- DOM ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
function icon(name, size = 16) {
  const s = h('span', { class: 'ic', style: { width: size + 'px', height: size + 'px' } });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.dot}</svg>`;
  return s;
}
const ICONS = {
  dot: '<circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  windows: '<path d="M3 5.5 10.5 4.5v7H3zM12.5 4.2 21 3v8.5h-8.5zM3 12.5h7.5v7L3 18.5zM12.5 12.5H21V21l-8.5-1.2z" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
  next: '<path d="M5 4v16l10-8zM19 5v14"/>',
  prev: '<path d="M19 20V4L9 12zM5 19V5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.4 6.4-1.5 6.4-6.9a5.4 5.4 0 0 0-1.5-3.7 5 5 0 0 0-.1-3.8s-1.2-.3-3.9 1.5a13.4 13.4 0 0 0-7 0C6.3 1.8 5.1 2.1 5.1 2.1a5 5 0 0 0-.1 3.8 5.4 5.4 0 0 0-1.5 3.7c0 5.4 3.3 6.5 6.4 6.9a3.4 3.4 0 0 0-.9 2.6V22"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M9 8h4.5a2 2 0 0 1 0 4H9h5a2 2 0 0 1 0 4H9zM11 6v2M11 16v2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  desktop: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  folder: '<path d="M3 5h7l2 2h9v12H3z"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4z"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
  disk: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/>',
  rain: '<path d="M16 13V9a4 4 0 0 0-8 0M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2"/>',
  snow: '<path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9"/>',
  storm: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/><path d="m13 11-4 6h6l-4 6"/>',
  fog: '<path d="M4 14h16M4 18h16M6 10h12"/>',
  chart: '<path d="M3 3v18h18M7 15l4-4 3 3 5-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
};

// ---------- formatting ----------
const fmt = {
  bytes(n, d = 1) { if (n == null) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(i ? d : 0) + ' ' + u[i]; },
  rate(n) { return n == null ? '–' : fmt.bytes(n, n > 1048576 ? 1 : 0) + '/s'; },
  time(t, opts) { return new Date(t).toLocaleTimeString([], Object.assign({ hour: 'numeric', minute: '2-digit' }, opts)); },
  date(t, opts) { return new Date(t).toLocaleDateString([], Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, opts)); },
  dur(sec) { sec = Math.max(0, Math.round(sec)); const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60); return hh ? `${hh}h ${mm}m` : mm ? `${mm}m` : `${sec}s`; },
  mmss(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; },
  rel(t) { const m = Math.round((t - Date.now()) / 60000); if (Math.abs(m) < 1) return 'now'; if (m > 0) return m < 60 ? `in ${m}m` : `in ${fmt.dur(m * 60)}`; return `${fmt.dur(-m * 60)} ago`; },
  money(n, cur = 'usd') { try { return new Intl.NumberFormat([], { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: n < 1 ? 4 : n < 100 ? 2 : 0 }).format(n); } catch (_) { return String(n); } },
};

// WMO weather codes (Open-Meteo)
function weatherInfo(code) {
  if (code === 0) return ['sun', 'Clear'];
  if (code <= 2) return ['sun', 'Partly cloudy'];
  if (code === 3) return ['cloud', 'Overcast'];
  if (code <= 48) return ['fog', 'Fog'];
  if (code <= 57) return ['rain', 'Drizzle'];
  if (code <= 67) return ['rain', 'Rain'];
  if (code <= 77) return ['snow', 'Snow'];
  if (code <= 82) return ['rain', 'Showers'];
  if (code <= 86) return ['snow', 'Snow showers'];
  return ['storm', 'Thunderstorm'];
}

function nextEvents(limit = 50) {
  const now = Date.now();
  const evs = ((OB.state.calendar && OB.state.calendar.events) || []).filter((e) => e.end > now).sort((a, b) => a.start - b.start);
  return evs.slice(0, limit);
}

function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
