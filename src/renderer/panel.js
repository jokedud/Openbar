'use strict';
// Pop-up panels shown above/below the bar when a widget is clicked.
let widget = new URLSearchParams(location.search).get('widget');
const $ = (id) => document.getElementById(id);
const P = {};
const stable = new Set(['start', 'todos', 'notes', 'devin', 'bluetooth']); // panels with local state: don't rebuild on every tick
let networkPanel;
function disposeNetworkPanel() { networkPanel?.dispose(); networkPanel = null; }

function syncHandlers(prev, next) {
  if (!prev._obOn && !next._obOn) return;
  if (prev._obOn) {
    for (const ev of Object.keys(prev._obOn)) {
      if (!next._obOn || !(ev in next._obOn)) prev._obOn[ev] = null;
    }
  }
  if (next._obOn) {
    if (!prev._obOn) prev._obOn = Object.create(null);
    for (const [ev, fn] of Object.entries(next._obOn)) {
      if (!(ev in prev._obOn)) prev.addEventListener(ev, (e) => prev._obOn[ev]?.(e));
      prev._obOn[ev] = fn;
    }
  }
}
function patchPanelNode(prev, next) {
  if (!prev || prev.nodeType !== next.nodeType) return next;
  if (prev.nodeType === 3) {
    if (prev.nodeValue !== next.nodeValue) prev.nodeValue = next.nodeValue;
    return prev;
  }
  if (prev.nodeType !== 1 || prev.tagName !== next.tagName || prev.namespaceURI !== next.namespaceURI) return next;
  syncHandlers(prev, next);
  if (prev.outerHTML === next.outerHTML) {
    const pKids = prev.childNodes, nKids = next.childNodes;
    for (let i = 0; i < nKids.length && i < pKids.length; i++) {
      if (pKids[i].nodeType === 1 && nKids[i].nodeType === 1) patchPanelNode(pKids[i], nKids[i]);
    }
    return prev;
  }
  for (const attr of [...prev.attributes]) {
    if (!next.hasAttribute(attr.name)) prev.removeAttribute(attr.name);
  }
  for (const attr of next.attributes) {
    if (prev.getAttribute(attr.name) !== attr.value) prev.setAttribute(attr.name, attr.value);
  }
  patchChildren(prev, [...next.childNodes]);
  return prev;
}
function patchChildren(parent, nextKids) {
  if (!parent.childNodes || typeof parent.appendChild !== 'function') {
    parent.replaceChildren(...nextKids);
    return;
  }
  for (let i = 0; i < nextKids.length; i++) {
    const cur = parent.childNodes[i];
    if (!cur) parent.appendChild(nextKids[i]);
    else {
      const patched = patchPanelNode(cur, nextKids[i]);
      if (patched !== cur) parent.replaceChild(patched, cur);
    }
  }
  while (parent.childNodes.length > nextKids.length) parent.removeChild(parent.lastChild);
}
function setHead(title, ...actions) {
  if ($('title').textContent !== title) $('title').textContent = title;
  patchChildren($('actions'), actions.filter(Boolean));
}
const actionBtn = (ic, title, onclick) => h('button', { class: 'btn icon', title, onclick }, icon(ic, 14));
const settingsBtn = (tab) => actionBtn('settings', 'Settings', () => api.invoke('settings:open', tab));
const refreshBtn = (key) => actionBtn('refresh', 'Refresh', () => api.invoke('refresh', key));
const empty = (text, tab) => h('div', { class: 'empty' }, text, tab ? h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: () => api.invoke('settings:open', tab) }, 'Open settings')) : null);
const kv = (k, v) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, k), h('span', {}, v));
const errOf = (k) => OB.state.errors && OB.state.errors[k];

