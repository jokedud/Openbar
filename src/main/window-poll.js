'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');

let worker, pending;

function poll(excludePids) {
  if (!worker) {
    const instance = new Worker(path.join(__dirname, 'window-poll-worker.js'));
    worker = instance;
    const reset = (error) => {
      if (worker !== instance) return;
      worker = null;
      pending?.reject(error);
      pending = null;
    };
    instance.on('error', reset);
    instance.on('exit', (code) => reset(new Error(`Window polling worker exited (${code})`)));
    instance.on('message', ({ windows, active, error }) => {
      if (worker !== instance || !pending) return;
      const request = pending;
      pending = null;
      instance.unref();
      if (error) request.reject(new Error(error));
      else request.resolve({ windows, active });
    });
  }
  if (!pending) {
    const result = new Promise((resolve, reject) => { pending = { resolve, reject }; });
    pending.result = result;
    try {
      worker.ref();
      worker.postMessage(excludePids);
    } catch (error) {
      pending.reject(error);
      pending = null;
      worker.unref();
    }
    return result;
  }
  return pending.result;
}

function stop() {
  return worker?.terminate();
}

module.exports = { poll, stop };
