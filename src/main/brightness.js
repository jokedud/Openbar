'use strict';
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execute = promisify(execFile);
const SETTINGS = new Map([
  ['display', 'ms-settings:display'],
  ['nightlight', 'ms-settings:nightlight'],
]);
const unavailable = { level: null, levels: [], failed: false };
const isPercent = (value) => Number.isInteger(value) && value >= 0 && value <= 100;

const probe = `
$ErrorActionPreference = 'Stop'
$result = @{ level = $null; levels = @(); failed = $false }
try {
  $monitor = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness |
    Where-Object Active | Select-Object -First 1
  if ($null -ne $monitor) {
    $result.level = [int]$monitor.CurrentBrightness
    $result.levels = @($monitor.Level)
    $method = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods |
      Where-Object { $_.Active -and $_.InstanceName -eq $monitor.InstanceName } | Select-Object -First 1
    if ($null -eq $method) { $result.level = $null }
    elseif ($null -ne $requested) {
      try {
        $nearest = $monitor.Level | Sort-Object { [Math]::Abs([int]$_ - $requested) } | Select-Object -First 1
        if ($null -eq $nearest) { $nearest = $requested }
        $response = Invoke-CimMethod -InputObject $method -MethodName WmiSetBrightness -Arguments @{
          Timeout = [uint32]0; Brightness = [byte]$nearest
        }
        if ($response.ReturnValue -ne 0) { throw 'Brightness change was rejected' }
        $actual = Get-CimInstance -InputObject $monitor
        if ($null -eq $actual) { throw 'Display disconnected' }
        $result.level = [int]$actual.CurrentBrightness
      } catch { $result.failed = $true }
    }
  }
} catch { $result.level = $null }
$result | ConvertTo-Json -Compress
`;

async function runBrightness(level, run = execute) {
  if (level !== undefined && !Number.isFinite(level)) return { ...unavailable, failed: true };
  const requested = level === undefined ? '$null' : Math.max(0, Math.min(100, Math.round(level)));
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = Buffer.from(`$requested = ${requested}\n${probe}`, 'utf16le').toString('base64');
  try {
    const { stdout } = await run(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], {
      windowsHide: true, timeout: 4500, maxBuffer: 32 * 1024,
    });
    const { level: actual, levels, failed } = JSON.parse(stdout);
    if (isPercent(actual)) return {
      level: actual,
      levels: Array.isArray(levels) ? [...new Set(levels.filter(isPercent))].sort((a, b) => a - b) : [],
      failed: failed === true,
    };
  } catch (_) { /* A missing provider or timed-out request must not look like a working display. */ }
  return level === undefined ? unavailable : { ...unavailable, failed: true };
}

function registerBrightnessIpc(ipcMain, shell, isCurrent, isWin) {
  let queue = Promise.resolve();
  function enqueue(event, level) {
    if (!isWin || !isCurrent(event)) return unavailable;
    const result = queue.then(() => isCurrent(event) ? runBrightness(level) : unavailable);
    queue = result;
    return result;
  }
  ipcMain.handle('brightness:get', (event) => enqueue(event));
  ipcMain.handle('brightness:set', (event, level) =>
    Number.isFinite(level) ? enqueue(event, level) : { ...unavailable, failed: true });
  ipcMain.handle('brightness:settings', async (event, page) => {
    const uri = SETTINGS.get(page);
    if (!isWin || !isCurrent(event) || !uri) return false;
    try { await shell.openExternal(uri); return true; } catch (_) { return false; }
  });
}

module.exports = { registerBrightnessIpc, runBrightness };
