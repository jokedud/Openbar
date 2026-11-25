'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const bluetoothStates = new Set(['on', 'off', 'no-adapter', 'denied', 'unavailable', 'unsupported', 'multiple', 'disabled']);
const operationResults = new Set(['denied', 'failed', 'unconfirmed']);

function normalizeBluetoothState(raw) {
  const status = bluetoothStates.has(raw?.status) ? raw.status : 'unavailable';
  const devices = Array.isArray(raw?.devices) ? raw.devices.flatMap((device) => {
    if (typeof device?.name !== 'string' || !device.name.trim()) return [];
    return [{ name: device.name.trim(), connected: typeof device.connected === 'boolean' ? device.connected : null }];
  }) : null;
  return { status, devices, error: operationResults.has(raw?.error) ? raw.error : null };
}

function bluetoothLayoutMigration(settings) {
  if (settings.bluetoothWidgetLayoutV1) return null;
  const patch = { bluetoothWidgetLayoutV1: true };
  if (!['left', 'center', 'right'].some((zone) => Array.isArray(settings[zone]) && settings[zone].includes('bluetooth'))) {
    patch.right = [...(Array.isArray(settings.right) ? settings.right : []), 'bluetooth'];
  }
  return patch;
}

function windowsSystemPath(...parts) {
  const directory = process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';
  return path.join(process.env.SystemRoot || 'C:\\Windows', directory, ...parts);
}

async function queryBluetooth(action) {
  if (process.platform !== 'win32') return normalizeBluetoothState({ status: 'unsupported' });
  try {
    const script = await fs.promises.readFile(path.join(__dirname, 'bluetooth.ps1'), 'utf8');
    const output = await new Promise((resolve, reject) => {
      const child = spawn(windowsSystemPath('WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-Command', '& ([ScriptBlock]::Create([Console]::In.ReadToEnd()))',
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Bluetooth query timed out')); }, 12000);
      let stdout = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stdin.on('error', reject);
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve(stdout);
        else reject(new Error('Windows Bluetooth query failed'));
      });
      child.stdin.end(`$operation = '${action}'\n${script}`, 'utf8');
    });
    return normalizeBluetoothState(JSON.parse(output));
  } catch {
    return normalizeBluetoothState({ error: action === 'read' ? null : 'failed' });
  }
}

function registerBluetoothIpc(ipcMain, shell, isActivePanel) {
  let reading, changing;
  ipcMain.handle('bluetooth:state', (event) => {
    if (!isActivePanel(event)) return null;
    if (changing) return changing;
    if (!reading) {
      const request = queryBluetooth('read').finally(() => { if (reading === request) reading = null; });
      reading = request;
    }
    return reading;
  });
  ipcMain.handle('bluetooth:toggle', (event, enabled) => {
    if (!isActivePanel(event) || typeof enabled !== 'boolean' || changing) return null;
    reading = null;
    changing = queryBluetooth(enabled ? 'on' : 'off').finally(() => { changing = null; });
    return changing;
  });
  ipcMain.handle('bluetooth:open', async (event, destination) => {
    if (!isActivePanel(event) || process.platform !== 'win32' || !['add', 'settings'].includes(destination)) return false;
    try {
      if (destination === 'add' && await shell.openPath(windowsSystemPath('DevicePairingWizard.exe')).catch(() => 'unavailable') === '') return true;
      await shell.openExternal('ms-settings:bluetooth');
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { bluetoothLayoutMigration, normalizeBluetoothState, registerBluetoothIpc };
