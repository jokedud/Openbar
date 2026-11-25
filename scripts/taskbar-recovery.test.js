'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mock, test } = require('node:test');
const { runInNewContext } = require('node:vm');

const launch = mock.method(require('node:child_process'), 'execFile', () => {});
const TaskbarRecovery = require('../src/main/taskbar-recovery');
const mainPath = path.join(__dirname, '../src/main/main.js');

function loadTaskbar(recovery, dataStore, win32) {
  const app = { requestSingleInstanceLock: () => true, setAppUserModelId() {}, on() {}, whenReady: () => ({ then() {} }) };
  return runInNewContext(fs.readFileSync(mainPath, 'utf8') + `
    taskbarRecovery = recovery;
    dataStore = store;
    settingsStore = { get: () => ({ taskbar: 'hide' }) };
    applyTaskbar;
  `, {
    __dirname: path.dirname(mainPath),
    process: { platform: 'win32', on() {} },
    require: (id) => ({ path, electron: { app }, './win32': win32 }[id] || {}),
    recovery,
    store: dataStore,
  }, { filename: mainPath });
}

test('taskbar stays unarmed until a live recovery worker acknowledges the saved baseline', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-recovery-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const recovery = new TaskbarRecovery(profile);
  assert.equal(recovery.arm(false), false);
  assert.deepEqual(recovery.pending(), { id: recovery.id, pid: process.pid, autohide: false, phase: 'prepared' });
  assert.equal(recovery.recordOverride(true), false);
  assert.equal(recovery.arm(true), false);
  assert.equal(launch.mock.callCount(), 1);

  const restart = new TaskbarRecovery(profile);
  assert.equal(restart.arm(true), false);
  restart.restored();
  fs.writeFileSync(path.join(recovery.folder, recovery.id + '.ready'), String(process.pid));
  assert.equal(recovery.arm(true), true);
  assert.equal(recovery.pending().autohide, false);
  assert.equal(recovery.pending().phase, 'prepared');
  assert.equal(recovery.recordOverride(true), true);
  assert.equal(recovery.recordOverride(false), true);
  assert.equal(recovery.pending().phase, 'applying');
  assert.equal(recovery.pending().autohide, true);
  recovery.markApplied();
  assert.equal(recovery.pending().phase, 'applied');

  recovery.restored();
  assert.equal(fs.existsSync(path.join(recovery.folder, recovery.id + '.release')), true);
  assert.equal(recovery.arm(true), false);
  assert.equal(recovery.pending().autohide, true);
  fs.unlinkSync(recovery.file);
  assert.equal(recovery.pending(), null);
  assert.equal(recovery.arm(true), false);
  assert.equal(recovery.pending().autohide, true);
});

test('migration commits the legacy baseline before replacing the old restore record', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-recovery-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const recovery = new TaskbarRecovery(profile);
  recovery.arm(false);
  fs.writeFileSync(path.join(recovery.folder, recovery.id + '.ready'), String(process.pid));
  const legacy = { autohide: false };
  const apply = loadTaskbar(recovery, {
    get: () => ({ taskbarRestore: legacy }),
    set: () => {
      assert.equal(recovery.pending().phase, 'applying');
      assert.equal(recovery.pending().autohide, legacy.autohide);
      throw new Error('interrupted migration');
    },
  }, { ABS_AUTOHIDE: 1, hasTaskbar: () => true, getTaskbarState: () => 1, taskbarVisibilityIs: () => true });
  assert.throws(apply, /interrupted migration/);
});

test('the recovery worker discards a prepared journal without restoring Windows settings', { skip: process.platform !== 'win32' }, (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-recovery-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const recovery = new TaskbarRecovery(profile);
  assert.equal(recovery.arm(false), false);
  fs.writeFileSync(path.join(recovery.folder, recovery.id + '.ready'), String(process.pid));
  const result = spawnSync(launch.mock.calls.at(-1).arguments[0], [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    "function Add-Type {} ; function Unregister-ScheduledTask {} ; & './recover.ps1' -Id " + recovery.id,
  ], { cwd: recovery.folder, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  assert.equal(recovery.pending(), null);
});

test('a relaunch resumes an interrupted registration before arming a new worker', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-recovery-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const interrupted = new TaskbarRecovery(profile);
  assert.equal(interrupted.arm(false), false);
  const stale = interrupted.pending();
  assert.equal(stale.phase, 'prepared');
  const restart = new TaskbarRecovery(profile);
  const calls = launch.mock.callCount();

  restart.resume(stale);
  restart.resume(stale);
  assert.equal(restart.arm(true), false);
  assert.equal(launch.mock.callCount(), calls + 1);
  assert.deepEqual(launch.mock.calls[calls].arguments[1].slice(-3), ['-Id', stale.id, '-Resume']);
  assert.deepEqual(restart.pending(), stale);

  fs.unlinkSync(interrupted.file);
  assert.equal(restart.arm(false), false);
  assert.equal(restart.pending().id, restart.id);
  assert.deepEqual(launch.mock.calls[calls + 1].arguments[1].slice(-3), ['-Id', restart.id, '-Register']);
});
