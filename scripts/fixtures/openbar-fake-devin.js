'use strict';

const { app } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

const profile = process.env.OPENBAR_FIXTURE_PROFILE;
if (!profile || !path.isAbsolute(profile)) throw new Error('Set OPENBAR_FIXTURE_PROFILE to a dedicated absolute test profile.');
app.setPath('userData', profile);
const modulePath = require.resolve('../../src/main/devin-chat');
const { DevinChat } = require(modulePath);
const fixture = path.join(__dirname, 'fake-devin-acp.js');
require.cache[modulePath].exports.DevinChat = class extends DevinChat {
  constructor(options) {
    super({ ...options, agent: async () => ({
      spawn: () => spawn(process.execPath, [fixture], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
      }),
    }) });
  }
};
require('../../src/main/main');