// ---------- launcher ----------
let allApps = null, query = '', sel = 0;
P.start = (body) => {
  const grid = h('div', { class: 'grid-apps' });
  setHead('Apps', actionBtn('refresh', 'Re-scan Start Menu', async () => { allApps = await api.invoke('apps:list', true); drawApps(grid); }), settingsBtn('apps'));
  const input = h('input', { class: 'launcher-input', placeholder: 'Search apps…', 'aria-label': 'Search apps', 'aria-describedby': 'launcher-shortcuts', value: query });
  const search = h('div', { class: 'launcher-search' }, h('span', { 'aria-hidden': 'true' }, icon('search', 17)), input);
  const shortcuts = h('div', { class: 'launcher-shortcuts', id: 'launcher-shortcuts' },
    h('span', {}, h('kbd', {}, 'Enter'), ' Open'),
    h('span', {}, h('kbd', {}, 'Ctrl + Enter'), ' Pin to dock'));
  input.addEventListener('input', () => { query = input.value; sel = 0; drawApps(grid); });
  input.addEventListener('keydown', (e) => {
    const items = filtered();
    const columns = getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? columns : 1)); drawApps(grid); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { sel = Math.max(0, sel - (e.key === 'ArrowUp' ? columns : 1)); drawApps(grid); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { if (e.ctrlKey) pin(items[sel]); else launch(items[sel]); }
    if (e.key === 'Escape') api.invoke('panel:close');
  });
  body.append(search, grid, shortcuts);
  setTimeout(() => input.focus(), 30);
  if (!allApps) api.invoke('apps:list').then((a) => { allApps = a; drawApps(grid); });
  drawApps(grid);
};
function filtered() {
  const q = query.trim().toLowerCase();
  const list = allApps || [];
  if (!q) return list;
  return list.filter((a) => a.name.toLowerCase().includes(q)).sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q));
}
function launch(a) { api.invoke('launch', { path: a.path }); api.invoke('panel:close'); query = ''; }
function pin(a) { if (!OB.settings.pinned.some((p) => p.path === a.path)) OB.setSettings({ pinned: [...OB.settings.pinned, { name: a.name, path: a.path, target: a.target || '' }] }); }
const tileIcons = new Map();
function drawApps(grid) {
  if (!allApps) { grid.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'Indexing Start Menu…')); return; }
  const items = filtered().slice(0, 60);
  grid.replaceChildren(...items.map((a, i) => {
    const img = h('span', { class: 'ph' }, a.name.charAt(0).toUpperCase());
    const t = h('button', { class: `tile ${i === sel ? 'sel' : ''}`, 'aria-label': a.name, title: a.name + '  (right-click to pin)', onclick: () => launch(a),
      oncontextmenu: async (e) => { e.preventDefault(); const id = await api.invoke('menu', [{ id: 'open', label: 'Open' }, { id: 'pin', label: 'Pin to OpenBar' }]); if (id === 'open') launch(a); if (id === 'pin') pin(a); } },
    img, h('span', { class: 'n' }, a.name));
    const set = (d) => { if (d) img.replaceWith(h('img', { src: d, alt: '' })); };
    if (tileIcons.has(a.path)) set(tileIcons.get(a.path));
    else api.invoke('apps:icon', a.path).then((d) => { tileIcons.set(a.path, d); set(d); });
    return t;
  }));
  if (!items.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'No apps match'));
  const s = grid.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
}

