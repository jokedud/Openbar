'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');

class TaskbarRecovery {
  constructor(profile) {
    this.folder = path.join(profile, 'taskbar-recovery');
    this.file = path.join(this.folder, 'state.json');
    this.id = randomUUID();
    this.starting = false;
    this.failed = false;
    this.armed = false;
  }

  pending() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; return null; }
  }

  arm(autohide) {
    const state = this.pending();
    if (state && state.id !== this.id) return false;
    if (this.failed) return false;
    if (this.releasing) {
      if (state) return false;
      this.reset();
    }
    if (!state) {
      if (this.starting) return false;
      const script = path.join(this.folder, 'recover.ps1');
      fs.mkdirSync(this.folder, { recursive: true });
      fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'taskbar-recovery.ps1')), { flush: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ id: this.id, pid: process.pid, autohide }), { flush: true });
      fs.renameSync(tmp, this.file);
      this.starting = true;
      const id = this.id;
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Id', id, '-Register'], { windowsHide: true, timeout: 30000 }, (err) => {
        if (!err || this.id !== id || this.armed || this.ready()) return;
        this.failed = true;
        console.error('Could not start Windows taskbar recovery:', err.message);
        try { this.restored(); } catch (error) { console.error(error); }
      });
    }
    const ready = this.ready();
    this.armed ||= ready;
    return ready;
  }

  ready() {
    try {
      const pid = Number(fs.readFileSync(path.join(this.folder, this.id + '.ready'), 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) return false;
      process.kill(pid, 0);
      return true;
    } catch (_) { return false; }
  }

  reset() {
    this.id = randomUUID();
    this.starting = false;
    this.armed = false;
    this.releasing = false;
  }

  restored() {
    if (this.pending()?.id !== this.id) return;
    if (!this.releasing && (this.armed || this.ready())) {
      fs.writeFileSync(path.join(this.folder, this.id + '.release'), '');
      this.releasing = true;
      return;
    }
    if (this.releasing) return;
    fs.unlinkSync(this.file);
    this.reset();
  }
}

module.exports = TaskbarRecovery;
