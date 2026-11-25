'use strict';
const TABS = [
  ['welcome', 'Welcome', 'grid'], ['general', 'Appearance', 'desktop'], ['widgets', 'Widgets', 'grid'], ['custom-tabs', 'Custom tabs', 'grid'], ['apps', 'Pinned apps', 'pin'],
  ['calendar', 'Calendar', 'calendar'], ['weather', 'Weather', 'sun'], ['clocks', 'World clocks', 'globe'], ['integrations', 'GitHub & crypto', 'github'],
  ['devin', 'Devin', 'devin'],
  ['commands', 'Command widgets', 'terminal'], ['automations', 'Automations', 'bolt'], ['focus', 'Focus timer', 'timer'], ['about', 'Backup & about', 'note'],
];
const WIDGETS = {
  start: 'App launcher', apps: 'Pinned & running apps', search: 'Windows search', desktop: 'Show desktop', sep: 'Separator', clock: 'Clock & date',
  nextEvent: 'Next meeting', weather: 'Weather', system: 'CPU & RAM', network: 'Network speed', battery: 'Battery & power', brightness: 'Brightness', media: 'Now playing', volume: 'Volume',
  pomodoro: 'Focus timer', todos: 'To-dos', notes: 'Notes', github: 'GitHub activity', devin: 'Devin sessions', crypto: 'Crypto prices', screenTime: 'Screen time',
  quick: 'Quick actions', settings: 'Settings button',
  bluetooth: 'Bluetooth', notifications: 'Notifications',
};
let tab = new URLSearchParams(location.search).get('tab') || 'general';
const $ = (id) => document.getElementById(id);
const S = () => OB.settings;
const save = (patch) => OB.setSettings(patch);

const field = (label, hint, control) => h('div', { class: 'field' }, h('div', { class: 'l' }, label, hint ? h('small', {}, hint) : null), control);
const toggle = (get, set) => { const b = h('button', { class: `toggle ${get() ? 'on' : ''}` }); b.onclick = () => { set(!get()); b.classList.toggle('on'); }; return b; };
const seg = (opts, cur, set) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: cur === v ? 'on' : '', onclick: () => set(v) }, l)));
const text = (val, set, ph, type = 'text') => { const i = h('input', { type, value: val == null ? '' : val, placeholder: ph || '' }); i.onchange = () => set(type === 'number' ? Number(i.value) : i.value.trim()); return i; };
const num = (val, min, max, fallback, set) => {
  const i = h('input', { type: 'number', value: val == null ? '' : val, min, ...(max != null ? { max } : {}) });
  i.onchange = () => {
    const raw = Number(i.value);
    let v = i.value.trim() !== '' && Number.isFinite(raw) ? raw : fallback;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    i.value = String(v);
    set(v);
  };
  return i;
};
let appQuery = '';
let stateUpdater = null;
const sel = (opts, cur, set) => { const s = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v, selected: v === cur }, l))); s.onchange = () => set(s.value); return s; };
const deepSet = (key, patch) => save({ [key]: Object.assign({}, S()[key], patch) });

const T = {};
T['custom-tabs'] = drawCustomTabs;
T.welcome = (m) => {
  m.append(h('h1', {}, 'Welcome to OpenBar'), h('p', { class: 'lead' }, 'A free, open-source smart dock for Windows 10/11. It replaces the taskbar with your pinned and running apps plus live widgets: meetings, weather, system stats, music, focus timer, to-dos and more. Everything stays on this PC.'));
  m.append(h('h2', {}, 'Quick setup'));
  m.append(field('Where should the bar live?', null, seg([['bottom', 'Bottom'], ['top', 'Top']], S().position, (v) => save({ position: v }).then(draw))));
  m.append(field('Style', null, seg([['full', 'Full width'], ['pill', 'Floating pill']], S().layout, (v) => save({ layout: v }).then(draw))));
  m.append(field('Windows taskbar', 'OpenBar restores it automatically when you quit.', taskbarSeg()));
  m.append(field('Start OpenBar when Windows starts', null, toggle(() => S().launchAtLogin, (v) => save({ launchAtLogin: v }))));
  m.append(h('h2', {}, 'Next steps'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    ...[['apps', 'Pin your apps'], ['calendar', 'Connect a calendar'], ['weather', 'Set your city'], ['widgets', 'Arrange widgets']].map(([t, l]) => h('button', { class: 'btn', onclick: () => go(t) }, l))));
  m.append(h('p', { class: 'hint', style: { marginTop: '24px' } }, 'Tips: right-click the bar for quick options, middle-click an app to open a new window, drag pinned apps to reorder them, and use the tray icon to restore the Windows taskbar at any time.'));
};
function taskbarSeg() { return seg([['hide', 'Hide'], ['autohide', 'Auto-hide'], ['keep', 'Leave alone']], S().taskbar, (v) => save({ taskbar: v }).then(draw)); }