// ---------- calendar / clock ----------
function monthGrid(evDays) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const g = h('div', { class: 'month' }, ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => h('div', { class: 'muted' }, d)));
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = d.toDateString();
    g.append(h('div', { class: `d ${d.getMonth() !== now.getMonth() ? 'other' : ''} ${key === now.toDateString() ? 'today' : ''} ${evDays.has(key) ? 'has' : ''}` }, d.getDate()));
  }
  return g;
}
P.calendar = (body) => {
  setHead(new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }), refreshBtn('calendar'), settingsBtn('calendar'));
  const evs = nextEvents(60);
  body.append(monthGrid(new Set(evs.map((e) => new Date(e.start).toDateString()))));
  if (!(OB.settings.calendars || []).length) return body.append(empty('Add an iCal / Google / Outlook calendar URL to see your meetings here, get reminders and auto-pause music before calls.', 'calendar'));
  for (const e of OB.state.calendar.errors || []) body.append(h('div', { class: 'card bad' }, e));
  let day = '';
  for (const e of evs.slice(0, 25)) {
    const d = new Date(e.start).toDateString();
    if (d !== day) { day = d; body.append(h('div', { class: 'day-h' }, d === new Date().toDateString() ? 'Today' : fmt.date(e.start))); }
    body.append(h('div', { class: 'ev' },
      h('div', { class: 'row' }, h('b', { class: 'grow ellipsis' }, e.title), e.url ? h('button', { class: 'btn primary', onclick: () => api.invoke('open', e.url) }, icon('video', 12), 'Join') : null),
      h('div', { class: 'muted' }, e.allDay ? 'All day' : `${fmt.time(e.start)} – ${fmt.time(e.end)} · ${fmt.rel(e.start)}`, e.calendar ? ` · ${e.calendar}` : '')));
  }
  if (!evs.length) body.append(empty('Nothing scheduled in the next 30 days.'));
};
P.nextEvent = P.calendar;
P.clock = (body) => {
  setHead('Clock', settingsBtn('clocks'));
  const now = new Date();
  body.append(h('div', { class: 'card' }, h('div', { class: 'big' }, now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })),
    h('div', { class: 'muted' }, now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))));
  for (const tz of OB.settings.worldClocks || []) {
    let t = '', off = '';
    try {
      t = now.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
      off = now.toLocaleDateString([], { timeZone: tz, weekday: 'short' });
    } catch (_) { t = 'invalid zone'; }
    body.append(h('div', { class: 'kv' }, h('span', {}, tz.split('/').pop().replace(/_/g, ' '), h('span', { class: 'muted' }, '  ' + off)), h('b', {}, t)));
  }
  body.append(h('div', { style: { marginTop: '12px' } }, monthGrid(new Set(nextEvents(60).map((e) => new Date(e.start).toDateString())))));
};

// ---------- weather ----------
P.weather = (body) => {
  const w = OB.state.weather;
  setHead(w && w.place ? `Weather · ${w.place}` : 'Weather', refreshBtn('weather'), settingsBtn('weather'));
  if (!w) return body.append(empty(errOf('weather') || 'Loading weather…', errOf('weather') ? 'weather' : null));
  const c = w.current, deg = '°', [ic, label] = weatherInfo(c.weather_code);
  body.append(h('div', { class: 'card row' }, icon(ic, 40), h('div', { class: 'grow' }, h('div', { class: 'big' }, Math.round(c.temperature_2m) + deg),
    h('div', { class: 'muted' }, `${label} · feels ${Math.round(c.apparent_temperature)}${deg} · ${c.relative_humidity_2m}% humidity · wind ${Math.round(c.wind_speed_10m)}`))));
  const forecastHour = new Date(Date.now() + w.utc_offset_seconds * 1000).toISOString().slice(0, 13) + ':00';
  const nowIdx = w.hourly.time.findIndex((t) => t >= forecastHour);
  const hours = h('div', { class: 'hours' });
  for (let i = Math.max(0, nowIdx); i < Math.max(0, nowIdx) + 24 && i < w.hourly.time.length; i++) {
    hours.append(h('div', {}, h('span', { class: 'muted' }, new Date(w.hourly.time[i] + 'Z').toLocaleTimeString([], { hour: 'numeric', timeZone: 'UTC' })),
      icon(weatherInfo(w.hourly.weather_code[i])[0], 16), h('b', {}, Math.round(w.hourly.temperature_2m[i]) + deg),
      h('span', { class: 'muted' }, (w.hourly.precipitation_probability[i] || 0) + '%')));
  }
  body.append(h('div', { class: 'day-h' }, 'Next 24 hours'), hours, h('div', { class: 'day-h' }, '7 days'));
  w.daily.time.forEach((t, i) => body.append(h('div', { class: 'kv' },
    h('span', { class: 'row' }, icon(weatherInfo(w.daily.weather_code[i])[0], 14), i === 0 ? 'Today' : new Date(t + 'T12:00').toLocaleDateString([], { weekday: 'long' })),
    h('span', {}, h('span', { class: 'muted' }, `${w.daily.precipitation_probability_max[i] || 0}% · `), `${Math.round(w.daily.temperature_2m_min[i])}${deg} / ${Math.round(w.daily.temperature_2m_max[i])}${deg}`))));
};

