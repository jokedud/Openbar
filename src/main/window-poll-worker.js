'use strict';
const { parentPort } = require('node:worker_threads');
const { foregroundWindow, listTaskbarWindows, processPath } = require('./win32');

const paths = new Map();
parentPort.on('message', (excludePids) => {
  try {
    const windows = listTaskbarWindows(new Set(excludePids));
    const pids = new Set(windows.map((w) => w.pid));
    for (const pid of paths.keys()) if (!pids.has(pid)) paths.delete(pid);
    for (const w of windows) {
      if (!paths.has(w.pid)) paths.set(w.pid, processPath(w.pid));
      w.path = paths.get(w.pid);
    }
    parentPort.postMessage({ windows, active: foregroundWindow() });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
