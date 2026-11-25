'use strict';
// Thin Win32 bindings (via koffi, no native compile step) used by the dock.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const shell32 = koffi.load('shell32.dll');
const dwmapi = koffi.load('dwmapi.dll');
const gdi32 = koffi.load('gdi32.dll');
const advapi32 = koffi.load('advapi32.dll');

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const SIZE = koffi.struct('SIZE', { cx: 'long', cy: 'long' });
const DWM_THUMBNAIL_PROPERTIES = koffi.struct('DWM_THUMBNAIL_PROPERTIES', {
  dwFlags: 'uint32',
  rcDestination: RECT,
  rcSource: RECT,
  opacity: 'uint8',
  fVisible: 'int',
  fSourceClientAreaOnly: 'int',
});
const APPBARDATA = koffi.struct('APPBARDATA', {
  cbSize: 'uint32',
  hWnd: 'intptr_t',
  uCallbackMessage: 'uint32',
  uEdge: 'uint32',
  rc: RECT,
  lParam: 'intptr_t',
});

const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');

const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)');
const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hWnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hWnd)');
const IsZoomed = user32.func('bool __stdcall IsZoomed(intptr_t hWnd)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(intptr_t hWnd, _Out_ uint8_t *buf, int max)');
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(intptr_t hWnd)');
const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int idx)');
const GetWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t cmd)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *pid)');
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int cmd)');
const ShowWindowAsync = user32.func('bool __stdcall ShowWindowAsync(intptr_t hWnd, int cmd)');
const FindWindowW = user32.func('intptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *name)');
const FindWindowExW = user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const char16_t *cls, const char16_t *name)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr_t hWnd, _Out_ uint8_t *buf, int max)');
const PostMessageW = user32.func('bool __stdcall PostMessageW(intptr_t hWnd, uint32_t msg, uintptr_t wp, intptr_t lp)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
const LockWorkStation = user32.func('bool __stdcall LockWorkStation()');
const AllowSetForegroundWindow = user32.func('bool __stdcall AllowSetForegroundWindow(uint32_t pid)');

const OpenProcess = kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t h)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, _Out_ uint8_t *buf, _Inout_ uint32_t *size)');

const SHAppBarMessage = shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ APPBARDATA *data)');
const DwmGetWindowAttribute = dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr_t hWnd, uint32_t attr, _Out_ uint32_t *val, uint32_t size)');
const DwmRegisterThumbnail = dwmapi.func('long __stdcall DwmRegisterThumbnail(intptr_t dest, intptr_t src, _Out_ intptr_t *id)');
const DwmUnregisterThumbnail = dwmapi.func('long __stdcall DwmUnregisterThumbnail(intptr_t id)');
const DwmQueryThumbnailSourceSize = dwmapi.func('long __stdcall DwmQueryThumbnailSourceSize(intptr_t id, _Out_ SIZE *size)');
const DwmUpdateThumbnailProperties = dwmapi.func('long __stdcall DwmUpdateThumbnailProperties(intptr_t id, DWM_THUMBNAIL_PROPERTIES *props)');
const RegGetValueW = advapi32.func('long __stdcall RegGetValueW(intptr_t key, const char16_t *subKey, const char16_t *value, uint32_t flags, void *type, void *data, _Out_ uint32_t *size)');

// Native glass: an accent blur behind the window, clipped to a rounded region.
const ACCENT_POLICY = koffi.struct('ACCENT_POLICY', { state: 'int', flags: 'int', color: 'uint32', animation: 'int' });
const WINCOMPATTRDATA = koffi.struct('WINCOMPATTRDATA', { attribute: 'int', data: 'void *', size: 'size_t' });
const SetWindowCompositionAttribute = user32.func('bool __stdcall SetWindowCompositionAttribute(intptr_t hWnd, WINCOMPATTRDATA *data)');
const SetWindowRgn = user32.func('int __stdcall SetWindowRgn(intptr_t hWnd, intptr_t rgn, bool redraw)');
const CreateRoundRectRgn = gdi32.func('intptr_t __stdcall CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h)');

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const WS_EX_NOACTIVATE = 0x8000000;
const GW_OWNER = 4;
const DWMWA_CLOAKED = 14;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SW_HIDE = 0, SW_MAXIMIZE = 3, SW_SHOWNA = 8, SW_RESTORE = 9, SW_MINIMIZE = 6, SW_SHOW = 5;
const DWM_TNP_RECTDESTINATION = 0x1;
const DWM_TNP_OPACITY = 0x4;
const DWM_TNP_VISIBLE = 0x8;
const DWM_TNP_SOURCECLIENTAREAONLY = 0x10;
const WM_CLOSE = 0x10;
const HKEY_CURRENT_USER = -0x7fffffff;
const RRF_RT_ANY = 0xffff;
const ERROR_FILE_NOT_FOUND = 2;

const ABM = { NEW: 0, REMOVE: 1, QUERYPOS: 2, SETPOS: 3, GETSTATE: 4, GETTASKBARPOS: 5, SETSTATE: 10 };
const ABE = { left: 0, top: 1, right: 2, bottom: 3 };
const ABS_AUTOHIDE = 1, ABS_ALWAYSONTOP = 2;

