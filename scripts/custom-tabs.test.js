'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const { normalizeCustomTabs, shortcutTarget } = require('../src/main/custom-tabs');

test('scrolls crowded full-width Home apps with or without the tab switcher', () => {
  let onWheel;
  let prevented = 0;
  const tabSwitcher = { isConnected: true };
  const left = {
    id: 'left', scrollLeft: 0, scrollWidth: 600, clientWidth: 400,
  };
  const settings = { layout: 'full' };
  runInNewContext(readFileSync(path.join(__dirname, '../src/renderer/bar-tabs.js'), 'utf8'), {
    h: () => tabSwitcher,
    document: {
      getElementById: () => left,
      addEventListener(type, handler, options) {
        assert.equal(type, 'wheel');
        assert.equal(options.passive, false);
        onWheel = handler;
      },
    },
    OB: { settings },
  });
  const wheel = { target: { closest: () => left }, deltaX: 0, deltaY: 80, deltaMode: 0, preventDefault: () => prevented++ };
  onWheel(wheel);
  assert.equal(left.scrollLeft, 80);
  onWheel({ ...wheel, deltaX: 25 });
  left.clientWidth = 600;
  onWheel(wheel);
  left.clientWidth = 400;
  tabSwitcher.isConnected = false;
  onWheel(wheel);
  assert.equal(left.scrollLeft, 160);
  assert.equal(prevented, 2);
  settings.layout = 'pill';
  onWheel(wheel);
  assert.equal(left.scrollLeft, 160);
  assert.equal(prevented, 2);
});

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
