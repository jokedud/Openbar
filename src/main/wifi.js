'use strict';

const path = require('node:path');
const { promisify } = require('node:util');

const RADIO_STATE = 4; // wlan_intf_opcode_radio_state
const ON = 1, OFF = 2, CONNECTED = 1;
const WIFI_SETTINGS = 'ms-settings:network-wifi';
const NETWORK_SETTINGS = 'ms-settings:network';

function bindWlan() {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = require('koffi');
    const dll = koffi.load(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wlanapi.dll'));
    const guid = koffi.struct('OpenBarWifiGuid', {
      data1: 'uint32_t', data2: 'uint16_t', data3: 'uint16_t', data4: koffi.array('uint8_t', 8),
    });
    const info = koffi.struct({ guid, description: koffi.array('char16_t', 256), state: 'uint32_t' });
    const phy = koffi.struct('OpenBarWifiPhy', { index: 'uint32_t', software: 'uint32_t', hardware: 'uint32_t' });
    const asyncCall = (signature) => promisify(dll.func(signature).async);
    const open = asyncCall('uint32_t __stdcall WlanOpenHandle(uint32_t, void *, _Out_ uint32_t *, _Out_ void **)');
    const close = asyncCall('uint32_t __stdcall WlanCloseHandle(void *, void *)');
    const enumerate = asyncCall('uint32_t __stdcall WlanEnumInterfaces(void *, void *, _Out_ void **)');
    const query = asyncCall('uint32_t __stdcall WlanQueryInterface(void *, const OpenBarWifiGuid *, uint32_t, void *, _Out_ uint32_t *, _Out_ void **, void *)');
    const set = asyncCall('uint32_t __stdcall WlanSetInterface(void *, const OpenBarWifiGuid *, uint32_t, uint32_t, const OpenBarWifiPhy *, void *)');
    const free = dll.func('void __stdcall WlanFreeMemory(void *)');
    const phySize = koffi.sizeof(phy);
    return {
      async withAdapters(use) {
        const handle = [], list = [];
        if (await open(2, null, [], handle) !== 0) return null;
        try {
          if (await enumerate(handle[0], null, list) !== 0 || !list[0]) return null;
          const count = koffi.decode(list[0], 'uint32_t');
          // WLAN_INTERFACE_INFO_LIST starts with the item count and current index.
          const interfaces = count ? koffi.decode(list[0], 8, info, count) : [];
          const adapters = [];
          for (const adapter of interfaces) {
            const size = [], data = [];
            let radios = [];
            if (await query(handle[0], adapter.guid, RADIO_STATE, null, size, data, null) === 0 && data[0]) {
              try {
                const n = size[0] >= 4 ? koffi.decode(data[0], 'uint32_t') : 0;
                if (n > 0 && n <= 64 && size[0] >= 4 + n * phySize) radios = koffi.decode(data[0], 4, phy, n);
              } finally { free(data[0]); }
            }
            adapters.push({
              connected: adapter.state === CONNECTED, radios,
              setRadio: async (radio, software) =>
                await set(handle[0], adapter.guid, RADIO_STATE, phySize, { ...radio, software }, null) === 0,
            });
          }
          return await use(adapters);
        } finally {
          if (list[0]) free(list[0]);
          await close(handle[0], null);
        }
      },
    };
  } catch (_) { return null; }
}

const unavailable = { radio: 'unavailable', connected: false, canToggle: false };
const known = (value) => value === ON || value === OFF;

function summarize(adapters) {
  if (!adapters.length) return { ...unavailable, radio: 'absent' };
  const radios = adapters.flatMap((adapter) => adapter.radios);
  const complete = adapters.every((adapter) => adapter.radios.length) &&
    radios.every(({ hardware, software }) => known(hardware) && known(software));
  const hardwareOn = radios.some(({ hardware }) => hardware === ON);
  const on = radios.some(({ hardware, software }) => hardware === ON && software === ON);
  return {
    radio: on ? 'on' : !complete ? 'unknown' : hardwareOn ? 'off' : 'blocked',
    connected: adapters.some((adapter) => adapter.connected),
    canToggle: complete && hardwareOn,
  };
}

function createWifiControls(openExternal, loadWlan = bindWlan) {
  let native;
  const withAdapters = async (use, fallback) => {
    native ??= loadWlan() || false;
    try { return (await native?.withAdapters?.(use)) ?? fallback; }
    catch (_) { return fallback; }
  };
  return {
    status: () => withAdapters(summarize, unavailable),
    setRadio: (enabled) => typeof enabled === 'boolean' && withAdapters(async (adapters) => {
      if (!summarize(adapters).canToggle) return false;
      const desired = enabled ? ON : OFF;
      let ok = true;
      for (const adapter of adapters) {
        for (const radio of adapter.radios) {
          if (radio.hardware === ON && radio.software !== desired &&
              !await adapter.setRadio(radio, desired)) ok = false;
        }
      }
      return ok;
    }, false),
    async open(target) {
      const urls = target === 'networks' ? ['ms-availablenetworks:', WIFI_SETTINGS, NETWORK_SETTINGS] :
        target === 'settings' ? [NETWORK_SETTINGS] : [];
      for (const url of urls) {
        try { await openExternal(url); return true; }
        catch (_) { /* Fall back to the next Windows surface. */ }
      }
      return false;
    },
  };
}

module.exports = { createWifiControls };