// ---------- system ----------
const cpuHist = [];
function spark(values, max = 100) {
  const W = 320, H = 50;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${H - (v / max) * (H - 4) - 2}`).join(' ');
  const s = h('div'); s.innerHTML = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>`;
  return s;
}
const barH = (pct) => h('div', { class: 'bar-h' }, h('i', { style: { width: Math.min(100, pct) + '%', background: pct > 85 ? 'var(--bad)' : pct > 65 ? 'var(--warn)' : 'var(--accent)' } }));
P.system = (body) => {
  setHead('System', actionBtn('cpu', 'Task Manager', () => api.invoke('system', 'taskmgr')));
  const s = OB.state.system, d = OB.state.disk;
  if (!s) return body.append(empty('Loading…'));
  const mem = (100 * s.memUsed) / s.memTotal;
  body.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, 'CPU'), `${s.cpu}%`), spark(cpuHist.length ? cpuHist : [s.cpu]), h('div', { class: 'muted ellipsis' }, `${s.cores} threads · ${s.cpuModel}`)));
  body.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Memory'), `${fmt.bytes(s.memUsed)} / ${fmt.bytes(s.memTotal)}`), barH(mem)));
  if (d) body.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `Disk ${d.drive}`), `${fmt.bytes(d.free)} free of ${fmt.bytes(d.total)}`), barH((100 * d.used) / d.total)));
  body.append(kv('Uptime', fmt.dur(s.uptime)));
};
P.network = (body) => {
  networkPanel = mountNetworkPanel(body);
  setHead('Network', networkPanel.online);
};
let stopBatteryPanel;
function unmountBatteryPanel() {
  stopBatteryPanel?.();
  stopBatteryPanel = null;
}
P.battery = (body) => { stopBatteryPanel = mountBatteryPanel(body, setHead); };

// ---------- media ----------
P.media = (body) => {
  setHead('Now playing');
  const m = OB.state.media;
  if (!m || !m.title) return body.append(empty('Nothing is playing. Spotify, browsers, Apple Music and any app that shows in the Windows media flyout will appear here.'));
  const pct = m.duration ? (100 * m.position) / m.duration : 0;
  body.append(h('div', { class: 'row', style: { gap: '14px', alignItems: 'flex-start' } },
    m.art ? h('img', { src: m.art, style: { width: '96px', height: '96px', borderRadius: '10px', objectFit: 'cover' } }) : h('div', { class: 'card', style: { width: '96px', height: '96px', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, icon('music', 36)),
    h('div', { class: 'grow' }, h('b', { style: { fontSize: '15px' } }, m.title), h('div', { class: 'muted' }, m.artist || ''), h('div', { class: 'muted ellipsis' }, m.album || ''),
      m.duration ? h('div', { style: { marginTop: '10px' } }, barH(pct), h('div', { class: 'row muted', style: { fontSize: '11px', marginTop: '3px' } }, h('span', { class: 'grow' }, fmt.mmss(m.position * 1000)), fmt.mmss(m.duration * 1000))) : null,
      h('div', { class: 'row', style: { marginTop: '10px' } }, ...[['prev', 'prev'], [m.playing ? 'pause' : 'play', 'playpause'], ['next', 'next']].map(([ic, k]) => h('button', { class: 'btn icon', onclick: () => api.invoke('media', k) }, icon(ic, 16)))))));
  body.append(h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '11px' } }, `Source: ${(m.app || '').split('!').pop()}`));
};

