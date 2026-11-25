'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { build } = require('../package.json');

test('the portable launcher has a Windows bitmap to display during extraction', () => {
  const splashImage = build.portable.splashImage;
  assert.ok(splashImage, 'without a splash image electron-builder runs the portable launcher silently');
  const image = fs.readFileSync(path.resolve(__dirname, '..', splashImage));
  assert.equal(image.toString('ascii', 0, 2), 'BM');
  assert.equal(image.readUInt32LE(2), image.length);
  assert.equal(image.readUInt16LE(28), 24);
  assert.equal(image.readUInt32LE(30), 0);
});
