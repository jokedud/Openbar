'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

test('Sessions preserves idle chat and cannot hide a pending approval', async () => {
  const source = readFileSync(path.join(__dirname, '../src/renderer/devin-chat.js'), 'utf8');
  const h = () => ({
    append() {}, addEventListener() {}, classList: { toggle() {} }, replaceChildren() {}, childNodes: [], isConnected: true,
  });
  const invoked = [];
  let sessions, paint, navigations = 0;
  const context = {
    h, icon() {}, actionBtn() {}, requestAnimationFrame() {},
    setHead: (_title, button) => { sessions = button; },
    api: {
      invoke: async (channel) => { invoked.push(channel); return {}; },
      on: (_channel, update) => { paint = update; return () => {}; },
    },
    navigate: () => { navigations++; },
  };
  context.h = (tag, attrs) => Object.assign(h(), attrs);
  runInNewContext(source + '\nmountDevinChat(h(), navigate);', context);
  await sessions.onclick();
  assert.deepEqual(invoked, ['devin:chat-status']);
  assert.equal(navigations, 1);
  paint({ busy: true });
  assert.equal(sessions.disabled, true);
  paint({ busy: false });
  assert.equal(sessions.disabled, false);
});
