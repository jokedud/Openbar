'use strict';
const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

function trayLayoutMigration(settings) {
  if (settings.trayAppsLayoutV1) return null;
  const patch = { trayAppsLayoutV1: true };
  const placed = [settings.left, settings.center, settings.right].some((zone) => zone.includes('trayApps')) ||
    settings.customTabs.some((tab) => tab.items.some((item) => item.kind === 'widget' && item.widget === 'trayApps'));
  if (!placed) patch.right = [...settings.right, 'trayApps'];
  return patch;
}

function parseEntries(result, ownPid = process.pid) {
  const entries = new Map();
  for (const item of Array.isArray(result?.Items) ? result.Items.filter(Boolean) : []) {
    const { Id: id, Name: name, AppName: appName, Exe: exe, IconPng: png, OwnerPid: ownerPid } = item;
    if (typeof id !== 'string' || !/^(tray|overflow):\d{1,3}$/.test(id) ||
        typeof name !== 'string' || !name.trim() || entries.has(id)) continue;
    if (ownerPid === ownPid || /^OpenBar$/i.test(name.trim())) continue;
    const tooltipLabel = name.trim().split(/\r?\n|\s+is running\b|\s+-\s+(?=\d)/i, 1)[0].trim();
    const label = (typeof appName === 'string' && appName.trim()) || tooltipLabel || name.trim();
    entries.set(id, {
      name, label: label.slice(0, 160), inOverflow: id.startsWith('overflow:'),
      exe: typeof exe === 'string' ? exe : '',
      icon: typeof png === 'string' && png.startsWith('iVBORw0KGgo') ? `data:image/png;base64,${png}` : '',
    });
  }
  return entries;
}

async function queryTray(request, onStart) {
  const script = await readFile(path.join(__dirname, 'tray-apps.ps1'), 'utf8');
  const directory = process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', directory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const data = Buffer.from(JSON.stringify(request)).toString('base64');
  if (!onStart()) return null;
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, [
      '-NoProfile', '-NonInteractive', '-Command', '& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))',
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => child.kill(), 8000);
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error('Notification area query failed'));
      try { resolve(output.trim() ? JSON.parse(output) : null); } catch (err) { reject(err); }
    });
    child.stdin.end(`$encodedRequest = '${data}'\n${script}`, 'utf8');
  });
}

class TrayApps {
  constructor(query = queryTray, fileIcon = async () => '') {
    this.query = query;
    this.fileIcon = fileIcon;
    this.entries = new Map();
    this.busy = false;
  }

  async list(isCurrent) {
    if (this.busy) return null;
    this.busy = true;
    this.entries.clear();
    try {
      const result = await this.query({}, isCurrent);
      if (!result || !isCurrent()) return null;
      this.entries = parseEntries(result);
      return await Promise.all(Array.from(this.entries, async ([id, entry]) => ({
        id, label: entry.label, tooltip: entry.name, inOverflow: entry.inOverflow,
        icon: entry.icon || (entry.exe ? await this.fileIcon(entry.exe) : ''),
      })));
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  async activate(id, kind, onStart) {
    if (this.busy || !['open', 'menu'].includes(kind)) return false;
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.busy = true;
    this.entries.clear();
    try {
      const result = await this.query({ id, name: entry.name, right: kind === 'menu' }, onStart);
      return result?.Clicked === true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { TrayApps, parseEntries, trayLayoutMigration };
