'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mock, test } = require('node:test');

const launch = mock.method(require('node:child_process'), 'execFile', () => {});
const TaskbarRecovery = require('../src/main/taskbar-recovery');

test('taskbar stays unarmed until a live recovery worker acknowledges the saved baseline', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-recovery-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const recovery = new TaskbarRecovery(profile);
  assert.equal(recovery.arm(false), false);
  assert.deepEqual(recovery.pending(), { id: recovery.id, pid: process.pid, autohide: false });
  assert.equal(recovery.arm(true), false);
  assert.equal(launch.mock.callCount(), 1);

  const restart = new TaskbarRecovery(profile);
  assert.equal(restart.arm(true), false);
  restart.restored();
  fs.writeFileSync(path.join(recovery.folder, recovery.id + '.ready'), String(process.pid));
  assert.equal(recovery.arm(true), true);
  assert.equal(recovery.pending().autohide, false);

  recovery.restored();
  assert.equal(fs.existsSync(path.join(recovery.folder, recovery.id + '.release')), true);
  assert.equal(recovery.arm(true), false);
  assert.equal(recovery.pending().autohide, false);
  fs.unlinkSync(recovery.file);
  assert.equal(recovery.pending(), null);
  assert.equal(recovery.arm(true), false);
  assert.equal(recovery.pending().autohide, true);
});

test('a relaunch resumes an interrupted registration before arming a new worker', (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openbar-recovery-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const interrupted = new TaskbarRecovery(profile);
  assert.equal(interrupted.arm(false), false);
  const stale = interrupted.pending();
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
