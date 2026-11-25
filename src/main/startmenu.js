'use strict';
// Indexes Start Menu shortcuts for the launcher and resolves icons.
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

const iconCache = new Map();

async function iconFor(file) {
  if (!file) return '';
  if (iconCache.has(file)) return iconCache.get(file);
  if (process.platform === 'win32' && /\.(lnk|url|appref-ms)$/i.test(file)) {
    try {
      const url = require('./shortcut-icon').shortcutIcon(file);
      if (url) { iconCache.set(file, url); return url; }
    } catch (_) { /* fall back to Electron's icon lookup */ }
  }
  const files = [file];
  if (/\.lnk$/i.test(file)) {
    try {
      const { target, icon } = shell.readShortcutLink(file);
      if (!icon && target && target !== file) files.unshift(target);
    } catch (_) { /* use the shortcut icon */ }
  }
  let url = '';
  for (const candidate of files) {
    try {
      const img = await app.getFileIcon(candidate, { size: 'large' });
      if (!img.isEmpty()) { url = img.toDataURL(); break; }
    } catch (_) { /* try the next icon */ }
  }
  iconCache.set(file, url);
  return url;
}

function walk(dir, out, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) walk(full, out, depth + 1);
    else if (/\.(lnk|url|appref-ms)$/i.test(e.name)) out.push(full);
  }
}

const SKIP = /(uninstall|readme|help|documentation|release notes|license|website)/i;

let cache = null;
async function listApps(force = false) {
  if (cache && !force) return cache;
  const roots = [
    path.join(process.env.ProgramData || 'C:/ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const files = [];
  roots.forEach((r) => walk(r, files));
  const seen = new Set();
  const apps = [];
  for (const f of files) {
    const name = path.basename(f).replace(/\.(lnk|url|appref-ms)$/i, '');
    if (SKIP.test(name) || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    let target = '';
    if (/\.lnk$/i.test(f)) { try { target = shell.readShortcutLink(f).target || ''; } catch (_) { target = ''; } }
    apps.push({ name, path: f, target });
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  cache = apps;
  return apps;
}

module.exports = { listApps, iconFor };
