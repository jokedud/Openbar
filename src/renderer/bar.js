'use strict';
// The dock itself. Each widget renders a node; nodes are only swapped when their markup changes.
const iconCache = new Map();
async function iconOf(p) {
  if (!p) return '';
  const k = p.toLowerCase();
  if (k !== 'ms-settings:' && /^[a-z][a-z0-9+.-]+:/.test(k)) return '';
  if (!iconCache.has(k)) {
    iconCache.set(k, '');
    const fn = /\.(lnk|url|appref-ms)$/i.test(p) ? 'apps:icon' : 'exe:icon';
    api.invoke(fn, p).then((d) => { iconCache.set(k, d || ''); scheduleRender(); });
  }
  return iconCache.get(k);
}
const iconSync = (p) => { iconOf(p); return iconCache.get((p || '').toLowerCase()) || ''; };
const letter = (name) => h('span', { class: 'ph' }, (name || '?').trim().charAt(0).toUpperCase());
const appImg = (src, name) => (src ? h('img', { src, draggable: 'false' }) : letter(name));

function panelBtn(name, cls, ...kids) {
  return h('button', { class: `w ${cls || ''} ${openPanel === name ? 'open' : ''}`, 'data-panel': name, title: TITLES[name] || '' }, ...kids);
}
const TITLES = { start: 'Launcher (search apps)', weather: 'Weather', system: 'System', network: 'Network', battery: 'Battery', pomodoro: 'Focus timer', todos: 'To-dos', notes: 'Notes', nextEvent: 'Calendar', calendar: 'Calendar', clock: 'Clock & world clocks', media: 'Now playing', github: 'GitHub', devin: 'Devin sessions', crypto: 'Crypto', screenTime: 'Screen time', quick: 'Quick actions' };

const W = {};
TITLES.bluetooth = 'Bluetooth';
W.bluetooth = () => panelBtn('bluetooth', '', icon('bluetooth', 16));
TITLES.brightness = 'Brightness';
W.brightness = () => panelBtn('brightness', '', icon('sun'));
W.start = () => panelBtn('start', '', icon('grid', 18));
W.sep = () => h('span', { class: 'sep' });
W.search = () => h('button', { class: 'w', title: 'Windows search', 'data-sys': 'search' }, icon('search', 16));
W.desktop = () => h('button', { class: 'w', title: 'Show desktop', 'data-sys': 'desktop' }, icon('desktop', 16));

W.apps = () => {
  const s = OB.settings, st = OB.state;
  const wins = st.windows || [];
  const byPath = new Map();
  for (const w of wins) {
    const k = (w.path || w.exe || '').toLowerCase();
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(w);
  }
  const box = h('div', { class: 'apps' });
  const used = new Set();
  s.pinned.forEach((p, i) => {
    const target = (p.target || p.path || '').toLowerCase();
    const list = byPath.get(target) || [];
    used.add(target);
    const active = list.some((w) => w.hwnd === st.activeHwnd);
    const labelText = p.name + (list.length ? ` (${list.length} open)` : '');
    box.append(h('button', { class: `app ${active ? 'active' : ''}`, title: list.length ? null : p.name, 'aria-label': labelText, 'data-pin': i, draggable: 'true' },
      appImg(iconSync(p.path), p.name), s.showLabels ? h('span', { class: 'label' }, p.name) : null,
      list.length ? h('span', { class: 'dot' }) : null, list.length > 1 ? h('span', { class: 'count' }, list.length) : null));
  });
  const rest = wins.filter((w) => !used.has((w.path || w.exe || '').toLowerCase()));
  if (s.pinned.length && rest.length) box.append(h('span', { class: 'sep' }));
  const groups = s.groupWindows
    ? st.windowAppOrder.filter((key) => !used.has(key)).map((key) => byPath.get(key))
    : rest.map((w) => [w]);
  for (const g of groups) {
    const w = g.find((x) => x.hwnd === st.activeHwnd) || g[0];
    const active = g.some((x) => x.hwnd === st.activeHwnd);
    const labelText = g.length > 1 ? `${w.exe}: ${g.length} windows` : w.title;
    box.append(h('button', { class: `app ${active ? 'active' : ''}`, 'aria-label': labelText, 'data-hwnds': g.map((x) => x.hwnd).join(',') },
      appImg(w.icon, w.exe), s.showLabels || !s.pinned.length ? h('span', { class: 'label' }, g.length > 1 ? w.exe.replace(/\.exe$/i, '') : w.title) : null,
      h('span', { class: 'dot' }), g.length > 1 ? h('span', { class: 'count' }, g.length) : null));
  }
  return box;
};

