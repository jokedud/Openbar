'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { Otter } = require('../src/renderer/otter');

test('the elevator rises at the otter’s perch and stays inside the dock', () => {
  const rects = [];
  let translation = 0;
  const ctx = {
    clearRect() {}, beginPath() {}, rect() {}, clip() {},
    save() {}, restore() {},
    fillRect(x, y, width, height) { rects.push({ x: x + translation, y, width, height }); },
    translate(x) { translation += x; },
  };
  const canvas = { getContext: () => ctx, style: {} };
  const otter = new Otter(canvas);
  const perch = { left: 1200, floor: 1040, scale: 3 };
  const dockRight = 1270;
  otter.draw('elevator', 6, perch, false);
  const shaft = rects.find(({ width, height }) => width === 22 && height === 22);
  const canvasLeft = Number(canvas.style.transform.match(/translate\((-?\d+)px/)[1]);
  const shaftLeft = canvasLeft + shaft.x * perch.scale;
  assert.ok(shaftLeft + shaft.width * perch.scale <= dockRight, `elevator goes past ${dockRight}: ${shaftLeft + shaft.width * perch.scale}`);
  assert.equal(shaftLeft + shaft.width * perch.scale / 2, perch.left + 11 * perch.scale);
});
