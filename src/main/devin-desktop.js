'use strict';

const { createServer } = require('node:http');
const { randomBytes } = require('node:crypto');

const point = { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } };
const keys = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Escape: 0x1b, Space: 0x20, PageUp: 0x21, PageDown: 0x22,
  End: 0x23, Home: 0x24, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28, Delete: 0x2e,
};
const definitions = [
  ['screenshot', 'Capture the primary display', {}],
  ['mouse_move', 'Move the pointer to primary-display coordinates', point],
  ['mouse_click', 'Click at primary-display coordinates', { ...point, button: { type: 'string', enum: ['left', 'right'] } }],
  ['mouse_scroll', 'Scroll at primary-display coordinates (positive steps scroll up)', { ...point, steps: { type: 'integer', minimum: -10, maximum: 10 } }],
  ['keyboard_type', 'Type literal text in the selected desktop window', { text: { type: 'string', minLength: 1, maxLength: 500 } }],
  ['keyboard_key', 'Press a navigation or editing key in the selected desktop window', { key: { type: 'string', enum: Object.keys(keys) } }],
];
const tools = definitions.map(([name, description, properties]) => ({
  name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
}));
const toolError = (text) => ({ isError: true, content: [{ type: 'text', text }] });

function validArgs(properties, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).length !== Object.keys(properties).length) return false;
  return Object.entries(properties).every(([key, schema]) => {
    const value = args[key];
    if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= (schema.maximum ?? 32768);
    return typeof value === 'string' && (schema.enum ? schema.enum.includes(value) : value.length >= schema.minLength && value.length <= schema.maxLength);
  });
}

async function createDesktopServer(invoke) {
  const token = `Bearer ${randomBytes(32).toString('hex')}`;
  let host;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== token || req.headers.origin || req.headers.host !== host || req.url !== '/mcp') {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    const chunks = [];
    let size = 0, msg;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) return req.destroy();
        chunks.push(chunk);
      }
      msg = JSON.parse(Buffer.concat(chunks));
    } catch { res.writeHead(400).end(); return; }
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') { res.writeHead(400).end(); return; }
    if (msg.id == null) { res.writeHead(202).end(); return; }
    let result, error;
    if (msg.method === 'initialize') {
      const supported = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
      result = {
        protocolVersion: supported.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : '2025-03-26',
        capabilities: { tools: {} }, serverInfo: { name: 'openbar-desktop', version: '1.0.0' },
      };
    } else if (msg.method === 'ping') result = {};
    else if (msg.method === 'tools/list') result = { tools };
    else if (msg.method === 'tools/call') {
      const tool = tools.find((item) => item.name === msg.params?.name);
      const args = msg.params?.arguments ?? {};
      if (!tool || !validArgs(tool.inputSchema.properties, args)) result = toolError('Unknown action or invalid arguments.');
      else {
        try { result = await invoke(tool, args, () => !res.destroyed); }
        catch { result = toolError('OpenBar could not complete the desktop action.'); }
      }
    } else error = { code: -32601, message: 'Method not found' };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...(error ? { error } : { result }) }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  host = `127.0.0.1:${server.address().port}`;
  return {
    config: { type: 'http', name: 'openbar-desktop', url: `http://${host}/mcp`, headers: [{ name: 'Authorization', value: token }] },
    close() { server.close(); server.closeAllConnections(); },
  };
}

function createWindowsDesktop({ screen, desktopCapturer, win32, target }) {
  return function prepare({ name, description }, args) {
    const label = description.split(' (')[0];
    const display = screen.getPrimaryDisplay();
    if (name === 'screenshot') {
      return { label, detail: 'An image of your primary display will be sent to the model.', async run() {
        const { width, height } = display.size;
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
        const source = sources.find((item) => item.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) throw new Error('Primary display unavailable');
        return [
          { type: 'image', data: source.thumbnail.resize({ width, height }).toPNG().toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: `Primary display: ${width} × ${height}; coordinates are relative to its top-left corner.` },
        ];
      } };
    }
    if (name === 'keyboard_type' || name === 'keyboard_key') {
      const window = target();
      if (!window) throw new Error('No desktop window selected');
      const input = name === 'keyboard_type' ? JSON.stringify(args.text) : args.key;
      return { label, detail: `${window.title}: ${input}`, run() {
        if (!win32.activateDesktopInputTarget(window.hwnd, window.pid)) throw new Error('The selected window is no longer available');
        if (name === 'keyboard_type') win32.typeDesktopText(args.text);
        else win32.pressDesktopKey(keys[args.key]);
      } };
    }
    if (args.x >= display.size.width || args.y >= display.size.height) throw new Error('Coordinates outside the primary display');
    const pt = screen.dipToScreenPoint({ x: display.bounds.x + args.x, y: display.bounds.y + args.y });
    const extra = args.button ? `, ${args.button} button` : args.steps != null ? `, ${args.steps} steps` : '';
    return { label, detail: `Primary display · (${args.x}, ${args.y})${extra}`, run() {
      const current = screen.getPrimaryDisplay();
      if (current.id !== display.id || current.size.width !== display.size.width || current.size.height !== display.size.height ||
          current.scaleFactor !== display.scaleFactor) throw new Error('Primary display changed');
      win32.moveDesktopMouse(pt, name !== 'mouse_move');
      if (name === 'mouse_click') win32.clickDesktopMouse(args.button);
      if (name === 'mouse_scroll') win32.scrollDesktopMouse(args.steps);
    } };
  };
}

module.exports = { createDesktopServer, createWindowsDesktop, toolError };