W.clock = () => {
  const now = new Date();
  return panelBtn('clock', 'clock', h('div', { class: 'stack' },
    h('span', { class: 'kicker' }, now.toLocaleDateString([], { weekday: 'long' })), h('span', {}, now.toLocaleDateString([], { month: 'short', day: 'numeric' }))),
    h('span', { class: 'val time' }, fmt.time(now)));
};
W.nextEvent = () => {
  const ev = nextEvents(5).find((e) => !e.allDay);
  if (!ev) return panelBtn('calendar', '', icon('calendar', 16), (OB.settings.calendars || []).length ? h('span', { class: 'sub' }, 'No more events') : null);
  const live = ev.start <= Date.now();
  const soon = !live && ev.start - Date.now() < 15 * 60000;
  const day = new Date(ev.start);
  return panelBtn('calendar', `event ${soon || live ? 'soon' : ''}`,
    h('span', { class: 'datechip' }, h('i', {}, day.toLocaleDateString([], { month: 'short' })), h('b', {}, day.getDate())),
    h('div', { class: 'stack' }, h('span', { class: 'ellipsis', style: { maxWidth: '170px' } }, ev.title),
      h('span', { class: 'sub' }, live ? `now · ends ${fmt.time(ev.end)}` : `${fmt.rel(ev.start)} · ${fmt.time(ev.start)}`)));
};
W.weather = () => {
  const w = OB.state.weather;
  if (!w || !w.current) return panelBtn('weather', '', icon('cloud', 16), OB.state.errors && OB.state.errors.weather ? h('span', { class: 'sub' }, 'Weather') : null);
  const [ic] = weatherInfo(w.current.weather_code);
  return panelBtn('weather', 'weather', icon(ic, 16), h('span', { class: 'val' }, `${Math.round(w.current.temperature_2m)}°`));
};
W.system = () => {
  const s = OB.state.system;
  if (!s) return panelBtn('system', '', icon('cpu', 16));
  const mem = Math.round((100 * s.memUsed) / s.memTotal);
  const meter = (v) => h('span', { class: 'meter' }, h('i', { style: { width: v + '%', background: v > 85 ? 'var(--bad)' : v > 65 ? 'var(--warn)' : 'var(--good)' } }));
  const line = (label, v) => h('span', { class: 'row', style: { gap: '8px', justifyContent: 'space-between' } }, label, meter(v), h('span', { class: 'val', style: { minWidth: '24px', textAlign: 'right' } }, Math.round(v) + '%'));
  return panelBtn('system', '', h('div', { class: 'stack meters', style: { gap: '5px' } }, line('CPU', s.cpu), line('RAM', mem)));
};
W.network = () => {
  const n = OB.state.net;
  return panelBtn('network', '', icon('globe', 16), h('div', { class: 'stack network-rates' },
    n && h('span', { class: 'val' }, '↓ ' + fmt.rate(n.down)), n && h('span', { class: 'val' }, '↑ ' + fmt.rate(n.up))));
};
W.battery = () => {
  const b = OB.state.battery;
  const label = b?.level != null ? `${b.level}%` : b?.pluggedIn === true ? 'Plugged in' : 'Power';
  const button = panelBtn('battery', b?.low ? 'bad' : '', icon(b?.charging ? 'bolt' : b?.present ? 'battery' : 'power', 16),
    h('span', { class: 'val' }, label));
  button.title = b?.present ? `Battery: ${label}${b.charging ? ' · Charging' : ''}` : 'Power settings';
  return button;
};
W.media = () => {
  const m = OB.state.media;
  if (!m || !m.title) return null;
  return h('div', { class: 'w-group' },
    panelBtn('media', '', m.art ? h('img', { class: 'art', src: m.art }) : icon('music', 16),
      h('div', { class: 'stack' }, h('span', { class: 'ellipsis', style: { maxWidth: '150px' } }, m.title), h('span', { class: 'sub ellipsis', style: { maxWidth: '150px' } }, m.artist || ''))),
    h('button', { class: 'w', 'data-media': 'playpause', title: m.playing ? 'Pause' : 'Play' }, icon(m.playing ? 'pause' : 'play', 14)),
    h('button', { class: 'w', 'data-media': 'next', title: 'Next' }, icon('next', 14)));
};
W.volume = () => {
  const audio = OB.state.volume;
  const ready = audio?.status === 'ready';
  const button = panelBtn('volume', '', icon(ready && !audio.muted && audio.volume ? 'speaker' : 'speaker-off', 16),
    ready ? h('span', { class: 'val' }, audio.muted ? 'Muted' : audio.volume + '%') : null);
  button.title = ready ? `Volume · ${audio.muted ? 'Muted' : audio.volume + '%'}`
    : audio?.status === 'no-output' ? 'Volume · No audio output device' : 'Volume';
  return button;
};
W.pomodoro = () => {
  const p = OB.data.pomodoro || {};
  if (p.phase === 'focus' || p.phase === 'break') return panelBtn('pomodoro', `pomo ${p.phase}`, icon('timer', 16), h('span', { class: 'val' }, fmt.mmss(p.endsAt - Date.now())));
  if (p.phase === 'paused') return panelBtn('pomodoro', 'pomo', icon('pause', 14), h('span', { class: 'val' }, fmt.mmss(p.remainingMs)));
  return panelBtn('pomodoro', 'pomo', icon('timer', 16), p.completedToday ? h('span', { class: 'sub' }, '×' + p.completedToday) : null);
};
W.todos = () => {
  const open = (OB.data.todos || []).filter((t) => !t.done).length;
  return panelBtn('todos', '', icon('check', 16), open ? h('span', { class: 'badge' }, open) : null);
};
W.notes = () => panelBtn('notes', '', icon('note', 16));
W.devin = () => panelBtn('devin', '', icon('devin', 16), h('span', {}, 'Devin'));
W.github = () => {
  const g = OB.state.github;
  return panelBtn('github', '', icon('github', 16), g ? h('span', { class: 'val' }, g.commitsToday) : null);
};
W.crypto = () => {
  const c = (OB.state.crypto || [])[0];
  if (!c) return panelBtn('crypto', '', icon('coin', 16));
  return panelBtn('crypto', '', icon('coin', 16), h('span', { class: 'val' }, fmt.money(c.price, OB.settings.crypto.currency)),
    h('span', { class: `sub ${c.change >= 0 ? 'good' : 'bad'}` }, (c.change >= 0 ? '+' : '') + (c.change || 0).toFixed(1) + '%'));
};
W.screenTime = () => {
  const t = Object.values((OB.data.screenTime || {})[todayKey()] || {}).reduce((a, b) => a + b, 0);
  return panelBtn('screenTime', '', icon('hourglass', 16), h('span', { class: 'val' }, fmt.dur(t)));
};
W.quick = () => panelBtn('quick', '', icon('power', 16));
W.settings = () => h('button', { class: 'w', title: 'OpenBar settings', 'data-settings': '1' }, icon('settings', 16));
function cmdWidget(id) {
  const c = (OB.settings.commands || []).find((x) => x.id === id);
  if (!c) return null;
  const r = (OB.state.commands || {})[id];
  const out = r ? r.output.split(/\r?\n/)[0].slice(0, 40) : '…';
  return h('button', { class: 'w', title: `${c.label}: click to re-run`, 'data-cmd': id }, icon('terminal', 14), h('span', { class: 'sub' }, c.label), h('span', { class: `val ${r && !r.ok ? 'bad' : ''}` }, out));
}

