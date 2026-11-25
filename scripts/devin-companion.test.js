'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { activeSession, cursorTransition, focusStop } = require('../src/renderer/devin-motion');
const { palette, frames } = require('../src/renderer/otter-art');
const { ELEVATOR_FRAMES, elevatorFrame, idleFrame } = require('../src/renderer/otter');

test('the companion uses cloud status and recent local activity without counting stale sessions', () => {
  const now = 100000;
  const local = [{ id: 'local', updatedAt: now - 1 }, { id: 'stale', updatedAt: now - 30000 }];
  assert.equal(activeSession(local, [], now), 'local');
  assert.equal(activeSession(local, [], now + 30000), null);
  assert.equal(activeSession(local, [{ id: 'local', status: 'finished' }], now), null);
  assert.equal(activeSession(local, [{ id: 'cloud', status: 'Working', updatedAt: now }], now), 'cloud');
  assert.equal(activeSession([], [{ id: 'waiting', status: 'blocked' }], now), null);
});

test('the cursor drops once when work ends, and disabling it does not trigger a drop', () => {
  const working = { cursor: true, working: true };
  const idle = { cursor: true, working: false };
  assert.equal(cursorTransition(idle, 'off'), 'off');
  assert.equal(cursorTransition(working, 'off'), 'work');
  assert.equal(cursorTransition(idle, 'work'), 'drop');
  assert.equal(cursorTransition(idle, 'drop'), 'drop');
  assert.equal(cursorTransition(idle, 'hold'), 'hold');
  assert.equal(cursorTransition(working, 'drop'), 'work');
  assert.equal(cursorTransition({ ...working, cursor: false }, 'work'), 'off');
});

test('a queued animation frame can precede the first work timestamp', () => {
  assert.deepEqual(focusStop(-1), focusStop(0));
  assert.notDeepEqual(focusStop(4800), focusStop(0));
});

test('each animated clip contains multiple poses and valid 24×24 palette grids', () => {
  for (const clip of Object.values(frames)) {
    assert.ok(clip.length > 1);
    assert.ok(new Set(clip.map((rows) => rows.join(''))).size > 1);
    for (const rows of clip) {
      assert.equal(rows.length, 24);
      for (const row of rows) {
        assert.equal(row.length, 24);
        for (const pixel of row) assert.ok(pixel === '.' || palette[pixel], pixel);
      }
    }
  }
});

test('idle cycles repeat and the elevator opens, takes the otter inside, closes and descends', () => {
  const loops = Array.from({ length: 176 }, (_, index) => idleFrame(index)[0]);
  assert.deepEqual([...new Set(loops)], ['sit', 'book', 'coffee', 'stretch', 'sleep']);
  assert.deepEqual(idleFrame(176), idleFrame(0));
  assert.equal(elevatorFrame(0).depth, 24);
  assert.equal(elevatorFrame(6).gap, 8);
  assert.equal(elevatorFrame(6).walk, 0);
  assert.equal(elevatorFrame(14).pressed, true);
  assert.equal(elevatorFrame(14).walk, 22);
  assert.equal(elevatorFrame(21).gap, 0);
  assert.equal(elevatorFrame(21).depth, 0);
  assert.equal(elevatorFrame(ELEVATOR_FRAMES).visible, false);
  assert.equal(elevatorFrame(ELEVATOR_FRAMES).depth, 24);
});