// ---------- focus timer ----------
P.pomodoro = (body) => {
  const p = OB.data.pomodoro || {}, cfg = OB.settings.pomodoro;
  setHead('Focus timer', settingsBtn('focus'));
  const running = p.phase === 'focus' || p.phase === 'break';
  const left = running ? p.endsAt - Date.now() : p.phase === 'paused' ? p.remainingMs : cfg.focusMin * 60000;
  const label = { focus: 'Focus', break: 'Break', paused: 'Paused', idle: 'Ready' }[p.phase || 'idle'];
  body.append(h('div', { class: 'card', style: { textAlign: 'center' } }, h('div', { class: 'muted' }, label), h('div', { class: 'big', style: { fontSize: '52px' } }, fmt.mmss(left)),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '8px' } },
      running ? h('button', { class: 'btn', onclick: () => api.invoke('pomodoro', 'pause') }, icon('pause', 12), 'Pause') : h('button', { class: 'btn primary', onclick: () => api.invoke('pomodoro', 'start') }, icon('play', 12), p.phase === 'paused' ? 'Resume' : 'Start focus'),
      p.phase !== 'idle' ? h('button', { class: 'btn', onclick: () => api.invoke('pomodoro', 'skip') }, 'Skip') : null,
      p.phase !== 'idle' ? h('button', { class: 'btn', onclick: () => api.invoke('pomodoro', 'reset') }, 'Reset') : null)));
  body.append(kv('Sessions today', p.completedToday || 0), kv('Focus / break', `${cfg.focusMin} / ${cfg.breakMin} min`));
};

// ---------- todos ----------
P.todos = (body) => {
  const list = h('div');
  const drawTodos = () => {
    const todos = [...(OB.data.todos || [])].sort((a, b) => a.done - b.done);
    const toggle = (t) => OB.setDataKey('todos', OB.data.todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x))).then(drawTodos);
    const del = (t) => OB.setDataKey('todos', OB.data.todos.filter((x) => x.id !== t.id)).then(drawTodos);
    list.replaceChildren(...todos.map((t) => h('div', { class: `list-item ${t.done ? 'done' : ''}` },
      h('button', { class: 'check', onclick: () => toggle(t) }, t.done ? icon('check', 12) : null), h('span', { class: 't grow' }, t.text),
      h('button', { class: 'x btn icon', title: 'Delete', onclick: () => del(t) }, icon('x', 12)))));
    if (!todos.length) list.append(empty('All clear.'));
  };
  setHead('To-dos', actionBtn('trash', 'Clear completed', () => OB.setDataKey('todos', OB.data.todos.filter((t) => !t.done)).then(drawTodos)));
  const input = h('input', { placeholder: 'Add a to-do and press Enter', style: { width: '100%', marginBottom: '8px' } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) { OB.setDataKey('todos', [{ id: uid(), text: input.value.trim(), done: false, at: Date.now() }, ...OB.data.todos]).then(drawTodos); input.value = ''; }
    if (e.key === 'Escape') api.invoke('panel:close');
  });
  body.append(input, list);
  setTimeout(() => input.focus(), 30);
  drawTodos();
};

// ---------- notes ----------
P.notes = (body) => {
  setHead('Notes', h('span', { class: 'muted', id: 'saved', style: { fontWeight: 400, fontSize: '11px' } }, ''));
  const ta = h('textarea', { class: 'notes', placeholder: 'Quick notes: saved automatically, stored only on this PC.' });
  ta.value = OB.data.notes || '';
  let t = 0;
  ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => OB.setDataKey('notes', ta.value).then(() => { $('saved').textContent = 'Saved'; }), 400); });
  body.append(ta);
  setTimeout(() => ta.focus(), 30);
};

// ---------- GitHub / crypto ----------
P.github = (body) => {
  setHead('GitHub', refreshBtn('github'), settingsBtn('integrations'));
  const g = OB.state.github;
  if (!OB.settings.github.user) return body.append(empty('Add your GitHub username to see today\'s commits and activity.', 'integrations'));
  if (!g) return body.append(empty(errOf('github') || 'Loading…'));
  body.append(h('div', { class: 'card row' }, g.avatar ? h('img', { src: g.avatar, style: { width: '44px', height: '44px', borderRadius: '22px' } }) : null,
    h('div', { class: 'grow' }, h('b', {}, g.user), h('div', { class: 'muted' }, `${g.repos} repos · ${g.followers} followers`)),
    h('button', { class: 'btn', onclick: () => api.invoke('open', `https://github.com/${g.user}`) }, 'Open')));
  body.append(kv('Commits pushed today', g.commitsToday), kv('Events today', g.eventsToday), h('div', { class: 'day-h' }, 'Recent activity'));
  for (const e of g.recent) body.append(h('div', { class: 'kv' }, h('span', { class: 'ellipsis' }, `${e.type.replace(/Event$/, '')} · ${e.repo}`), h('span', { class: 'muted' }, fmt.rel(new Date(e.at).getTime()))));
};
P.crypto = (body) => {
  setHead('Crypto', refreshBtn('crypto'), settingsBtn('integrations'));
  const list = OB.state.crypto;
  if (!list) return body.append(empty(errOf('crypto') || 'Loading prices…', errOf('crypto') ? 'integrations' : null));
  for (const c of list) body.append(h('div', { class: 'kv' }, h('b', {}, c.id), h('span', {}, fmt.money(c.price, OB.settings.crypto.currency), '  ',
    h('span', { class: c.change >= 0 ? 'good' : 'bad' }, (c.change >= 0 ? '+' : '') + (c.change || 0).toFixed(2) + '%'))));
  body.append(h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '11px' } }, 'Prices from CoinGecko, refreshed every 5 minutes.'));
};