// ---------------- render ----------------
let openPanel = null;
const cache = new Map();
const appStrips = new WeakMap();
let appStripObserver;

function updateAppOverflow(strip) {
  const [apps, more] = strip.children;
  const hidden = apps.scrollWidth <= strip.clientWidth;
  if (more.hidden !== hidden) more.hidden = hidden;
  const expanded = openPanel === 'overflow';
  more.classList.toggle('open', expanded);
  more.setAttribute('aria-expanded', String(expanded));
}

function appStrip(apps) {
  const more = h('button', { class: 'w app-more', 'aria-label': 'More apps', 'aria-haspopup': 'dialog',
    title: 'More apps', onclick: (e) => showAppOverflow(apps, e.currentTarget) }, '…');
  more.hidden = true;
  const strip = h('div', { class: 'app-strip' }, apps, more);
  apps.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.deltaX || !e.deltaY || apps.scrollWidth <= apps.clientWidth) return;
    e.preventDefault();
    e.stopPropagation();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? apps.clientWidth : 1;
    apps.scrollLeft += e.deltaY * unit;
  }, { passive: false });
  return strip;
}

function showAppOverflow(apps, button) {
  const pins = OB.settings.pinned;
  const items = [];
  for (const tile of apps.children) {
    if (!tile.matches('.app')) continue;
    if (tile.offsetLeft >= apps.scrollLeft &&
        tile.offsetLeft + tile.offsetWidth <= apps.scrollLeft + apps.clientWidth) continue;
    const pin = pins[+tile.dataset.pin];
    const hwnds = pin ? runningFor(pin).map((w) => w.hwnd) : tile.dataset.hwnds.split(',').map(Number);
    items.push({ label: tile.getAttribute('aria-label'), icon: tile.querySelector('img')?.src, pin, hwnds });
  }
  if (items.length) return api.invoke('panel:toggle', 'overflow', centerX(button), items);
}