T.general = (m) => {
  m.append(h('h1', {}, 'Appearance'), h('p', { class: 'lead' }, 'Changes apply instantly.'));
  m.append(h('h2', {}, 'Theme'));
  const sw = { glass: '#1a1c24', midnight: '#0c1228', black: '#000', white: '#fafafc', ios: '#ececf1', sunset: '#3a1432' };
  m.append(h('div', { class: 'themes' }, ...Object.entries(sw).map(([k, c]) => h('button', { class: `theme ${S().style === k ? 'on' : ''}`, onclick: () => save({ style: k }).then(draw) },
    h('div', { class: 'sw', style: { background: c } }), k[0].toUpperCase() + k.slice(1)))));
  m.append(h('h2', {}, 'Layout'));
  m.append(field('Position', null, seg([['bottom', 'Bottom'], ['top', 'Top']], S().position, (v) => save({ position: v }).then(draw))));
  m.append(field('Layout', 'Full width spans the screen; pill floats in the centre and fits its content.', seg([['full', 'Full width'], ['pill', 'Pill']], S().layout, (v) => save({ layout: v }).then(draw))));
  m.append(field('Bar height', '32–72 px', num(S().height, 32, 72, 54, (v) => save({ height: v }))));
  m.append(field('Gap around the bar', '0–20 px', num(S().margin, 0, 20, 6, (v) => save({ margin: v }))));
  m.append(field('Reserve screen space', 'Maximised windows stop at the bar instead of going under it.', toggle(() => S().reserveSpace, (v) => save({ reserveSpace: v }))));
  m.append(h('h2', {}, 'Behaviour'));
  m.append(field('Windows taskbar', 'What to do with the built-in taskbar while OpenBar runs.', taskbarSeg()));
  m.append(field('Show app names', null, toggle(() => S().showLabels, (v) => save({ showLabels: v }))));
  m.append(field('Group windows of the same app', null, toggle(() => S().groupWindows, (v) => save({ groupWindows: v }))));
  m.append(field('Notification sounds', null, toggle(() => S().sounds, (v) => save({ sounds: v }))));
  m.append(field('Start with Windows', 'Applies to the installed / portable build.', toggle(() => S().launchAtLogin, (v) => save({ launchAtLogin: v }))));
};

