'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');

test('the Windows polling worker returns a native snapshot and can be stopped', { skip: process.platform !== 'win32' }, async (t) => {
  const worker = require('../src/main/window-poll');
  t.after(() => worker.stop());
  const read = worker.poll(new Set([process.pid]));
  assert.equal(worker.poll(new Set([process.pid])), read);
  const { windows, active } = await read;
  assert.ok(Array.isArray(windows));
  assert.equal(typeof active, 'number');
  assert.ok(windows.every((w) => w.pid !== process.pid && typeof w.path === 'string'));
});