function childKey(node) {
  if (!node || node.nodeType !== 1 || !node.dataset) return null;
  if (node.dataset.pin != null) return `pin:${node.dataset.pin}`;
  if (node.dataset.hwnds) return `hwnd:${node.dataset.hwnds.split(',')[0]}`;
  return null;
}
function reconcileNodes(parent, want) {
  const keep = new Set(want);
  for (const child of [...parent.childNodes]) {
    if (!keep.has(child)) parent.removeChild(child);
  }
  for (let i = 0; i < want.length; i++) {
    if (parent.childNodes[i] !== want[i]) parent.insertBefore(want[i], parent.childNodes[i] || null);
  }
}
function patchNode(prev, next) {
  if (!prev || typeof prev.nodeType !== 'number' || typeof next.nodeType !== 'number') {
    return prev && prev.outerHTML === next.outerHTML ? prev : next;
  }
  if (prev.nodeType !== next.nodeType) return next;
  if (prev.nodeType === 3) {
    if (prev.nodeValue !== next.nodeValue) prev.nodeValue = next.nodeValue;
    return prev;
  }
  if (prev.nodeType !== 1 || prev.tagName !== next.tagName || prev.namespaceURI !== next.namespaceURI) return next;
  if (prev.outerHTML === next.outerHTML) return prev;
  for (const attr of [...prev.attributes]) {
    if (!next.hasAttribute(attr.name)) prev.removeAttribute(attr.name);
  }
  for (const attr of next.attributes) {
    if (prev.getAttribute(attr.name) !== attr.value) prev.setAttribute(attr.name, attr.value);
  }
  const nextKids = [...next.childNodes];
  const hasKeys = nextKids.some((k) => childKey(k) !== null);
  if (hasKeys) {
    const keyed = new Map();
    const unkeyed = [];
    for (const c of prev.childNodes) {
      const k = childKey(c);
      if (k !== null && !keyed.has(k)) keyed.set(k, c);
      else unkeyed.push(c);
    }
    let ui = 0;
    const want = nextKids.map((nk) => {
      const k = childKey(nk);
      const match = k !== null ? keyed.get(k) : unkeyed[ui++];
      return match ? patchNode(match, nk) : nk;
    });
    reconcileNodes(prev, want);
    return prev;
  }
  for (let i = 0; i < nextKids.length; i++) {
    const cur = prev.childNodes[i];
    if (!cur) prev.appendChild(nextKids[i]);
    else {
      const patched = patchNode(cur, nextKids[i]);
      if (patched !== cur) prev.replaceChild(patched, cur);
    }
  }
  while (prev.childNodes.length > nextKids.length) prev.removeChild(prev.lastChild);
  return prev;
}
function reconcileChildren(el, want) {
  if (typeof el.insertBefore !== 'function') {
    const cur = [...el.children];
    if (cur.length !== want.length || cur.some((c, i) => c !== want[i])) el.replaceChildren(...want);
    return;
  }
  const keep = new Set(want);
  for (const child of [...el.children]) {
    if (!keep.has(child)) el.removeChild(child);
  }
  for (let i = 0; i < want.length; i++) {
    if (el.children[i] !== want[i]) el.insertBefore(want[i], el.children[i] || null);
  }
}
function renderZone(zone, names) {
  if (zone === 'left') names = dockTabItems(names);
  const el = document.getElementById(zone);
  const want = [];
  const changedStrips = [];
  const nodes = cache.get(zone) || new Map();
  const next = new Map();
  for (const [i, item] of names.entries()) {
    const name = typeof item === 'string' ? item : item.widget;
    const fn = name?.startsWith('cmd:') ? () => cmdWidget(name.slice(4))
      : Object.hasOwn(W, name) ? W[name] : name ? null : () => dockShortcut(item);
    if (!fn) continue;
    let node = null;
    try { node = fn(); } catch (e) { console.error(name, e); }
    if (!node) continue;
    if (name) node.dataset.w = name;
    const key = typeof item === 'string' ? `${name}:${i}` : item.id;
    const prev = nodes.get(key);
    const appsChanged = node.className === 'apps' && prev?.outerHTML !== node.outerHTML;
    if (prev) node = patchNode(prev, node);
    next.set(key, node);
    if (node.className === 'apps') {
      if (!appStrips.has(node)) appStrips.set(node, appStrip(node));
      const strip = appStrips.get(node);
      if (appsChanged) changedStrips.push(strip);
      want.push(strip);
    } else want.push(node);
  }
  cache.set(zone, next);
  for (const stale of el.children) {
    if (stale.className === 'app-strip' && !want.includes(stale)) appStripObserver.unobserve(stale);
  }
  reconcileChildren(el, want);
  for (const strip of changedStrips) {
    updateAppOverflow(strip);
    (appStripObserver ||= new ResizeObserver((entries) => {
      for (const { target } of entries) updateAppOverflow(target);
    })).observe(strip);
  }
}
function pillWidth(bar) {
  bar.dataset.measuringApps = '';
  const cs = getComputedStyle(bar);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  const gap = parseFloat(cs.columnGap || cs.gap) || 0;
  let w = pad + Math.max(0, bar.children.length - 1) * gap;
  for (const z of bar.children) {
    if (!z.childElementCount) continue;
    const zcs = getComputedStyle(z);
    const zgap = parseFloat(zcs.columnGap || zcs.gap) || 0;
    w += Math.max(0, z.childElementCount - 1) * zgap;
    for (const k of z.children) w += k.className === 'app-strip' ? k.firstElementChild.scrollWidth : k.scrollWidth;
  }
  delete bar.dataset.measuringApps;
  return Math.ceil(w + 2);
}
let lastSentWidth = 0;
function render() {
  if (dragFrom != null) return;
  const s = OB.settings;
  renderZone('left', s.left); renderZone('center', s.center); renderZone('right', s.right);
  const bar = document.getElementById('bar');
  if (s.layout === 'pill') {
    const w = pillWidth(bar);
    if (w !== lastSentWidth) { lastSentWidth = w; api.invoke('bar:width', w); }
  } else {
    lastSentWidth = 0;
  }
}
let raf = 0;
function scheduleRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }

