'use strict';
const { nativeImage } = require('electron');
const koffi = require('koffi');

const shell32 = koffi.load('shell32.dll');
const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const SHFILEINFO = koffi.struct('SHFILEINFOW', {
  icon: 'void *', index: 'int', attributes: 'uint32', displayName: 'uint16[260]', typeName: 'uint16[80]',
});
const BITMAPINFOHEADER = koffi.struct('ICON_BITMAPINFOHEADER', {
  size: 'uint32', width: 'int32', height: 'int32', planes: 'uint16', bits: 'uint16',
  compression: 'uint32', imageSize: 'uint32', xResolution: 'int32', yResolution: 'int32',
  colorsUsed: 'uint32', colorsImportant: 'uint32',
});

const SHGetFileInfo = shell32.func('uintptr_t __stdcall SHGetFileInfoW(str16 path, uint32 attributes, _Out_ SHFILEINFOW *info, uint32 size, uint32 flags)');
const DrawIconEx = user32.func('bool __stdcall DrawIconEx(void *dc, int x, int y, void *icon, int width, int height, uint32 step, void *brush, uint32 flags)');
const DestroyIcon = user32.func('bool __stdcall DestroyIcon(void *icon)');
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *dc)');
const CreateDIBSection = gdi32.func('void * __stdcall CreateDIBSection(void *dc, ICON_BITMAPINFOHEADER *info, uint32 usage, _Out_ void **bits, void *section, uint32 offset)');
const SelectObject = gdi32.func('void * __stdcall SelectObject(void *dc, void *object)');
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(void *object)');
const DeleteDC = gdi32.func('bool __stdcall DeleteDC(void *dc)');
const PatBlt = gdi32.func('bool __stdcall PatBlt(void *dc, int x, int y, int width, int height, uint32 operation)');
const GdiFlush = gdi32.func('bool __stdcall GdiFlush()');

const SHGFI_ICON = 0x100;
const DI_NORMAL = 3;
const BLACKNESS = 0x00000042;
const WHITENESS = 0x00ff0062;
const size = 32;

function toDataURL(icon) {
  const dc = CreateCompatibleDC(null);
  if (!dc) return '';
  let bitmap, old;
  try {
    const bits = [null];
    const info = {
      size: koffi.sizeof(BITMAPINFOHEADER), width: size, height: -size, planes: 1, bits: 32,
      compression: 0, imageSize: 0, xResolution: 0, yResolution: 0, colorsUsed: 0, colorsImportant: 0,
    };
    bitmap = CreateDIBSection(dc, info, 0, bits, null, 0);
    if (!bitmap) return '';
    old = SelectObject(dc, bitmap);
    if (!old) return '';
    if (!PatBlt(dc, 0, 0, size, size, BLACKNESS)) return '';
    if (!DrawIconEx(dc, 0, 0, icon, size, size, 0, null, DI_NORMAL)) return '';
    GdiFlush();
    const black = Buffer.from(koffi.decode(bits[0], 'uint8_t', size * size * 4));
    if (!PatBlt(dc, 0, 0, size, size, WHITENESS)) return '';
    if (!DrawIconEx(dc, 0, 0, icon, size, size, 0, null, DI_NORMAL)) return '';
    GdiFlush();
    const pixels = koffi.decode(bits[0], 'uint8_t', black.length);
    // Recover alpha from the two backgrounds, including for legacy mask-only icons.
    for (let i = 0; i < pixels.length; i += 4) {
      black[i + 3] = 255 - Math.max(0, pixels[i] - black[i], pixels[i + 1] - black[i + 1], pixels[i + 2] - black[i + 2]);
    }
    return nativeImage.createFromBitmap(black, { width: size, height: size }).toDataURL();
  } finally {
    if (old) SelectObject(dc, old);
    if (bitmap) DeleteObject(bitmap);
    DeleteDC(dc);
  }
}

function shortcutIcon(file) {
  const info = {};
  if (!SHGetFileInfo(file, 0, info, koffi.sizeof(SHFILEINFO), SHGFI_ICON) || !info.icon) return '';
  try {
    return toDataURL(info.icon);
  } finally {
    DestroyIcon(info.icon);
  }
}

module.exports = { shortcutIcon };
