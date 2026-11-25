'use strict';
// Data sources polled by the main process. Everything is fetched here (no CORS, one cache)
// and pushed to every window as part of the shared state.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

// ---------- CPU / RAM / disk ----------
let lastCpu = os.cpus();
function cpuPercent() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i] || c;
    for (const k of Object.keys(c.times)) total += c.times[k] - p.times[k];
    idle += c.times.idle - p.times.idle;
  });
  lastCpu = now;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

async function disk() {
  try {
    const root = path.parse(process.env.SystemRoot || 'C:/Windows').root;
    const s = await fs.promises.statfs(root);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { drive: root, total, free, used: total - free };
  } catch (_) { return null; }
}

function system() {
  const total = os.totalmem(), free = os.freemem();
  return { cpu: cpuPercent(), memUsed: total - free, memTotal: total, uptime: os.uptime(), cores: lastCpu.length, cpuModel: (lastCpu[0] || {}).model || '' };
}

// ---------- PowerShell helper (media + network) ----------
function startHelper(onData) {
  const script = path.join(__dirname, 'helper.ps1').replace('app.asar', 'app.asar.unpacked');
  let child = null, stopped = false, buf = '';
  const run = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('{')) { try { onData(JSON.parse(line)); } catch (_) { /* partial */ } }
      }
    });
    child.on('exit', () => { if (!stopped) setTimeout(run, 5000); });
  };
  run();
  return () => { stopped = true; if (child) child.kill(); };
}

// ---------- HTTP helpers ----------
async function getJson(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': 'OpenBar/0.1', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- Weather (Open-Meteo, no key) ----------
async function geocode(city) {
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`);
  const r = (j.results || [])[0];
  return r ? { lat: r.latitude, lon: r.longitude, name: `${r.name}${r.country_code ? ', ' + r.country_code : ''}` } : null;
}

async function locateByIp() {
  const providers = [
    ['https://ipapi.co/json/', (j) => j.latitude && { lat: j.latitude, lon: j.longitude, name: j.city }],
    ['https://ipwho.is/', (j) => j.success && { lat: j.latitude, lon: j.longitude, name: j.city }],
    ['https://get.geojs.io/v1/ip/geo.json', (j) => j.latitude && { lat: Number(j.latitude), lon: Number(j.longitude), name: j.city }],
  ];
  for (const [url, pick] of providers) {
    try { const r = pick(await getJson(url)); if (r) return r; } catch (_) { /* try next */ }
  }
  return null;
}

async function weather(cfg) {
  let loc = cfg.lat != null ? { lat: cfg.lat, lon: cfg.lon, name: cfg.city } : null;
  if (!loc && cfg.city) loc = await geocode(cfg.city);
  if (!loc) loc = await locateByIp().catch(() => null);
  if (!loc) throw new Error('Set a city in Settings → Weather');
  const unit = cfg.units === 'fahrenheit' ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day' +
    '&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' +
    `&timezone=auto&forecast_days=7${unit}`);
  return { place: loc.name, units: cfg.units, utc_offset_seconds: j.utc_offset_seconds, current: j.current, hourly: j.hourly, daily: j.daily, fetchedAt: Date.now() };
}

// ---------- GitHub ----------
async function github(cfg) {
  if (!cfg.user) return null;
  const headers = cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
  const [u, events] = await Promise.all([
    getJson(`https://api.github.com/users/${encodeURIComponent(cfg.user)}`, { headers }),
    getJson(`https://api.github.com/users/${encodeURIComponent(cfg.user)}/events?per_page=100`, { headers }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  let commitsToday = 0, eventsToday = 0;
  for (const e of events) {
    if ((e.created_at || '').slice(0, 10) !== today) continue;
    eventsToday++;
    if (e.type === 'PushEvent') commitsToday += (e.payload && e.payload.size) || 0;
  }
  return {
    user: u.login, avatar: u.avatar_url, followers: u.followers, repos: u.public_repos,
    commitsToday, eventsToday,
    recent: events.slice(0, 8).map((e) => ({ type: e.type, repo: e.repo && e.repo.name, at: e.created_at })),
  };
}

// ---------- Crypto (CoinGecko, no key) ----------
async function crypto(cfg) {
  if (!cfg.coins || !cfg.coins.length) return null;
  const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${cfg.coins.map(encodeURIComponent).join(',')}&vs_currencies=${cfg.currency}&include_24hr_change=true`);
  return cfg.coins.filter((c) => j[c]).map((c) => ({ id: c, price: j[c][cfg.currency], change: j[c][`${cfg.currency}_24h_change`] }));
}

// ---------- Custom command widgets ----------
function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 20000, windowsHide: true, shell: 'powershell.exe' }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: String(stdout || stderr || (err && err.message) || '').trim().slice(0, 2000), at: Date.now() });
    });
  });
}

module.exports = { system, disk, startHelper, weather, github, crypto, runCommand, getJson };