// ---------------- interaction ----------------
const centerX = (el) => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); };
async function windowMenu(hwnds) {
  const wins = (OB.state.windows || []).filter((w) => hwnds.includes(w.hwnd));
  if (!wins.length) return;
  const items = [];
  if (wins.length > 1) { wins.forEach((w) => items.push({ id: 'f' + w.hwnd, label: w.title.slice(0, 60) })); items.push({ type: 'separator' }); }
  const pinnedIdx = OB.settings.pinned.findIndex((p) => (p.target || p.path || '').toLowerCase() === (wins[0].path || '').toLowerCase());
  if (wins[0].path) items.push(pinnedIdx < 0 ? { id: 'pin', label: 'Pin to OpenBar' } : { id: 'unpin', label: 'Unpin from OpenBar' });
  if (wins[0].path) items.push({ id: 'new', label: 'New window' });
  items.push({ id: 'min', label: wins.length > 1 ? 'Minimize all' : 'Minimize' }, { id: 'close', label: wins.length > 1 ? 'Close all windows' : 'Close window' });
  const id = await api.invoke('menu', items);
  if (!id) return;
  if (id[0] === 'f') api.invoke('win:action', Number(id.slice(1)), 'focus');
  else if (id === 'pin') OB.setSettings({ pinned: [...OB.settings.pinned, { name: wins[0].exe.replace(/\.exe$/i, ''), path: wins[0].path }] });
  else if (id === 'unpin') OB.setSettings({ pinned: OB.settings.pinned.filter((_, i) => i !== pinnedIdx) });
  else if (id === 'new') api.invoke('launch', { path: wins[0].path });
  else if (id === 'min') wins.forEach((w) => api.invoke('win:action', w.hwnd, 'minimize'));
  else if (id === 'close') wins.forEach((w) => api.invoke('win:action', w.hwnd, 'close'));
}
function runningFor(p) {
  const t = (p.target || p.path || '').toLowerCase();
  return (OB.state.windows || []).filter((w) => (w.path || '').toLowerCase() === t);
}
function cycle(wins) {
  if (!wins.length) return;
  const i = wins.findIndex((w) => w.hwnd === OB.state.activeHwnd);
  if (wins.length === 1) return api.invoke('win:action', wins[0].hwnd, i < 0 ? 'focus' : 'toggle');
  if (i < 0) {
    const groupHandles = new Set(wins.map((w) => w.hwnd));
    const recent = OB.state.recentHwnds.find((hwnd) => groupHandles.has(hwnd));
    return api.invoke('win:action', recent ?? wins[0].hwnd, 'focus');
  }
  api.invoke('win:action', wins[(i + 1) % wins.length].hwnd, 'focus');
}

