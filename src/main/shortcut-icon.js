'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { nativeImage } = require('electron');

let worker;
let nextId = 0;
const pending = new Map();

function iconWorker() {
  if (worker) return worker;
  const instance = new Worker(path.join(__dirname, 'shortcut-icon-worker.js'));
  const reset = () => {
    if (worker !== instance) return;
    worker = null;
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  };
  instance.on('error', reset);
  instance.on('exit', reset);
  instance.on('message', ({ id, bitmap }) => {
    const resolve = pending.get(id);
    pending.delete(id);
    if (resolve) resolve(bitmap);
    if (!pending.size) instance.unref();
  });
  worker = instance;
  return worker;
}

async function shortcutIcon(file) {
  const instance = iconWorker();
  const id = nextId++;
  const bitmap = await new Promise((resolve, reject) => {
    instance.ref();
    pending.set(id, resolve);
    try {
      instance.postMessage({ id, file });
    } catch (error) {
      pending.delete(id);
      if (!pending.size) instance.unref();
      reject(error);
    }
  });
  if (!bitmap) return '';
  return nativeImage.createFromBitmap(Buffer.from(bitmap.bytes), { width: bitmap.size, height: bitmap.size }).toDataURL();
}

module.exports = { shortcutIcon };