T.widgets = (m) => {
  m.append(h('h1', {}, 'Widgets'), h('p', { class: 'lead' }, 'Choose what appears in each part of the bar. Use the arrows to reorder or move widgets between zones.'));
  const zones = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
  const all = { ...WIDGETS };
  for (const c of S().commands || []) all['cmd:' + c.id] = 'Command: ' + c.label;
  const used = new Set([...S().left, ...S().center, ...S().right].filter((w) => w !== 'sep'));
  const move = (zone, i, dz, di) => {
    const z = { left: [...S().left], center: [...S().center], right: [...S().right] };
    const [w] = z[zone].splice(i, 1);
    if (dz) z[dz].splice(di == null ? z[dz].length : di, 0, w);
    save(z).then(draw);
  };
  m.append(h('div', { class: 'zones' }, ...zones.map(([zk, zl], zi) => h('div', { class: 'zone-box' }, h('h3', {}, zl),
    ...S()[zk].map((w, i) => h('div', { class: 'chip' }, h('span', { class: 'grow' }, all[w] || w),
      zi > 0 ? h('button', { title: 'Move to ' + zones[zi - 1][1], onclick: () => move(zk, i, zones[zi - 1][0]) }, '«') : null,
      i > 0 ? h('button', { title: 'Up', onclick: () => move(zk, i, zk, i - 1) }, '↑') : null,
      i < S()[zk].length - 1 ? h('button', { title: 'Down', onclick: () => move(zk, i, zk, i + 1) }, '↓') : null,
      zi < 2 ? h('button', { title: 'Move to ' + zones[zi + 1][1], onclick: () => move(zk, i, zones[zi + 1][0]) }, '»') : null,
      h('button', { title: 'Remove', onclick: () => move(zk, i) }, icon('x', 12))))))));
  m.append(h('h2', {}, 'Add a widget'));
  const avail = Object.entries(all).filter(([k]) => !used.has(k));
  m.append(h('div', { class: 'row', style: { flexWrap: 'wrap', maxWidth: '900px' } }, ...avail.map(([k, l]) => h('button', { class: 'btn', onclick: () => save({ right: [k, ...S().right] }).then(draw) }, icon('plus', 12), l))));
};

T.apps = (m) => {
  m.append(h('h1', {}, 'Pinned apps'), h('p', { class: 'lead' }, 'Pinned apps stay on the bar; a dot shows when they are running. You can also right-click any running app on the bar and choose "Pin".'));
  const list = h('div', { class: 'list' });
  const pinned = S().pinned;
  pinned.forEach((p, i) => {
    const img = h('span', { class: 'ph' }, p.name[0]);
    api.invoke(/\.(lnk|url|appref-ms)$/i.test(p.path) ? 'apps:icon' : 'exe:icon', p.path).then((d) => { if (d) img.replaceWith(h('img', { src: d })); });
    const mv = (d) => { const a = [...pinned]; [a[i], a[i + d]] = [a[i + d], a[i]]; save({ pinned: a }).then(draw); };
    list.append(h('div', { class: 'li' }, img, h('div', { class: 'grow' }, h('div', {}, p.name), h('div', { class: 'hint ellipsis' }, p.path + (p.args ? ' ' + p.args : ''))),
      i > 0 ? h('button', { class: 'btn icon', onclick: () => mv(-1) }, '↑') : null, i < pinned.length - 1 ? h('button', { class: 'btn icon', onclick: () => mv(1) }, '↓') : null,
      h('button', { class: 'btn icon', title: 'Unpin', onclick: () => save({ pinned: pinned.filter((_, j) => j !== i) }).then(draw) }, icon('trash', 14))));
  });
  if (!pinned.length) list.append(h('p', { class: 'hint' }, 'Nothing pinned yet.'));
  m.append(list, h('h2', {}, 'Add from Start Menu'));
  const q = h('input', { type: 'text', value: appQuery, placeholder: 'Search installed apps…', style: { width: '320px' } });
  const res = h('div', { class: 'results' });
  const pinnedSet = new Set(pinned.map((p) => (p.path || '').toLowerCase()));
  let apps = [];
  const show = () => {
    appQuery = q.value;
    const t = q.value.trim().toLowerCase();
    res.replaceChildren(...apps.filter((a) => !t || a.name.toLowerCase().includes(t)).slice(0, 40).map((a) => {
      const already = pinnedSet.has((a.path || '').toLowerCase());
      return h('div', { class: 'li' }, h('span', { class: 'grow' }, a.name),
        already
          ? h('button', { class: 'btn', disabled: true, style: { opacity: '.5' } }, 'Pinned')
          : h('button', { class: 'btn', onclick: () => save({ pinned: [...S().pinned, { name: a.name, path: a.path, target: a.target || '' }] }).then(draw) }, icon('plus', 12), 'Pin'));
    }));
  };
  q.oninput = show;
  api.invoke('apps:list').then((a) => { apps = a; show(); });
  m.append(q, res, h('h2', {}, 'Add a custom item'));
  const n = h('input', { type: 'text', placeholder: 'Name' }), pth = h('input', { type: 'text', placeholder: 'C:/path/to/app.exe, a folder, or https://…', style: { width: '340px' } }), args = h('input', { type: 'text', placeholder: 'Arguments (optional)' });
  m.append(h('div', { class: 'row', style: { flexWrap: 'wrap' } }, n, pth, args, h('button', { class: 'btn primary', onclick: () => {
    if (!pth.value.trim()) return;
    save({ pinned: [...S().pinned, { name: n.value.trim() || pth.value.split(/[/\x5c]/).pop(), path: pth.value.trim(), target: pth.value.trim(), args: args.value.trim() }] }).then(draw);
  } }, 'Add')));
};