// ---------------- hover window previews ----------------
let hoveredPreviewKey = null;
function previewTargetFor(button) {
  if (!button || !button.classList.contains('app')) return null;
  if (button.dataset.hwnds) {
    const hwnds = button.dataset.hwnds.split(',').map(Number).filter(Boolean);
    const wins = (OB.state.windows || []).filter((w) => hwnds.includes(w.hwnd));
    if (!wins.length) return null;
    const appKey = OB.settings.groupWindows ? (wins[0].path || wins[0].exe || '').toLowerCase() : `hwnd:${wins[0].hwnd}`;
    return { hwnds: wins.map((w) => w.hwnd), appKey };
  }
  if (button.dataset.pin != null) {
    const p = OB.settings.pinned[+button.dataset.pin];
    if (!p) return null;
    const wins = runningFor(p);
    if (!wins.length) return null;
    const appKey = (p.target || p.path || '').toLowerCase();
    return { hwnds: wins.map((w) => w.hwnd), appKey };
  }
  return null;
}
function clearDockPreview(immediate = false) {
  if (hoveredPreviewKey != null || immediate) {
    hoveredPreviewKey = null;
    if (typeof api !== 'undefined') api.send(immediate ? 'preview:dismiss' : 'preview:leave-dock');
  }
}
document.addEventListener('pointermove', (e) => {
  if (dragFrom != null || openPanel || e.buttons) { clearDockPreview(true); return; }
  const btn = e.target.closest('button.app');
  const target = previewTargetFor(btn);
  if (!target) { clearDockPreview(false); return; }
  const key = `${target.appKey}|${target.hwnds.join(',')}`;
  if (key === hoveredPreviewKey) return;
  hoveredPreviewKey = key;
  api.send('preview:hover', { ...target, anchorX: centerX(btn) });
});

