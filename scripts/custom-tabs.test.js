'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeCustomTabs, shortcutTarget } = require('../src/main/custom-tabs');

test('normalizes persisted tabs without altering tab or item order', () => {
  const tabs = [
    { id: 'two', name: '  Work  ', items: [
      { id: 'docs', kind: 'website', name: ' Docs ', target: ' https://example.com ', args: 'ignored' },
      { id: 'timer', kind: 'widget', widget: 'pomodoro' },
    ] },
    { id: 'one', name: 'Games', items: [] },
  ];
  const expected = [
    { id: 'two', name: 'Work', items: [
      { id: 'docs', kind: 'website', name: 'Docs', target: 'https://example.com/' },
      { id: 'timer', kind: 'widget', widget: 'pomodoro' },
    ] },
    { id: 'one', name: 'Games', items: [] },
  ];
  assert.deepEqual(normalizeCustomTabs(tabs), expected);
  assert.deepEqual(normalizeCustomTabs(JSON.parse(JSON.stringify(expected))), expected);
});

test('ignores malformed or duplicate tabs and items', () => {
  assert.deepEqual(normalizeCustomTabs({}), []);
  assert.deepEqual(normalizeCustomTabs([
    null, { id: 'bad spaces', name: 'Invalid' }, { id: 'empty', name: ' ' },
    { id: 'work', name: 'Work', items: [
      null, { id: 'bad-link', kind: 'website', name: 'Invalid', target: 'file:///C:/Windows' },
      { id: 'folder', kind: 'folder', name: 'Documents', target: 'C:\\Documents' },
      { id: 'folder', kind: 'widget', widget: 'notes' },
    ] },
    { id: 'work', name: 'Ignored' },
  ]), [
    { id: 'work', name: 'Work', items: [{ id: 'folder', kind: 'folder', name: 'Documents', target: 'C:\\Documents' }] },
  ]);
});

test('accepts HTTP(S), Windows application shortcuts, and absolute folder paths only', () => {
  assert.equal(shortcutTarget('website', 'https://example.com/docs'), 'https://example.com/docs');
  assert.equal(shortcutTarget('app', 'C:\\Tools\\My App.exe'), 'C:\\Tools\\My App.exe');
  assert.equal(shortcutTarget('app', 'C:\\Start\\My App.lnk'), 'C:\\Start\\My App.lnk');
  assert.equal(shortcutTarget('folder', '\\\\host\\share\\Docs'), '\\\\host\\share\\Docs');
  for (const value of ['javascript:alert(1)', 'file:///C:/Windows', 'https://', 'https://user:pass@example.com']) {
    assert.equal(shortcutTarget('website', value), null);
  }
  for (const value of ['C:relative.exe', 'C:\\script.cmd', '\\\\?\\C:\\app.exe', 'https://example.com/app.exe']) {
    assert.equal(shortcutTarget('app', value), null);
  }
  assert.equal(shortcutTarget('folder', '.\\relative'), null);
});