T.calendar = (m) => {
  m.append(h('h1', {}, 'Calendar'), h('p', { class: 'lead' }, 'Paste the secret iCal (ICS) address of any calendar: Google Calendar (Settings → your calendar → "Secret address in iCal format"), Outlook.com / Microsoft 365 (Settings → Shared calendars → Publish), iCloud, Fastmail, Proton and more. No sign-in or OAuth app needed, and the URL never leaves your PC.'));
  const cals = S().calendars;
  const list = h('div', { class: 'list' });
  cals.forEach((c, i) => list.append(h('div', { class: 'li' }, icon('calendar', 16), h('div', { class: 'grow' }, h('div', {}, c.name || 'Calendar'), h('div', { class: 'hint ellipsis' }, c.url.replace(/(.{48}).+/, '$1…'))),
    h('button', { class: 'btn icon', onclick: () => save({ calendars: cals.filter((_, j) => j !== i) }).then(draw) }, icon('trash', 14)))));
  const n = h('input', { type: 'text', placeholder: 'Name (e.g. Work)' }), u = h('input', { type: 'text', placeholder: 'https://… .ics or webcal://…', style: { width: '380px' } });
  m.append(list, h('div', { class: 'row', style: { marginTop: '10px' } }, n, u, h('button', { class: 'btn primary', onclick: () => { if (u.value.trim()) save({ calendars: [...cals, { name: n.value.trim() || 'Calendar', url: u.value.trim() }] }).then(draw); } }, 'Add calendar')));
  const status = h('p', { class: 'hint', style: { marginTop: '14px' } });
  const renderStatus = () => {
    const st = OB.state.calendar || {};
    status.replaceChildren(`${(st.events || []).length} upcoming events loaded.`, ...(st.errors || []).map((e) => h('div', { class: 'bad' }, e)));
  };
  renderStatus();
  stateUpdater = renderStatus;
  m.append(status);
  m.append(h('h2', {}, 'Meetings'));
  const setA = (p) => deepSet('automations', p);
  m.append(field('Reminder before meetings', 'A notification with a one-click Join button for Zoom, Meet, Teams, Webex and Whereby links.', toggle(() => S().automations.meetingReminders, (v) => setA({ meetingReminders: v }))));
  m.append(field('Minutes before', null, num(S().automations.reminderMinutesBefore, 1, null, 5, (v) => setA({ reminderMinutesBefore: v }))));
};

T.weather = (m) => {
  const w = S().weather;
  m.append(h('h1', {}, 'Weather'), h('p', { class: 'lead' }, 'Forecasts from Open-Meteo (free, no API key). Leave the city empty to detect your location from your IP address.'));
  m.append(field('City', 'e.g. Toronto, London, Tokyo', text(w.city, (v) => deepSet('weather', { city: v, lat: null, lon: null }), 'Auto-detect')));
  m.append(field('Units', null, seg([['celsius', '°C'], ['fahrenheit', '°F']], w.units, (v) => deepSet('weather', { units: v }).then(draw))));
  m.append(field('Umbrella reminder', 'Morning notification when rain is likely today.', toggle(() => S().automations.umbrellaReminder, (v) => deepSet('automations', { umbrellaReminder: v }))));
  const status = h('div', {});
  const renderStatus = () => {
    const cur = OB.state.weather;
    const kids = [];
    if (cur && cur.current) kids.push(h('p', { class: 'hint' }, `Currently ${Math.round(cur.current.temperature_2m)}° in ${cur.place || 'your area'}.`));
    if (OB.state.errors && OB.state.errors.weather) kids.push(h('p', { class: 'hint bad' }, OB.state.errors.weather));
    status.replaceChildren(...kids);
  };
  renderStatus();
  stateUpdater = renderStatus;
  m.append(status);
};