document.addEventListener('click', (e) => {
  clearDockPreview(true);
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tabItem) return api.invoke('tabs:open', document.getElementById('bar').dataset.customTab, t.dataset.tabItem);
  if (t.dataset.panel) return api.invoke('panel:toggle', t.dataset.panel, centerX(t));
  if (t.dataset.media) return api.invoke('media', t.dataset.media);
  if (t.dataset.sys) return api.invoke('system', t.dataset.sys);
  if (t.dataset.settings) return api.invoke('settings:open');
  if (t.dataset.cmd) return api.invoke('cmd:run', t.dataset.cmd);
  if (t.dataset.hwnds) return cycle((OB.state.windows || []).filter((w) => t.dataset.hwnds.split(',').map(Number).includes(w.hwnd)));
  if (t.dataset.pin != null) {
    const p = OB.settings.pinned[+t.dataset.pin];
    const wins = runningFor(p);
    if (wins.length && !e.shiftKey) cycle(wins); else api.invoke('launch', p);
  }
});
document.addEventListener('auxclick', (e) => {
  clearDockPreview(true);
  const t = e.target.closest('button');
  if (e.button !== 1 || !t) return;
  if (t.dataset.pin != null) api.invoke('launch', OB.settings.pinned[+t.dataset.pin]);
  if (t.dataset.hwnds) { const w = OB.state.windows.find((x) => x.hwnd === Number(t.dataset.hwnds.split(',')[0])); if (w && w.path) api.invoke('launch', { path: w.path }); }
});
document.addEventListener('contextmenu', async (e) => {
  clearDockPreview(true);
  e.preventDefault();
  const t = e.target.closest('button');
  if (t && t.dataset.hwnds) return windowMenu(t.dataset.hwnds.split(',').map(Number));
  if (t && t.dataset.pin != null) {
    const i = +t.dataset.pin, p = OB.settings.pinned[i], wins = runningFor(p);
    const items = [{ id: 'open', label: `Open ${p.name}` }, { id: 'unpin', label: 'Unpin' }];
    if (i > 0) items.push({ id: 'left', label: 'Move left' });
    if (i < OB.settings.pinned.length - 1) items.push({ id: 'right', label: 'Move right' });
    if (wins.length) items.push({ type: 'separator' }, { id: 'min', label: 'Minimize' }, { id: 'close', label: wins.length > 1 ? 'Close all windows' : 'Close window' });
    const id = await api.invoke('menu', items);
    const pinned = [...OB.settings.pinned];
    if (id === 'open') api.invoke('launch', p);
    else if (id === 'unpin') { pinned.splice(i, 1); OB.setSettings({ pinned }); }
    else if (id === 'left' || id === 'right') { const j = id === 'left' ? i - 1 : i + 1; [pinned[i], pinned[j]] = [pinned[j], pinned[i]]; OB.setSettings({ pinned }); }
    else if (id === 'min') wins.forEach((w) => api.invoke('win:action', w.hwnd, 'minimize'));
    else if (id === 'close') wins.forEach((w) => api.invoke('win:action', w.hwnd, 'close'));
    return;
  }
  const id = await api.invoke('menu', [
    { id: 'settings', label: 'OpenBar settings…' }, { id: 'apps', label: 'Pin apps…' }, { id: 'widgets', label: 'Arrange widgets…' },
    { id: 'custom-tabs', label: 'Edit custom tabs…' }, { type: 'separator' },
    { id: 'pos', label: OB.settings.position === 'top' ? 'Move to bottom' : 'Move to top' },
    { id: 'layout', label: OB.settings.layout === 'pill' ? 'Full-width layout' : 'Floating pill layout' },
    { id: 'labels', label: 'Show app labels', checked: !!OB.settings.showLabels },
    { type: 'separator' }, { id: 'taskmgr', label: 'Task Manager' }, { id: 'quit', label: 'Quit OpenBar' },
  ]);
  if (id === 'settings') api.invoke('settings:open');
  else if (id === 'apps' || id === 'widgets' || id === 'custom-tabs') api.invoke('settings:open', id);
  else if (id === 'pos') OB.setSettings({ position: OB.settings.position === 'top' ? 'bottom' : 'top' });
  else if (id === 'layout') OB.setSettings({ layout: OB.settings.layout === 'pill' ? 'full' : 'pill' });
  else if (id === 'labels') OB.setSettings({ showLabels: !OB.settings.showLabels });
  else if (id === 'taskmgr') api.invoke('system', 'taskmgr');
  else if (id === 'quit') api.invoke('quit');
});

// drag to reorder pinned apps
let dragFrom = null;
document.addEventListener('dragstart', (e) => { clearDockPreview(true); const t = e.target.closest('[data-pin]'); if (t) { dragFrom = +t.dataset.pin; t.classList.add('dragging'); } });
document.addEventListener('dragover', (e) => { if (dragFrom != null) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const t = e.target.closest('[data-pin]');
  if (dragFrom == null || !t) return;
  const to = +t.dataset.pin, pinned = [...OB.settings.pinned];
  const [m] = pinned.splice(dragFrom, 1); pinned.splice(to, 0, m);
  OB.setSettings({ pinned });
});
document.addEventListener('dragend', (e) => {
  if (dragFrom == null) return;
  dragFrom = null;
  e.target.classList.remove('dragging');
  scheduleRender();
});

OB.init().then(() => {
  const barEl = document.getElementById('bar');
  observeSurface(barEl);
  barEl?.addEventListener?.('mouseleave', () => clearDockPreview(false));
  OB.on(scheduleRender);
  api.on('panel', (name) => {
    openPanel = name;
    for (const strip of barEl.querySelectorAll('.app-strip')) updateAppOverflow(strip);
    scheduleRender();
  });
  setInterval(scheduleRender, 1000);
  render();
});