// ---------- screen time ----------
P.screenTime = (body) => {
  setHead('Screen time · today');
  const today = (OB.data.screenTime || {})[todayKey()] || {};
  const rows = Object.entries(today).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  body.append(h('div', { class: 'card' }, h('div', { class: 'big' }, fmt.dur(total)), h('div', { class: 'muted' }, 'Active time in the foreground app (idle time excluded)')));
  for (const [exe, sec] of rows.slice(0, 15)) body.append(h('div', { style: { margin: '8px 0' } }, h('div', { class: 'row' }, h('span', { class: 'grow ellipsis' }, exe.replace(/\.exe$/i, '')), h('span', { class: 'muted' }, fmt.dur(sec))), barH((100 * sec) / (rows[0][1] || 1))));
  const days = Object.keys(OB.data.screenTime || {}).sort().slice(-7);
  if (days.length > 1) {
    body.append(h('div', { class: 'day-h' }, 'Last 7 days'));
    for (const d of days) { const t = Object.values(OB.data.screenTime[d]).reduce((a, b) => a + b, 0); body.append(kv(new Date(d + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }), fmt.dur(t))); }
  }
};

// ---------- quick actions ----------
P.quick = (body) => {
  setHead('Quick actions');
  const a = (ic, label, fn) => h('button', { onclick: () => { fn(); api.invoke('panel:close'); } }, icon(ic, 18), label);
  body.append(h('div', { class: 'qa' },
    a('lock', 'Lock', () => api.invoke('system', 'lock')), a('moon', 'Sleep', () => api.invoke('system', 'sleep')), a('desktop', 'Desktop', () => api.invoke('system', 'desktop')),
    a('cpu', 'Task Manager', () => api.invoke('system', 'taskmgr')), a('scissors', 'Screenshot', () => api.invoke('system', 'snip')), a('keyboard', 'Emoji', () => api.invoke('system', 'emoji')),
    a('search', 'Search', () => api.invoke('system', 'search')), a('globe', 'Win settings', () => api.invoke('system', 'winsettings')), a('settings', 'OpenBar', () => api.invoke('settings:open'))));
  const cmds = OB.settings.commands || [];
  if (cmds.length) {
    body.append(h('div', { class: 'day-h' }, 'Commands'));
    for (const c of cmds) { const r = (OB.state.commands || {})[c.id]; body.append(h('div', { class: 'kv' }, h('span', {}, c.label), h('button', { class: 'btn', onclick: () => api.invoke('cmd:run', c.id) }, icon('play', 10), (r && r.output.split(/\r?\n/)[0].slice(0, 30)) || 'Run'))); }
  }
};

const devinErrors = {
  missing: 'Add your Devin API key in OpenBar Settings to see your cloud sessions.',
  auth: 'Devin rejected this key or it cannot view sessions. Check the key and its permissions in Settings.',
  organization: 'Check the Devin organization ID in Settings.',
  storage: 'OpenBar could not read the saved key. Try saving it again in Settings.',
  offline: 'Could not reach Devin. Check your connection and try again.',
  rate: 'Devin is receiving too many requests. Wait a moment, then try again.',
  unavailable: 'Devin sessions are unavailable right now. Try again in a moment.',
};