T.clocks = (m) => {
  m.append(h('h1', {}, 'World clocks'), h('p', { class: 'lead' }, 'Shown in the clock panel. Use IANA time zone names such as America/Los_Angeles or Asia/Kolkata.'));
  const z = S().worldClocks;
  const list = h('div', { class: 'list' });
  z.forEach((tz, i) => list.append(h('div', { class: 'li' }, icon('globe', 16), h('span', { class: 'grow' }, tz), h('span', { class: 'muted' }, (() => { try { return new Date().toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' }); } catch (_) { return 'invalid'; } })()),
    h('button', { class: 'btn icon', onclick: () => save({ worldClocks: z.filter((_, j) => j !== i) }).then(draw) }, icon('trash', 14)))));
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).filter((x) => !z.includes(x));
  const s = sel([['', 'Add a time zone…'], ...zones.map((x) => [x, x])], '', (v) => { if (v) save({ worldClocks: [...z, v] }).then(draw); });
  m.append(list, s);
};

T.integrations = (m) => {
  const g = S().github, c = S().crypto;
  m.append(h('h1', {}, 'GitHub & crypto'), h('h2', {}, 'GitHub'));
  m.append(field('Username', 'Shows commits pushed today and recent activity.', text(g.user, (v) => deepSet('github', { user: v }))));
  m.append(field('Token (optional)', 'Raises the API rate limit and includes private activity. Stored locally only.', text(g.token, (v) => deepSet('github', { token: v }), 'ghp_…', 'password')));
  m.append(h('h2', {}, 'Crypto'));
  m.append(field('Coins', 'CoinGecko IDs, comma separated (bitcoin, ethereum, solana…)', text(c.coins.join(', '), (v) => deepSet('crypto', { coins: v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) }))));
  m.append(field('Currency', null, text(c.currency, (v) => deepSet('crypto', { currency: (v || 'usd').toLowerCase() }))));
};

T.devin = (m) => {
  const key = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Paste your key', 'aria-label': 'Devin API key' });
  const organization = h('input', { type: 'text', placeholder: 'org-…', 'aria-label': 'Devin organization ID' });
  const status = h('p', { class: 'hint', role: 'status' });
  const update = async (channel, ...args) => {
    saveKey.disabled = true;
    removeKey.disabled = true;
    const config = await api.invoke(channel, ...args).catch(() => ({ error: 'storage' }));
    saveKey.disabled = false;
    if (config.error) {
      removeKey.disabled = !configured;
      status.textContent = ({
        invalid: 'Paste a valid Devin API key.',
        organization: 'Enter the organization ID from Settings → Devin API.',
        storage: 'Could not update the key in secure storage.',
      })[config.error];
      return;
    }
    configured = config.configured;
    removeKey.disabled = !configured;
    organization.value = config.orgId;
    key.placeholder = configured ? 'Leave blank to keep saved key' : 'Paste your key';
    key.value = '';
    status.textContent = configured ? 'API key saved on this PC.' : 'No API key saved.';
  };
  let configured = false;
  const saveKey = h('button', { class: 'btn primary', onclick: () => update('devin:save', key.value, organization.value) }, 'Save Devin settings');
  const removeKey = h('button', { class: 'btn', onclick: () => update('devin:remove') }, 'Remove API key');
  m.append(h('h1', {}, 'Devin'), h('p', { class: 'lead' }, 'Open Devin Cloud sessions right from the dock. The public Devin API does not list local desktop sessions.'),
    field('API key', 'Create a personal access token in Devin under Settings → Devin API. OpenBar encrypts the key on this PC.', key),
    field('Organization ID', 'Required for current tokens. Copy it from the top of the same page. Legacy apk_ keys do not use this field.', organization),
    h('div', { class: 'row' }, saveKey, removeKey), status);
  if (OB.platform === 'win32') m.append(
    field('Devin fold cursor', 'Show a click-through visual pointer when a Devin session is active. Local activity is estimated from recent updates.',
      toggle(() => S().devinCursor, (v) => save({ devinCursor: v }))),
    field('Pixel otter', 'Keep an animated otter companion at the corner of the dock.',
      toggle(() => S().devinOtter, (v) => save({ devinOtter: v }))));
  if (!['left', 'center', 'right'].some((zone) => S()[zone].includes('devin'))) {
    m.append(h('button', { class: 'btn', onclick: () => save({ right: [...S().right, 'devin'] }).then(draw) }, 'Add Devin to dock'));
  }
  update('devin:config');
};

T.commands = (m) => {
  m.append(h('h1', {}, 'Command widgets'), h('p', { class: 'lead' }, 'Turn any PowerShell command into a live widget: build status, unread mail count, git branch, a server ping, your AI usage via a CLI… The first line of output is shown on the bar. New commands are added to the right side of the bar; reorder or move them on the Widgets page.'));
  const cmds = S().commands;
  const list = h('div', { class: 'list' });
  const outNodes = new Map();
  cmds.forEach((c, i) => {
    const out = h('div', { class: 'hint' });
    outNodes.set(c.id, out);
    list.append(h('div', { class: 'li' }, icon('terminal', 16), h('div', { class: 'grow' }, h('div', {}, c.label, h('span', { class: 'muted' }, `  every ${c.intervalSec}s`)), h('code', {}, c.command), out),
      h('button', { class: 'btn icon', onclick: () => { const left = S().left.filter((x) => x !== 'cmd:' + c.id), center = S().center.filter((x) => x !== 'cmd:' + c.id), right = S().right.filter((x) => x !== 'cmd:' + c.id); save({ commands: cmds.filter((_, j) => j !== i), left, center, right }).then(draw); } }, icon('trash', 14))));
  });
  const renderOutputs = () => {
    for (const [id, out] of outNodes) {
      const r = (OB.state.commands || {})[id];
      out.className = `hint ${r && !r.ok ? 'bad' : ''}`;
      out.textContent = r ? '→ ' + r.output.split(/\r?\n/)[0] : '';
    }
  };
  renderOutputs();
  stateUpdater = renderOutputs;
  const l = h('input', { type: 'text', placeholder: 'Label' }), cm = h('input', { type: 'text', placeholder: 'e.g. (Get-Date).DayOfYear', style: { width: '320px' } }), iv = h('input', { type: 'number', value: 60, style: { width: '80px' } });
  m.append(list, h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } }, l, cm, iv, h('span', { class: 'muted' }, 'sec'), h('button', { class: 'btn primary', onclick: () => {
    if (!cm.value.trim()) return;
    const id = uid();
    save({ commands: [...cmds, { id, label: l.value.trim() || 'Command', command: cm.value.trim(), intervalSec: Math.max(5, Number(iv.value) || 60) }], right: ['cmd:' + id, ...S().right] }).then(draw);
  } }, 'Add')));
  m.append(h('p', { class: 'hint', style: { marginTop: '14px' } }, 'Commands run as your user with PowerShell and a 20 second timeout. Only add commands you trust.'));
};

