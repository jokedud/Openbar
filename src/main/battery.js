'use strict';
const { execFile } = require('node:child_process');
const { release } = require('node:os');
const path = require('node:path');

const MODES = new Map([
  ['efficiency', guid('961cc777-2547-4f9d-8174-7d86181b8a7a')],
  ['balanced', guid('00000000-0000-0000-0000-000000000000')],
  ['performance', guid('ded574b5-45a0-4f42-8737-46345c09c238')],
]);
const BALANCED_PLAN = guid('381b4222-f694-41f0-9685-ff5bb260df2e');
const UNKNOWN_TIME = 0xffffffff;
const SYSTEM32 = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

function guid(id) {
  const [a, b, c, d, e] = id.split('-');
  const value = Buffer.from(a + b + c + d + e, 'hex');
  return Buffer.concat([value.subarray(0, 4).reverse(), value.subarray(4, 6).reverse(),
    value.subarray(6, 8).reverse(), value.subarray(8)]);
}

function decodeStatus(raw) {
  const ac = raw?.[0], flags = raw?.[1], percent = raw?.[2], saver = raw?.[3];
  const pluggedIn = ac === 1 ? true : ac === 0 ? false : null;
  const present = flags == null || flags === 255 ? null : !(flags & 128);
  const level = present !== false && percent <= 100 ? percent : null;
  const charging = present === null ? null : present && !!(flags & 8);
  const lifetime = pluggedIn === false && present === true && !charging ? raw.readUInt32LE(4) : null;
  return {
    present, pluggedIn, level, charging,
    remaining: lifetime > 0 && lifetime !== UNKNOWN_TIME ? lifetime : null,
    saver: saver === 1 ? true : present === true && saver === 0 ? false : null,
    low: present === true && !charging && pluggedIn === false && ((level != null && level <= 15) || !!(flags & 4)),
  };
}

function estimateChargeTime(report) {
  const { Status, FullChargeCapacityInMilliwattHours: full, RemainingCapacityInMilliwattHours: remaining,
    ChargeRateInMilliwatts: rate } = report || {};
  if (Status !== 'Charging' || ![full, remaining, rate].every(Number.isFinite) ||
      remaining < 0 || remaining >= full || rate <= 0) return null;
  return Math.ceil((full - remaining) / rate * 3600);
}

const REPORT = [
  '$ErrorActionPreference = "Stop"',
  '$battery = [Windows.Devices.Power.Battery,Windows.Devices.Power,ContentType=WindowsRuntime]::AggregateBattery',
  '$r = $battery.GetReport()',
  '$r | Select-Object FullChargeCapacityInMilliwattHours,RemainingCapacityInMilliwattHours,ChargeRateInMilliwatts,@{Name="Status";Expression={$_.Status.ToString()}} | ConvertTo-Json -Compress',
].join('; ');

function chargeTime(signal) {
  const powershell = path.win32.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-Command', REPORT],
      { signal, windowsHide: true, timeout: 5000, maxBuffer: 4096 }, (error, stdout) => {
        if (error) return resolve(null);
        try { resolve(estimateChargeTime(JSON.parse(stdout))); } catch { resolve(null); }
      });
  });
}

async function openPowerSettings(shell, target) {
  const uri = target === 'saver' ? 'ms-settings:batterysaver' : target === 'power' ? 'ms-settings:powersleep' : null;
  if (!uri) return false;
  try {
    await shell.openExternal(uri);
    return true;
  } catch {
    return new Promise((resolve) => {
      execFile(path.win32.join(SYSTEM32, 'control.exe'), [path.win32.join(SYSTEM32, 'powercfg.cpl')],
        { windowsHide: true }, (error) => resolve(!error));
    });
  }
}

function createBattery() {
  const koffi = require('koffi');
  const kernel = koffi.load('kernel32.dll');
  const getStatus = kernel.func('int __stdcall GetSystemPowerStatus(_Out_ uint8_t *status)');
  let getActual, setActive, getPlan, free;
  if (Number(release().split('.')[2]) >= 22000) {
    try {
      const power = koffi.load('powrprof.dll');
      getActual = power.func('uint32 __stdcall PowerGetActualOverlayScheme(_Out_ uint8_t *guid)');
      setActive = power.func('uint32 __stdcall PowerSetActiveOverlayScheme(const uint8_t *guid)');
      getPlan = power.func('uint32 __stdcall PowerGetActiveScheme(void *root, _Out_ void **guid)');
      free = kernel.func('void * __stdcall LocalFree(void *ptr)');
    } catch { /* Overlay APIs aren't exported on every Windows installation. */ }
  }

  function read() {
    const raw = Buffer.alloc(12);
    return decodeStatus(getStatus(raw) ? raw : null);
  }

  function mode() {
    if (!getActual || !setActive || !getPlan || !free) return null;
    const plan = [null];
    if (getPlan(null, plan) !== 0 || !plan[0]) return null;
    try {
      if (!Buffer.from(koffi.decode(plan[0], 'uint8_t', 16)).equals(BALANCED_PLAN)) return null;
    } finally { free(plan[0]); }
    const actual = Buffer.alloc(16);
    if (getActual(actual) !== 0) return null;
    for (const [name, id] of MODES) if (actual.equals(id)) return name;
    return null;
  }

  function setMode(name) {
    if (!MODES.has(name) || !mode() || read().saver === true) return false;
    return setActive(MODES.get(name)) === 0 && mode() === name;
  }

  return { read, mode, setMode, chargeTime };
}

module.exports = { createBattery, decodeStatus, estimateChargeTime, openPowerSettings };
