'use strict';
const { execFile } = require('node:child_process');
const { release } = require('node:os');
const path = require('node:path');

const MODES = new Map([
  ['efficiency', guid('961cc777-2547-4f9d-8174-7d86181b8a7a')],
  ['balanced', guid('00000000-0000-0000-0000-000000000000')],
  ['performance', guid('ded574b5-45a0-4f42-8737-46345c09c238')],
]);
const BALANCED_PERSONALITY = guid('381b4222-f694-41f0-9685-ff5bb260df2e');
const SCHEME_PERSONALITY = guid('245d8541-3943-4422-b025-13a784f679b7');
const REG_BINARY = 3;
const ENERGY_SAVER_STATUS = guid('550e8400-e29b-41d4-a716-446655440000');
const WM_POWERBROADCAST = 0x0218;
const PBT_POWERSETTINGCHANGE = 0x8013;
const UNKNOWN_TIME = 0xffffffff;
const SYSTEM32 = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

function guid(id) {
  const [a, b, c, d, e] = id.split('-');
  const value = Buffer.from(a + b + c + d + e, 'hex');
  return Buffer.concat([value.subarray(0, 4).reverse(), value.subarray(4, 6).reverse(),
    value.subarray(6, 8).reverse(), value.subarray(8)]);
}

function decodeStatus(raw, energySaver) {
  const ac = raw?.[0], flags = raw?.[1], percent = raw?.[2], saver = raw?.[3];
  const pluggedIn = ac === 1 ? true : ac === 0 ? false : null;
  const present = flags == null || flags === 255 ? null : !(flags & 128);
  const level = present !== false && percent <= 100 ? percent : null;
  const charging = present === null ? null : present && !!(flags & 8);
  const lifetime = pluggedIn === false && present === true && !charging ? raw.readUInt32LE(4) : null;
  return {
    present, pluggedIn, level, charging,
    remaining: lifetime > 0 && lifetime !== UNKNOWN_TIME ? lifetime : null,
    saver: energySaver ?? (saver === 1 ? true : present === true && saver === 0 ? false : null),
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
  const build = Number(release().split('.')[2]);
  let energySaver;
  let getActual, setActive, getPlan, readPlanValue, free;
  if (build >= 22000) {
    try {
      const power = koffi.load('powrprof.dll');
      getActual = power.func('uint32 __stdcall PowerGetActualOverlayScheme(_Out_ uint8_t *guid)');
      setActive = power.func('uint32 __stdcall PowerSetActiveOverlayScheme(const uint8_t *guid)');
      getPlan = power.func('uint32 __stdcall PowerGetActiveScheme(void *root, _Out_ void **guid)');
      readPlanValue = power.func('uint32 __stdcall PowerReadACValue(void *root, const void *scheme, const void *subgroup, const uint8_t *setting, _Out_ uint32 *type, _Out_ uint8_t *value, _Inout_ uint32 *size)');
      free = kernel.func('void * __stdcall LocalFree(void *ptr)');
    } catch { /* Overlay APIs aren't exported on every Windows installation. */ }
  }

  function read() {
    const raw = Buffer.alloc(12);
    return decodeStatus(getStatus(raw) ? raw : null, energySaver);
  }

  function watchSaver(window, hwnd, onChange) {
    if (build < 26100 || !hwnd) return () => {};
    const user = koffi.load('user32.dll');
    const register = user.func('void * __stdcall RegisterPowerSettingNotification(intptr_t window, const uint8_t *setting, uint32 flags)');
    const unregister = user.func('int __stdcall UnregisterPowerSettingNotification(void *handle)');
    window.hookWindowMessage(WM_POWERBROADCAST, (wParam, lParam) => {
      if (Number(koffi.decode(wParam, 'uintptr_t')) !== PBT_POWERSETTINGCHANGE) return;
      const setting = koffi.decode(lParam, 'void *');
      if (!setting) return;
      const header = Buffer.from(koffi.decode(setting, 'uint8_t', 20));
      if (!header.subarray(0, 16).equals(ENERGY_SAVER_STATUS) || header.readUInt32LE(16) !== 4) return;
      const status = koffi.decode(setting, 20, 'uint32_t');
      if (status !== 0 && status !== 1 && status !== 2) return;
      const next = status !== 0;
      if (next !== energySaver) { energySaver = next; onChange(); }
    });
    const handle = register(hwnd, ENERGY_SAVER_STATUS, 0);
    if (!handle) {
      window.unhookWindowMessage(WM_POWERBROADCAST);
      return () => {};
    }
    return () => {
      unregister(handle);
      if (!window.isDestroyed()) window.unhookWindowMessage(WM_POWERBROADCAST);
    };
  }

  function mode() {
    if (!getActual || !setActive || !getPlan || !readPlanValue || !free) return null;
    const plan = [null];
    if (getPlan(null, plan) !== 0 || !plan[0]) return null;
    try {
      const personality = Buffer.alloc(16), type = [0], size = [personality.length];
      if (readPlanValue(null, plan[0], null, SCHEME_PERSONALITY, type, personality, size) !== 0 ||
          type[0] !== REG_BINARY || size[0] !== personality.length || !personality.equals(BALANCED_PERSONALITY)) return null;
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

  return { read, mode, setMode, chargeTime, watchSaver };
}

module.exports = { createBattery, decodeStatus, estimateChargeTime, openPowerSettings };