function readW(buf, chars) {
  return buf.subarray(0, chars * 2).toString('utf16le');
}

function windowText(hwnd) {
  const len = GetWindowTextLengthW(hwnd);
  if (len <= 0) return '';
  const buf = Buffer.alloc((len + 1) * 2);
  const n = GetWindowTextW(hwnd, buf, len + 1);
  return readW(buf, n);
}

function className(hwnd) {
  const buf = Buffer.alloc(512);
  const n = GetClassNameW(hwnd, buf, 256);
  return readW(buf, n);
}

function processId(hwnd) {
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

function processPath(pid) {
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return '';
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return '';
    return readW(buf, size[0]);
  } finally {
    CloseHandle(h);
  }
}

function isCloaked(hwnd) {
  const v = [0];
  return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, v, 4) === 0 && v[0] !== 0;
}

const IGNORED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow']);

// Windows that would normally get a taskbar button.
function listTaskbarWindows(excludePids = new Set()) {
  const out = [];
  EnumWindows((hwnd) => {
    try {
      if (!IsWindowVisible(hwnd)) return true;
      const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      const owner = GetWindow(hwnd, GW_OWNER);
      const appWin = (ex & WS_EX_APPWINDOW) !== 0;
      if (!appWin && (owner || (ex & WS_EX_TOOLWINDOW) || (ex & WS_EX_NOACTIVATE))) return true;
      if (isCloaked(hwnd)) return true;
      const title = windowText(hwnd);
      if (!title) return true;
      const cls = className(hwnd);
      if (IGNORED_CLASSES.has(cls)) return true;
      const pid = processId(hwnd);
      if (excludePids.has(pid)) return true;
      out.push({ hwnd: Number(hwnd), title, pid, cls, minimized: IsIconic(hwnd), maximized: typeof IsZoomed === 'function' ? IsZoomed(hwnd) : false });
    } catch (_) { /* keep enumerating */ }
    return true;
  }, 0);
  return out;
}

