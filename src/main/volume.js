'use strict';

const NO_OUTPUT = 0x80070490 | 0; // HRESULT_FROM_WIN32(ERROR_NOT_FOUND)
const UNAVAILABLE = Object.freeze({ status: 'unavailable' });

function volumeChange(action, value) {
  if (action === 'volume' && typeof value === 'number' && Number.isFinite(value)) {
    return { volume: Math.min(100, Math.max(0, Math.round(value))) };
  }
  if (action === 'mute' && typeof value === 'boolean') return { muted: value };
  return null;
}

function guid(a, b, c, tail) {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(a);
  bytes.writeUInt16LE(b, 4);
  bytes.writeUInt16LE(c, 6);
  Buffer.from(tail, 'hex').copy(bytes, 8);
  return bytes;
}

function createVolume(koffi) {
  const ole32 = koffi.load('ole32.dll');
  const initialize = ole32.func('long __stdcall CoInitializeEx(void *reserved, uint32 flags)');
  const uninitialize = ole32.func('void __stdcall CoUninitialize()');
  const create = ole32.func('long __stdcall CoCreateInstance(const void *clsid, void *outer, uint32 context, const void *iid, _Out_ void **instance)');
  const proto = koffi.proto;
  const release = proto('uint32 __stdcall OpenBarVolumeRelease(void *self)');
  const getDefault = proto('long __stdcall OpenBarVolumeDefault(void *self, int flow, int role, _Out_ void **device)');
  const activate = proto('long __stdcall OpenBarVolumeActivate(void *self, const void *iid, uint32 context, void *parameters, _Out_ void **endpoint)');
  const setScalar = proto('long __stdcall OpenBarVolumeSetScalar(void *self, float scalar, void *eventContext)');
  const getScalar = proto('long __stdcall OpenBarVolumeGetScalar(void *self, _Out_ float *scalar)');
  const setMute = proto('long __stdcall OpenBarVolumeSetMute(void *self, int mute, void *eventContext)');
  const getMute = proto('long __stdcall OpenBarVolumeGetMute(void *self, _Out_ int *mute)');
  const enumeratorClass = guid(0xbcde0395, 0xe52f, 0x467c, '8e3dc4579291692e');
  const enumeratorInterface = guid(0xa95664d2, 0x9614, 0x4f35, 'a746de8db63617e6');
  const volumeInterface = guid(0x5cdf2c82, 0x841e, 0x4546, '9722cf74078229be');
  const pointerSize = koffi.sizeof('void *');
  const inProcess = 1;
  const call = (self, slot, type, ...args) => {
    const table = koffi.decode(self, 'void *');
    return koffi.call(koffi.decode(table, slot * pointerSize, 'void *'), type, self, ...args);
  };

  return (change) => {
    const hr = initialize(null, 2); // COINIT_APARTMENTTHREADED
    if (hr < 0 && hr !== (0x80010106 | 0)) return UNAVAILABLE; // Already initialized in a different apartment
    const enumerator = [null], device = [null], endpoint = [null];
    try {
      if (create(enumeratorClass, null, inProcess, enumeratorInterface, enumerator) < 0) return UNAVAILABLE;
      const found = call(enumerator[0], 4, getDefault, 0, 1, device); // eRender, eMultimedia
      if (found === NO_OUTPUT) return { status: 'no-output' };
      if (found < 0 || call(device[0], 3, activate, volumeInterface, inProcess, null, endpoint) < 0) return UNAVAILABLE;
      const output = endpoint[0];
      // IAudioEndpointVolume vtable: Set/GetMasterVolumeLevelScalar and Set/GetMute.
      if (change && 'volume' in change && call(output, 7, setScalar, change.volume / 100, null) < 0) return UNAVAILABLE;
      if (change && 'muted' in change && call(output, 14, setMute, +change.muted, null) < 0) return UNAVAILABLE;
      const level = [0], muted = [0];
      if (call(output, 9, getScalar, level) < 0 || call(output, 15, getMute, muted) < 0 || !Number.isFinite(level[0])) return UNAVAILABLE;
      return { status: 'ready', volume: Math.round(level[0] * 100), muted: Boolean(muted[0]) };
    } finally {
      try {
        for (const pointer of [endpoint[0], device[0], enumerator[0]]) if (pointer) call(pointer, 2, release);
      } finally {
        if (hr >= 0) uninitialize();
      }
    }
  };
}

module.exports = { createVolume, volumeChange, UNAVAILABLE };
