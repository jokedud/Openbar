'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { DevinChat } = require('../src/main/devin-chat');

test('ACP chat streams, scopes its MCP token, and gates desktop actions on explicit decisions', { timeout: 12000 }, async (t) => {
  const performed = [], approvals = [], streamed = [];
  const fixture = path.join(__dirname, 'fixtures', 'fake-devin-acp.js');
  let visible = true;
  const chat = new DevinChat({
    cwd: __dirname, visible: () => visible,
    agent: async () => ({ spawn: () => spawn(process.execPath, [fixture], { stdio: ['pipe', 'pipe', 'inherit'] }) }),
    prepare: (tool, args) => ({
      label: tool.name,
      detail: JSON.stringify(args),
      run: () => {
        performed.push(tool.name);
        if (tool.name === 'screenshot') return [{ type: 'image', data: 'fake', mimeType: 'image/png' }];
      },
    }),
    emit: (view) => {
      streamed.push(view.messages.at(-1)?.text);
      if (!view.approval || approvals.includes(view.approval.label)) return;
      const { id, label } = view.approval;
      approvals.push(label);
      assert.ok(!performed.includes(label));
      chat.decide('wrong-id', 'session');
      assert.equal(chat.view().approval.id, id);
      chat.decide(id, ({ screenshot: 'once', mouse_move: 'session', keyboard_type: 'deny' })[label]);
    },
  });
  t.after(() => chat.stop());
  await chat.send('Try the Notepad demo');
  assert.ok(streamed.includes('I’ll check the desktop, move the pointer, '));
  assert.deepEqual(approvals, ['screenshot', 'mouse_move', 'keyboard_type']);
  assert.deepEqual(performed, ['screenshot', 'mouse_move']);
  assert.match(chat.view().messages.at(-1).text, /denied or unavailable/);
  assert.equal(chat.view().grants, 1);
  await chat.send('Move the pointer again');
  assert.equal(approvals.length, 3);
  assert.deepEqual(performed, ['screenshot', 'mouse_move', 'mouse_move']);
  assert.match(chat.view().messages.at(-1).text, /are complete/);
  visible = false;
  await chat.send('Do not process a hidden panel');
  assert.equal(chat.view().messages.length, 4);
  chat.reset();
  assert.equal(chat.view().grants, 0);
  assert.equal(chat.view().messages.length, 0);
});

test('Devin chat exposes missing installation and sign-in states without launching ACP', async () => {
  for (const error of ['install', 'login']) {
    const chat = new DevinChat({
      cwd: __dirname, visible: () => true, emit() {},
      agent: async () => ({ error, spawn: () => assert.fail('ACP should not launch') }),
    });
    assert.equal((await chat.check()).error, error);
    await chat.send('Hello');
    assert.equal(chat.view().error, error);
    assert.deepEqual(chat.view().messages, []);
  }
});