T.automations = (m) => {
  const set = (p) => deepSet('automations', p);
  m.append(h('h1', {}, 'Automations'), h('p', { class: 'lead' }, 'Small things OpenBar does for you in the background.'));
  m.append(field('Pause music before meetings', 'Pauses whatever is playing shortly before a calendar event starts.', toggle(() => S().automations.pauseMusicBeforeMeetings, (v) => set({ pauseMusicBeforeMeetings: v }))));
  m.append(field('Minutes before meeting to pause', null, num(S().automations.pauseMinutesBefore, 0, null, 1, (v) => set({ pauseMinutesBefore: v }))));
  m.append(field('Meeting reminders', 'Notification with one-click Join.', toggle(() => S().automations.meetingReminders, (v) => set({ meetingReminders: v }))));
  m.append(field('Pause music when a focus session starts', null, toggle(() => S().automations.pauseMusicOnPomodoro, (v) => set({ pauseMusicOnPomodoro: v }))));
  m.append(field('Umbrella reminder', 'Morning heads-up when rain is likely.', toggle(() => S().automations.umbrellaReminder, (v) => set({ umbrellaReminder: v }))));
  m.append(field('High CPU alert', 'Notify when CPU stays above 90% for a minute.', toggle(() => S().automations.highCpuAlert, (v) => set({ highCpuAlert: v }))));
  m.append(field('Low disk alert', 'Notify when the system drive is under 5% free.', toggle(() => S().automations.lowDiskAlert, (v) => set({ lowDiskAlert: v }))));
};

