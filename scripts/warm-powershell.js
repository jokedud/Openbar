'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// The first Windows PowerShell launch on a fresh machine pages in .NET and the cmdlet modules from a cold
// disk, which on CI runners can take longer than any probe timeout. Paying that one-time cost up front
// keeps a fixture's timed spawn measuring OpenBar's script rather than the machine's startup.
function warmPowerShell() {
  const powershell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    'Import-Module Microsoft.PowerShell.Management, Microsoft.PowerShell.Utility'], { windowsHide: true, timeout: 120000 });
}

module.exports = { warmPowerShell };
