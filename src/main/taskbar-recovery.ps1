param([Parameter(Mandatory=$true)][guid]$Id, [switch]$Register, [switch]$Resume)
$ErrorActionPreference = 'Stop'
$file = Join-Path $PSScriptRoot 'state.json'
$ready = Join-Path $PSScriptRoot "$Id.ready"
$release = Join-Path $PSScriptRoot "$Id.release"
$task = "OpenBar Taskbar Recovery $Id"

function Read-State {
  $json = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
  if ($json) {
    $state = $json | ConvertFrom-Json
    if ($state.id -eq [string]$Id) { $state }
  }
}

$state = Read-State
if (-not $state) {
  if (-not ($Register -or $Resume)) { Unregister-ScheduledTask -TaskName $task -Confirm:$false }
  return
}
if ($Register -or $Resume) {
  if ($Resume -and (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) {
    Start-ScheduledTask -TaskName $task
    return
  }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $powershell = Join-Path $PSHOME 'powershell.exe'
  $action = New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Id {1}' -f $PSCommandPath,$Id)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  if ($Register) {
    $owner = Get-Process -Id $state.pid
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot "$Id.owner"), [string]$owner.StartTime.ToFileTimeUtc())
  }
  try {
    Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  } catch {
    if (-not $Resume -or -not (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) { throw }
  }
  Start-ScheduledTask -TaskName $task
  return
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;
public static class OpenBarRecovery {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] struct APPBARDATA {
    public uint size;
    public IntPtr window;
    public uint callback, edge;
    public RECT rect;
    public IntPtr state;
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint message, ref APPBARDATA data);
  public static void RestorePersisted(bool autohide) {
    using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3", true)) {
      var bytes = key == null ? null : key.GetValue("Settings") as byte[];
      if (bytes == null || bytes.Length != 48 || BitConverter.ToInt32(bytes, 0) != 48 ||
          BitConverter.ToInt32(bytes, 4) != -2 || (bytes[8] != 2 && bytes[8] != 3)) return;
      byte state = (byte)(autohide ? 3 : 2);
      if (bytes[8] == state) return;
      bytes[8] = state;
      key.SetValue("Settings", bytes, RegistryValueKind.Binary);
      key.Flush();
    }
  }
  public static bool Restore(bool autohide) {
    IntPtr window = FindWindow("Shell_TrayWnd", null);
    if (window == IntPtr.Zero) return false;
    ShowWindow(window, 8);
    IntPtr secondary = IntPtr.Zero;
    while ((secondary = FindWindowEx(IntPtr.Zero, secondary, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) ShowWindow(secondary, 8);
    var data = new APPBARDATA {
      size = (uint)Marshal.SizeOf(typeof(APPBARDATA)), window = window, state = (IntPtr)(autohide ? 1 : 2)
    };
    SHAppBarMessage(10, ref data);
    return IsWindowVisible(window) && ((SHAppBarMessage(4, ref data).ToUInt64() & 1) != 0) == autohide;
  }
}
'@

$ownerFile = Join-Path $PSScriptRoot "$Id.owner"
$owner = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
$isOwner = $false
try {
  $isOwner = $owner -and (Test-Path -LiteralPath $ownerFile) -and
    [string]$owner.StartTime.ToFileTimeUtc() -eq [IO.File]::ReadAllText($ownerFile)
} catch [System.InvalidOperationException] {}
if ($isOwner) {
  $current = Get-Process -Id $PID
  if ($owner.SessionId -ne $current.SessionId) { return }
  [IO.File]::WriteAllText($ready, [string]$PID)
  while (!(Test-Path -LiteralPath $release) -and (Read-State) -and -not $owner.WaitForExit(1000)) {}
}

while ($state = Read-State) {
  if (($isOwner -and (Test-Path -LiteralPath $release)) -or [OpenBarRecovery]::Restore([bool]$state.autohide)) {
    [OpenBarRecovery]::RestorePersisted([bool]$state.autohide)
    Remove-Item -LiteralPath $file
    break
  }
  Start-Sleep -Seconds 1
}
Remove-Item -LiteralPath $ready,$ownerFile,$release -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $task -Confirm:$false