function focusWindow(hwnd, { restore = true } = {}) {
  if (restore && IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  if (SetForegroundWindow(hwnd)) return true;
  // Synthesising an ALT tap lifts the foreground lock when we are not the active process.
  keybd_event(0x12, 0, 0, 0);
  keybd_event(0x12, 0, 2, 0);
  return SetForegroundWindow(hwnd);
}

function minimizeWindow(hwnd) { return ShowWindowAsync(hwnd, SW_MINIMIZE); }
function maximizeWindow(hwnd) { return ShowWindowAsync(hwnd, SW_MAXIMIZE); }
function restoreWindow(hwnd) { return ShowWindowAsync(hwnd, SW_RESTORE); }
function isWindowMaximized(hwnd) { return typeof IsZoomed === 'function' ? IsZoomed(hwnd) : false; }
function closeWindow(hwnd) { return PostMessageW(hwnd, WM_CLOSE, 0, 0); }

// ---- DWM live window thumbnails ----
function registerThumbnail(destHwnd, srcHwnd) {
  if (!destHwnd || !srcHwnd) return 0;
  const id = [0];
  return DwmRegisterThumbnail(destHwnd, srcHwnd, id) === 0 ? Number(id[0]) : 0;
}

function unregisterThumbnail(thumbId) {
  if (!thumbId) return false;
  return DwmUnregisterThumbnail(thumbId) === 0;
}

function queryThumbnailSourceSize(thumbId) {
  if (!thumbId) return null;
  const size = { cx: 0, cy: 0 };
  if (DwmQueryThumbnailSourceSize(thumbId, size) !== 0 || size.cx <= 0 || size.cy <= 0) return null;
  return { width: size.cx, height: size.cy };
}

function updateThumbnail(thumbId, { left, top, right, bottom, opacity = 255, visible = true, clientAreaOnly = false }) {
  if (!thumbId) return false;
  const props = {
    dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_OPACITY | DWM_TNP_VISIBLE | DWM_TNP_SOURCECLIENTAREAONLY,
    rcDestination: { left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) },
    rcSource: { left: 0, top: 0, right: 0, bottom: 0 },
    opacity: Math.max(0, Math.min(255, Math.round(opacity))),
    fVisible: visible ? 1 : 0,
    fSourceClientAreaOnly: clientAreaOnly ? 1 : 0,
  };
  return DwmUpdateThumbnailProperties(thumbId, props) === 0;
}
function foregroundWindow() { return Number(GetForegroundWindow()); }
function foregroundWindowBounds(excludePid) {
  const hwnd = foregroundWindow();
  if (!hwnd || !IsWindowVisible(hwnd) || IsIconic(hwnd) || isCloaked(hwnd) ||
    processId(hwnd) === excludePid || IGNORED_CLASSES.has(className(hwnd))) return null;
  const rect = {};
  if (!GetWindowRect(hwnd, rect)) return null;
  return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

// ---- media / system keys ----
function sendCombo(vks) {
  for (const k of vks) keybd_event(k, 0, 0, 0);
  for (const k of [...vks].reverse()) keybd_event(k, 0, 2, 0);
}

// ---- Windows taskbar ----
function taskbarWindows() {
  const list = [];
  const main = FindWindowW('Shell_TrayWnd', null);
  if (main) list.push(Number(main));
  let after = 0;
  for (let i = 0; i < 16; i++) {
    after = Number(FindWindowExW(0, after, 'Shell_SecondaryTrayWnd', null));
    if (!after) break;
    list.push(after);
  }
  return list;
}

function newAbd(hwnd) {
  return { cbSize: koffi.sizeof(APPBARDATA), hWnd: hwnd || 0, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 };
}

function getTaskbarState() {
  const abd = newAbd(taskbarWindows()[0]);
  return Number(SHAppBarMessage(ABM.GETSTATE, abd));
}

function setTaskbarAutoHide(on) {
  const abd = newAbd(taskbarWindows()[0]);
  abd.lParam = on ? ABS_AUTOHIDE : ABS_ALWAYSONTOP;
  SHAppBarMessage(ABM.SETSTATE, abd);
}

function setTaskbarVisible(visible) {
  const windows = taskbarWindows();
  for (const h of windows) {
    if (IsWindowVisible(h) !== visible) ShowWindow(h, visible ? SW_SHOWNA : SW_HIDE);
  }
  return windows.length > 0 && windows.every((h) => IsWindowVisible(h) === visible);
}

function hasTaskbar() {
  return !!FindWindowW('Shell_TrayWnd', null);
}

function taskbarVisibilityIs(visible) {
  const windows = taskbarWindows();
  return windows.length > 0 && windows.every((h) => IsWindowVisible(h) === visible);
}

// ---- AppBar registration: reserves screen space so maximised windows don't cover the dock ----
function appBarRegister(hwnd) {
  const abd = newAbd(hwnd);
  abd.uCallbackMessage = 0x8000 + 0x4F;
  return Number(SHAppBarMessage(ABM.NEW, abd)) !== 0;
}

function appBarSetPos(hwnd, edge, rect) {
  const abd = newAbd(hwnd);
  abd.uEdge = ABE[edge];
  abd.rc = Object.assign({}, rect);
  SHAppBarMessage(ABM.QUERYPOS, abd);
  const thickness = rect.bottom - rect.top;
  if (edge === 'top') abd.rc.bottom = abd.rc.top + thickness;
  else abd.rc.top = abd.rc.bottom - thickness;
  SHAppBarMessage(ABM.SETPOS, abd);
  return abd.rc;
}

function appBarRemove(hwnd) {
  SHAppBarMessage(ABM.REMOVE, newAbd(hwnd));
}

function hwndFromBuffer(buf) {
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

function isLoginItemMissing(name) {
  return RegGetValueW(HKEY_CURRENT_USER, 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', name, RRF_RT_ANY, null, null, [0]) === ERROR_FILE_NOT_FOUND;
}

const ACCENT_ENABLE_BLURBEHIND = 3;
const WCA_ACCENT_POLICY = 19;
let accentBuf = null;
// Blurs whatever is behind hWnd ('blur') or removes the blur ('off'); returns the mode Windows accepted.
// Plain blur rather than acrylic: it follows the window region, so rounded windows get no square corners.
// The tint stays in CSS, so the accent colour is near-transparent.
function setBackdrop(hWnd, mode) {
  const state = mode === 'off' ? 0 : ACCENT_ENABLE_BLURBEHIND;
  accentBuf = accentBuf || koffi.alloc(ACCENT_POLICY, 1);
  koffi.encode(accentBuf, ACCENT_POLICY, { state, flags: 0, color: 0x01000000, animation: 0 });
  const ok = SetWindowCompositionAttribute(hWnd, { attribute: WCA_ACCENT_POLICY, data: accentBuf, size: koffi.sizeof(ACCENT_POLICY) });
  return ok && state ? 'blur' : 'off';
}
function setRoundRegion(hWnd, { width, height, radius }) {
  SetWindowRgn(hWnd, CreateRoundRectRgn(0, 0, width, height, 2 * radius, 2 * radius), true);
}

module.exports = {
  listTaskbarWindows, focusWindow, minimizeWindow, maximizeWindow, restoreWindow, isWindowMaximized, closeWindow,
  registerThumbnail, unregisterThumbnail, queryThumbnailSourceSize, updateThumbnail,
  foregroundWindow, foregroundWindowBounds, IsWindow: (h) => IsWindow(h),
  processPath, processId, sendCombo, LockWorkStation: () => LockWorkStation(), AllowSetForegroundWindow,
  getTaskbarState, setTaskbarAutoHide, setTaskbarVisible, hasTaskbar, taskbarVisibilityIs, ABS_AUTOHIDE,
  appBarRegister, appBarSetPos, appBarRemove, hwndFromBuffer, setBackdrop, setRoundRegion,
  isLoginItemMissing,
};
