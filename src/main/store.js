'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_SETTINGS = {
  position: 'bottom',          // bottom | top
  layout: 'full',              // full | pill
  style: 'glass',              // glass | midnight | white | black | ios
  height: 46,
  margin: 6,
  reserveSpace: true,          // register as an AppBar so maximised windows don't cover the dock
  taskbar: 'hide',             // hide | autohide | keep
  launchAtLogin: false,
  showLabels: false,
  groupWindows: true,
  sounds: false,
  left: ['start', 'apps'],
  center: [],
  right: ['media', 'weather', 'system', 'network', 'battery', 'pomodoro', 'todos', 'nextEvent', 'clock', 'quick'],
  pinned: [],                  // [{ name, path, args }]
  weather: { city: '', lat: null, lon: null, units: 'celsius' },
  calendars: [],               // [{ name, url }]
  github: { user: '', token: '' },
  crypto: { coins: ['bitcoin', 'ethereum'], currency: 'usd' },
  worldClocks: ['America/New_York', 'Europe/London', 'Asia/Tokyo'],
  commands: [],                // [{ id, label, command, intervalSec }]
  pomodoro: { focusMin: 25, breakMin: 5 },
  automations: {
    pauseMusicBeforeMeetings: true,
    pauseMinutesBefore: 1,
    meetingReminders: true,
    reminderMinutesBefore: 5,
    umbrellaReminder: true,
    pauseMusicOnPomodoro: false,
    highCpuAlert: false,
    lowDiskAlert: true,
  },
};

const DEFAULT_DATA = {
  todos: [],
  notes: '',
  screenTime: {},              // { 'YYYY-MM-DD': { 'chrome.exe': seconds } }
  pomodoro: { phase: 'idle', endsAt: 0, remainingMs: 0, completedToday: 0, day: '' },
  taskbarRestore: null,        // what to restore if we crashed while changing the taskbar
};

function deepMerge(base, over) {
  if (over === null || Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || base === null) {
    return over === undefined ? base : over;
  }
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = deepMerge(base[k], over[k]);
  return out;
}

class JsonFile {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), name);
    this.defaults = defaults;
    this.value = defaults;
    try {
      this.value = deepMerge(defaults, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (_) { /* first run */ }
    this.timer = null;
  }
  get() { return this.value; }
  set(patch) {
    this.value = deepMerge(this.value, patch);
    this.save();
    return this.value;
  }
  replace(v) { this.value = deepMerge(this.defaults, v); this.save(); return this.value; }
  save(now = false) {
    clearTimeout(this.timer);
    const write = () => {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.value, null, 2));
      fs.renameSync(tmp, this.file);
    };
    if (now) write(); else this.timer = setTimeout(write, 300);
  }
}

module.exports = { JsonFile, DEFAULT_SETTINGS, DEFAULT_DATA, deepMerge };
