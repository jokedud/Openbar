'use strict';

function mountNetworkPanel(body) {
  const unavailable = { radio: 'unavailable', connected: false, canToggle: false };
  const descriptions = {
    loading: ['Checking Wi-Fi…', 'Reading the wireless radio from Windows.'],
    unavailable: ['Wi-Fi unavailable', 'Windows did not report wireless controls.'],
    absent: ['No Wi-Fi adapter', 'Windows did not find a wireless adapter.'],
    unknown: ['Wi-Fi status unknown', 'Manage the radio in Windows Settings.'],
    blocked: ['Wi-Fi blocked', 'Check airplane mode or the hardware switch.'],
    off: ['Wi-Fi is off', 'Turn it on to find nearby networks.'],
    on: ['Wi-Fi is on', 'Not connected to a wireless network.'],
  };
  const online = h('span', { class: 'wifi-online' });
  const name = h('strong');
  const detail = h('span', { class: 'wifi-detail' });
  const toggle = h('button', { class: 'wifi-toggle', type: 'button', role: 'switch', 'aria-label': 'Wi-Fi', hidden: true },
    h('span', { class: 'wifi-knob', 'aria-hidden': 'true' }));
  const discovery = h('button', { class: 'wifi-action wifi-discover', type: 'button', hidden: true }, icon('wifi', 15), 'Available networks');
  const settings = h('button', { class: 'wifi-action wifi-settings', type: 'button' }, icon('settings', 15), 'Network settings');
  const message = h('div', { class: 'wifi-message', role: 'status' });
  const down = h('strong'), up = h('strong');
  const rate = (label, arrow, value) => h('div', { class: 'wifi-rate' },
    h('span', { class: 'wifi-rate-icon', 'aria-hidden': 'true' }, arrow),
    h('div', {}, h('div', { class: 'wifi-rate-label' }, label), value));
  const hero = h('div', { class: 'wifi-hero', 'data-radio': 'loading' },
    h('div', { class: 'wifi-orb', 'aria-hidden': 'true' }, icon('wifi', 25)),
    h('div', { class: 'wifi-copy', role: 'status' }, name, detail), toggle);
  body.append(h('div', { class: 'wifi-pop' }, hero,
    h('div', { class: 'wifi-traffic' }, rate('Download', '↓', down), rate('Upload', '↑', up)),
    h('div', { class: 'wifi-actions' }, discovery, settings), message));

  let state = { ...unavailable, radio: 'loading' };
  let active = true, pending = false, timer, request = 0;
  const setText = (el, value) => { if (el.textContent !== value) el.textContent = value; };
  const updateTraffic = () => {
    const { net } = OB.state;
    setText(down, net ? fmt.rate(net.down) : '—');
    setText(up, net ? fmt.rate(net.up) : '—');
    setText(online, navigator.onLine ? 'Online' : 'Offline');
    online.dataset.online = String(navigator.onLine);
  };
  const updateRadio = () => {
    const { radio, canToggle, connected } = state;
    const [label, desc] = descriptions[radio];
    const isOn = radio === 'on';
    hero.dataset.radio = radio;
    setText(name, connected && (isOn || radio === 'unknown') ? 'Wi-Fi connected' : label);
    setText(detail, connected && isOn ? 'Connected to a wireless network.' : desc);
    toggle.hidden = !canToggle;
    toggle.setAttribute('aria-checked', String(isOn));
    toggle.setAttribute('aria-disabled', String(pending));
    discovery.hidden = radio !== 'on' && radio !== 'off';
    discovery.setAttribute('aria-disabled', String(!isOn || pending));
  };
  const refresh = async () => {
    const current = ++request;
    const snapshot = await api.invoke('wifi:status').catch(() => null);
    if (!active || current !== request) return;
    state = snapshot || unavailable;
    updateRadio();
    timer = setTimeout(refresh, 4000);
  };
  toggle.addEventListener('click', async () => {
    if (!active || pending || !state.canToggle) return;
    const enabled = state.radio !== 'on';
    pending = true;
    request++;
    clearTimeout(timer);
    setText(message, '');
    updateRadio();
    const ok = await api.invoke('wifi:set-radio', enabled).catch(() => false);
    if (!active) return;
    await refresh();
    if (!active) return;
    pending = false;
    updateRadio();
    if (!ok) setText(message, 'Windows could not change Wi-Fi. Use Network settings.');
  });
  const open = async (target) => {
    setText(message, '');
    const opened = await api.invoke('wifi:open', target).catch(() => false);
    if (!active) return;
    if (opened) api.invoke('panel:close').catch(() => {});
    else setText(message, 'Could not open Windows network settings.');
  };
  discovery.addEventListener('click', () => { if (active && !pending && state.radio === 'on') open('networks'); });
  settings.addEventListener('click', () => { if (active) open('settings'); });
  const events = ['online', 'offline'];
  for (const event of events) window.addEventListener(event, updateTraffic);
  updateTraffic();
  updateRadio();
  refresh();
  return {
    online, updateTraffic,
    dispose() {
      active = false;
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, updateTraffic);
    },
  };
}
