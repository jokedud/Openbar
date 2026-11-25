'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { DevinChat } = require('../src/main/devin-chat');

test('only the Devin panel can read chat state before it is shown; hidden actions stay blocked', async () => {
  const mainPath = path.join(__dirname, '../src/main/main.js');
  const handlers = new Map();
  const contents = { mainFrame: {} };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const state = { messages: [{ role: 'user', text: 'Existing chat' }] };
  const calls = [];
  const app = {
    requestSingleInstanceLock: () => true, setAppUserModelId() {}, on() {},
    whenReady: () => ({ then() {} }), getPath: () => __dirname,
  };
  const modules = {
    path, electron: { app, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } },
    './devin-chat': { DevinChat: class {
      check() { return state; }
      send() { calls.push('send'); }
      decide() { calls.push('approve'); }
      stop() { calls.push('stop'); }
      reset() { calls.push('reset'); }
    } },
    './devin-desktop': { createWindowsDesktop() {} },
  };
  runInNewContext(readFileSync(mainPath, 'utf8') + `
    panelWidget = 'devin';
    panel = { webContents: contents, isDestroyed: () => false, isVisible: () => false, isFocused: () => true };
    registerDevinChatIpc();
  `, {
    __dirname: path.dirname(mainPath), process: { platform: 'win32', on() {} },
    require: (id) => modules[id] || {}, contents,
  }, { filename: mainPath });
  const status = handlers.get('devin:chat-status');
  assert.equal(await status(event), state);
  assert.equal(await status({ ...event, senderFrame: {} }), null);
  for (const action of ['send', 'approve', 'stop', 'reset']) handlers.get(`devin:chat-${action}`)(event);
  assert.deepEqual(calls, []);
});

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

test('desktop grants expire when an exited agent is replaced by a new session', { timeout: 12000 }, async (t) => {
  let child;
  const movements = [];
  const fixture = path.join(__dirname, 'fixtures', 'fake-devin-acp.js');
  const chat = new DevinChat({
    cwd: __dirname, visible: () => true,
    agent: async () => ({ spawn: () => (child = spawn(process.execPath, [fixture], { stdio: ['pipe', 'pipe', 'inherit'] })) }),
    prepare: (tool) => ({ label: tool.name, run: () => { if (tool.name === 'mouse_move') movements.push(tool.name); } }),
    emit: ({ approval }) => {
      if (!approval) return;
      chat.decide(approval.id, approval.label === 'mouse_move' && movements.length === 0 ? 'session' : 'deny');
    },
  });
  t.after(() => chat.stop());
  await chat.send('Move the pointer');
  assert.equal(chat.view().grants, 1);
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  await chat.send('Do not move again without permission');
  assert.deepEqual(movements, ['mouse_move']);
  assert.equal(chat.view().grants, 0);
});