P.devin = (body) => {
  const list = h('div', { class: 'devin-list' });
  const message = h('div', { class: 'devin-message muted', role: 'status' });
  const more = h('button', { class: 'btn', hidden: true }, 'Load more');
  const sessions = new Map();
  let next = null, request = 0;
  const render = () => {
    const ordered = [...sessions.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    list.replaceChildren(...ordered.map((session) => {
      const status = session.local ? 'Local' : session.status;
      const time = session.updatedAt == null ? null : new Date(session.updatedAt);
      const attrs = { class: 'devin-session' };
      if (!session.local) attrs.onclick = async () => {
        if (!await api.invoke('devin:open', session.id).catch(() => false)) message.textContent = 'Could not open this session in your browser.';
      };
      return h(session.local ? 'div' : 'button', attrs,
        h('div', { class: 'devin-session-copy' }, h('strong', {}, session.title), h('span', { class: 'muted' },
          time ? `Updated ${time.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Update time unavailable')),
        h('span', { class: `devin-status ${['running', 'working', 'resuming'].includes(status) ? 'live' : ''}` }, status));
    }));
  };
  const load = async (append = false) => {
    const current = ++request;
    if (!append) { list.replaceChildren(); sessions.clear(); next = null; more.hidden = true; }
    more.disabled = true;
    message.textContent = append ? 'Loading cloud sessions…' : 'Loading Devin sessions…';
    const cloud = api.invoke('devin:list', next).catch(() => ({ error: 'unavailable' }));
    if (!append) {
      const local = await api.invoke('devin:list-local').catch(() => []);
      if (current !== request) return;
      for (const session of local) sessions.set(session.id, session);
      render();
    }
    const page = await cloud;
    if (current !== request) return;
    more.disabled = false;
    if (page.error) {
      message.replaceChildren(empty(devinErrors[page.error] || devinErrors.unavailable,
        ['missing', 'auth', 'organization', 'storage'].includes(page.error) ? 'devin' : null));
      return;
    }
    message.textContent = '';
    for (const session of page.sessions) {
      if (!sessions.has(session.id) || sessions.get(session.id).local) sessions.set(session.id, session);
    }
    render();
    next = page.next;
    more.hidden = next == null;
    if (!sessions.size && more.hidden) message.append(empty('No Devin sessions found.'));
  };
  more.onclick = () => load(true);
  setHead('Devin sessions', actionBtn('refresh', 'Refresh', () => load()), settingsBtn('devin'));
  body.append(h('div', { class: 'devin-content' },
    h('div', { class: 'devin-label' }, icon('devin', 14), 'LOCAL & CLOUD SESSIONS'), list, message, more));
  load();
};

// ---------- router ----------
let stopBrightness;
P.brightness = (body) => {
  setHead('Brightness');
  stopBrightness = mountBrightness(body);
};
function clearBrightness() {
  stopBrightness?.();
  stopBrightness = null;
}

let devinSizeObserver;
let stopBluetoothPanel;
P.bluetooth = (body) => {
  setHead('Bluetooth');
  stopBluetoothPanel = mountBluetoothPanel(body);
};
function unmountBluetoothPanel() {
  stopBluetoothPanel?.();
  stopBluetoothPanel = null;
}

let stopVolumePanel;
function unmountVolumePanel() {
  stopVolumePanel?.();
  stopVolumePanel = null;
}

let enterBodyTimer = null;
function clearEnterBody() {
  if (enterBodyTimer) { clearTimeout(enterBodyTimer); enterBodyTimer = null; }
  $('panel')?.classList.remove('enter-body');
}
function animateIn() {
  const el = $('panel');
  devinSizeObserver?.disconnect();
  devinSizeObserver = null;
  clearEnterBody();
  el.dataset.widget = widget || '';
  el.classList.remove('enter');
  if (widget === 'devin') {
    const header = el.firstElementChild;
    const content = $('body').firstElementChild;
    let height;
    const observer = new ResizeObserver(() => {
      const measured = header.offsetHeight + content.offsetHeight;
      if (observer !== devinSizeObserver || height === measured) return;
      height = measured;
      const start = !el.classList.contains('enter');
      api.invoke('panel:fit-devin', height).catch(() => {}).then(() => {
        if (start && observer === devinSizeObserver) {
          el.classList.add('enter', 'enter-body');
          enterBodyTimer = setTimeout(clearEnterBody, 600);
        }
      });
    });
    devinSizeObserver = observer;
    observer.observe(header);
    observer.observe(content);
    return;
  }
  void el.offsetWidth;
  el.classList.add('enter', 'enter-body');
  enterBodyTimer = setTimeout(clearEnterBody, 600);
}
const panelStateKeys = {
  calendar: ['calendar'],
  nextEvent: ['calendar'],
  clock: ['calendar'],
  weather: ['weather', 'errors'],
  system: ['system', 'disk'],
  media: ['media'],
  github: ['github', 'errors'],
  crypto: ['crypto', 'errors'],
  quick: ['commands'],
};
const panelDataWidgets = new Set(['pomodoro', 'screenTime']);
function shouldRedraw(kind, patch) {
  if (document.hidden) return false;
  if (kind === 'settings') return true;
  if (kind === 'data') return panelDataWidgets.has(widget);
  if (kind === 'state') {
    const keys = panelStateKeys[widget];
    return !!(keys && patch && keys.some((k) => k in patch));
  }
  return false;
}
async function draw(force) {
  if (widget === 'network' && force !== 'switch') return;
  if (widget === 'trayApps') {
    if (force !== 'switch') return;
    const target = h('div', { class: 'tray-apps' });
    $('body').replaceChildren(target);
    setHead('Background apps', actionBtn('refresh', 'Refresh background apps', () => loadTrayApps(target)));
    loadTrayApps(target);
    return;
  }
  if (['brightness', 'battery'].includes(widget) && force !== 'switch') return;
  if (widget === 'volume') {
    if (force !== 'switch') return;
    setHead('Volume');
    $('body').replaceChildren();
    stopVolumePanel = mountVolumePanel($('body'));
    return;
  }
  if (stable.has(widget) && (!force || (['devin', 'bluetooth'].includes(widget) && force !== 'switch'))) return;
  const drawing = widget;
  if (widget === 'system' && OB.state.system && force !== 'switch') { cpuHist.push(OB.state.system.cpu); if (cpuHist.length > 60) cpuHist.shift(); }
  const body = h('div');
  const fn = P[widget];
  if (widget === 'battery') fn(body);
  else if (fn) await fn(body);
  else setHead(widget);
  if (drawing !== widget) return;
  const container = $('body');
  if (force === 'switch') {
    container.replaceChildren(...body.childNodes);
  } else {
    clearEnterBody();
    const scrolled = [...container.querySelectorAll('.hours')].map((el) => el.scrollLeft);
    patchChildren(container, [...body.childNodes]);
    container.querySelectorAll('.hours').forEach((el, i) => { el.scrollLeft = scrolled[i] || 0; });
  }
}
OB.init().then(() => {
  const surfaceSync = observeSurface($('panel'));
  draw('switch').then(() => { animateIn(); surfaceSync.syncBounds(); });
  OB.on((kind, patch) => {
    if (kind === 'state' && 'net' in patch) networkPanel?.updateTraffic();
    if (shouldRedraw(kind, patch)) draw(kind === 'settings');
  });
  setInterval(() => { if (!document.hidden && ['clock', 'pomodoro'].includes(widget)) draw(); }, 1000);
  api.on('volume:hidden', unmountVolumePanel);
  api.on('panel:widget', (w, seq) => {
    unmountBluetoothPanel();
    clearBrightness();
    disposeNetworkPanel();
    unmountVolumePanel();
    unmountBatteryPanel();
    widget = w; query = ''; sel = 0;
    draw('switch').then(() => {
      if (widget !== w) return;
      animateIn();
      surfaceSync.syncBounds();
      if (seq != null) api.send('panel:ready', seq);
    });
  });
  api.on('panel', (w) => {
    if (w !== 'bluetooth') unmountBluetoothPanel();
    if (w !== 'brightness') clearBrightness();
    if (w !== 'network') disposeNetworkPanel();
    if (w !== 'battery') unmountBatteryPanel();
    if (!w) { clearEnterBody(); $('panel').classList.remove('enter'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.invoke('panel:close'); });
});