T.focus = (m) => {
  const p = S().pomodoro;
  m.append(h('h1', {}, 'Focus timer'), h('p', { class: 'lead' }, 'A Pomodoro timer on the bar. Sessions are counted per day.'));
  m.append(field('Focus minutes', null, num(p.focusMin, 1, null, 25, (v) => deepSet('pomodoro', { focusMin: v }))));
  m.append(field('Break minutes', null, num(p.breakMin, 1, null, 5, (v) => deepSet('pomodoro', { breakMin: v }))));
};

T.about = (m) => {
  m.append(h('h1', {}, 'Backup & about'), h('p', { class: 'lead' }, `OpenBar ${OB.version} · MIT licensed · no accounts, no telemetry. Settings and data are stored in your user profile.`));
  m.append(h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    h('button', { class: 'btn', onclick: () => { const blob = new Blob([JSON.stringify({ settings: S(), data: OB.data }, null, 2)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: 'openbar-backup.json' }); a.click(); } }, 'Export backup'),
    h('label', { class: 'btn' }, 'Import backup', h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); const cmds = (j.settings && j.settings.commands) || []; if (cmds.length && !confirm(`This backup contains command widgets that will run on this PC:\n\n${cmds.map((c) => c.command).join('\n')}\n\nImport them?`)) j.settings.commands = []; if (j.settings) await api.invoke('settings:replace', j.settings); if (j.data) for (const k of Object.keys(j.data)) if (k !== 'taskbarRestore') await OB.setDataKey(k, j.data[k]); OB.settings = await api.invoke('init').then((r) => r.settings); draw(); } catch (err) { alert('Invalid backup: ' + err.message); }
    } })),
    h('button', { class: 'btn', onclick: async () => {
      if (!confirm('Reset all settings to defaults and remove the saved Devin API key?')) return;
      try {
        OB.settings = await api.invoke('settings:reset');
        draw();
      } catch {
        alert('Could not reset settings.');
      }
    } }, 'Reset settings'),
    h('button', { class: 'btn', onclick: () => api.invoke('open', 'https://github.com/jokedud/openbar') }, icon('github', 14), 'Source code'),
    h('button', { class: 'btn', onclick: () => api.invoke('quit') }, icon('power', 14), 'Quit OpenBar')));
};

function go(t) { tab = t; draw(); }
function draw() {
  stateUpdater = null;
  $('nav').replaceChildren($('nav').firstElementChild, ...TABS.map(([k, l, ic]) => h('button', { class: tab === k ? 'on' : '', onclick: () => go(k) }, icon(ic, 15), l)));
  const m = $('main'), y = m.scrollTop;
  m.replaceChildren();
  (T[tab] || T.general)(m);
  m.scrollTop = y;
}
OB.init().then(() => {
  draw();
  api.on('settings:tab', (t) => go(t));
  OB.on((kind) => {
    if (kind === 'settings' && (!document.activeElement || !document.activeElement.matches('input, select, textarea'))) draw();
    else if (kind === 'state' && stateUpdater) stateUpdater();
  });
});
