'use strict';

const bluetoothStatusText = {
  loading: ['Checking Bluetooth…', 'Reading the radio state from Windows.'],
  on: ['Bluetooth is on', 'Manage your paired devices below.'],
  off: ['Bluetooth is off', 'Turn it on to connect to nearby devices.'],
  'no-adapter': ['No Bluetooth adapter', 'Windows did not report a Bluetooth radio.'],
  denied: ['Access denied', 'Windows blocked access to the Bluetooth radio.'],
  disabled: ['Bluetooth is disabled', 'Check the adapter in Windows Bluetooth settings.'],
  multiple: ['Multiple Bluetooth radios', 'Manage these radios in Windows Bluetooth settings.'],
  unavailable: ['Bluetooth unavailable', 'Open Windows Bluetooth settings to check your adapter.'],
  unsupported: ['Bluetooth controls need Windows', 'This device cannot use the Windows Bluetooth controls.'],
};
const bluetoothOperationText = {
  denied: 'Windows denied the change. Use Bluetooth settings instead.',
  failed: 'Could not change Bluetooth. Check the state in Windows settings.',
  unconfirmed: 'Windows did not confirm the change. Check Bluetooth settings.',
};

function mountBluetoothPanel(body) {
  let stopped = false, busy = false, timer, status = 'loading', devicesKey, toggleDenied = false, requestId = 0;
  const section = h('section', { class: 'bluetooth-content', 'data-status': status });
  const statusTitle = h('strong');
  const statusDetail = h('div', { class: 'muted' });
  const notice = h('p', { class: 'bluetooth-note', role: 'status' });
  const switchKnob = h('span', { 'aria-hidden': 'true' });
  const toggle = h('button', {
    class: 'bluetooth-switch', type: 'button', role: 'switch', 'aria-label': 'Bluetooth radio',
    onclick: () => { if (toggle.getAttribute('aria-disabled') === 'false') update(status === 'on' ? 'off' : 'on'); },
  }, switchKnob);
  const devices = h('ul', { class: 'bluetooth-devices', 'aria-label': 'Paired devices' });
  const deviceHint = h('p', { class: 'bluetooth-note muted' });
  const open = async (destination) => {
    const success = await api.invoke('bluetooth:open', destination).catch(() => false);
    if (!stopped) {
      notice.hidden = success;
      notice.textContent = success ? '' : 'Windows could not open Bluetooth controls.';
    }
  };
  const shortcuts = h('div', { class: 'bluetooth-shortcuts' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => open('add') }, 'Add device'),
    h('button', { class: 'btn', type: 'button', onclick: () => open('settings') }, icon('settings', 14), 'Bluetooth settings'));
  section.append(
    h('div', { class: 'bluetooth-radio' },
      h('div', { class: 'bluetooth-emblem', 'aria-hidden': 'true' }, icon('bluetooth', 24)),
      h('div', { class: 'bluetooth-status', role: 'status' }, statusTitle, statusDetail), toggle),
    h('div', { class: 'bluetooth-devices-heading' }, 'PAIRED DEVICES'),
    deviceHint, devices, h('div', { class: 'bluetooth-footer' }, shortcuts, notice),
  );
  body.append(section);

  function renderState(next, list) {
    status = next;
    section.dataset.status = next;
    const [title, detail] = bluetoothStatusText[next];
    if (statusTitle.textContent !== title) statusTitle.textContent = title;
    if (statusDetail.textContent !== detail) statusDetail.textContent = detail;
    toggle.hidden = next !== 'on' && next !== 'off';
    toggle.setAttribute('aria-checked', String(next === 'on'));
    toggle.setAttribute('aria-disabled', String(toggle.hidden || busy || toggleDenied));
    shortcuts.hidden = next === 'unsupported';
    const hint = Array.isArray(list)
      ? (list.length ? '' : 'No paired devices found.')
      : next === 'loading' ? 'Checking for paired devices…' : 'See device details in Windows Bluetooth settings.';
    if (deviceHint.textContent !== hint) deviceHint.textContent = hint;
    deviceHint.hidden = !hint || next === 'unsupported';
    const key = JSON.stringify(list);
    if (key !== devicesKey) {
      devicesKey = key;
      devices.replaceChildren(...(list || []).map((device) => h('li', { class: 'bluetooth-device' },
        h('span', { class: 'bluetooth-device-name' }, device.name),
        h('span', { class: device.connected ? 'bluetooth-connected' : 'muted' },
          device.connected === true ? 'Connected' : device.connected === false ? 'Not connected' : 'Paired'))));
    }
  }

  async function update(action = 'read') {
    clearTimeout(timer);
    const changing = action !== 'read';
    const current = ++requestId;
    if (changing) {
      busy = true;
      toggle.setAttribute('aria-disabled', 'true');
      notice.hidden = false;
      notice.textContent = 'Waiting for Windows…';
    }
    const state = await (changing ? api.invoke('bluetooth:toggle', action === 'on') : api.invoke('bluetooth:state'))
      .catch(() => null);
    if (stopped || current !== requestId) return;
    busy = false;
    if (changing) {
      toggleDenied = state?.error === 'denied';
      notice.textContent = bluetoothOperationText[state?.error]
        || (state?.status === action ? '' : bluetoothOperationText.unconfirmed);
      notice.hidden = !notice.textContent;
    }
    renderState(state?.status || 'unavailable', state?.devices || null);
    if (!['unsupported', 'denied'].includes(status)) timer = setTimeout(update, 8000);
  }

  notice.hidden = true;
  renderState('loading', null);
  update();
  return () => { stopped = true; clearTimeout(timer); };
}
