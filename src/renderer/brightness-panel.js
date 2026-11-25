'use strict';

function mountBrightness(body) {
  const root = h('div', { class: 'brightness-content' });
  const label = h('div', { class: 'brightness-label' }, 'Display control');
  const value = h('div', { class: 'brightness-value' }, 'Checking display…');
  const sun = h('div', { class: 'brightness-sun', 'aria-hidden': 'true' }, icon('sun', 32));
  const status = h('p', { class: 'brightness-status', role: 'status' });
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Display brightness' });
  const controls = h('div', { class: 'brightness-controls', hidden: true }, slider);
  const requestFailed = { level: null, failed: true };
  let actual = { level: null, failed: false }, checking = true, settingsError = '';
  let pending = null, applying = null;
  let disposed = false, busy = false, timer;

  const shortcut = (page, glyph, title) => h('button', { class: 'btn', onclick: async () => {
    settingsError = '';
    render();
    const opened = await api.invoke('brightness:settings', page).catch(() => false);
    if (!disposed && !opened) {
      settingsError = 'Could not open Windows Settings.';
      render();
    }
  } }, icon(glyph, 15), title);
  root.append(
    h('div', { class: 'brightness-hero' }, h('div', {}, label, value), sun),
    controls, status,
    h('div', { class: 'brightness-shortcuts' },
      shortcut('display', 'desktop', 'Display settings'), shortcut('nightlight', 'moon', 'Night light')),
  );
  body.append(root);

  function render() {
    const available = actual.level !== null;
    const intended = pending ?? applying;
    root.dataset.available = available ? 'true' : 'false';
    label.textContent = available ? 'Built-in display' : 'Display control';
    value.textContent = available ? `${actual.level}%` : checking ? 'Checking display…' : 'Not adjustable here';
    controls.hidden = !available;
    slider.disabled = !available;
    root.style.setProperty('--brightness-level', (actual.level ?? 0) / 100);
    if (available) {
      slider.value = intended ?? actual.level;
      controls.style.setProperty('--brightness-track', `${intended ?? actual.level}%`);
    }
    const message = settingsError || (checking ? 'Looking for a supported built-in display.' :
      pending !== null || applying !== null ? 'Applying brightness…' :
      actual.failed ? 'Could not change the brightness. Try Display settings.' :
      available ? '' : 'For external monitors, use the controls on the monitor.');
    if (status.textContent !== message) status.textContent = message;
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (!disposed && !busy) timer = setTimeout(sync, delay);
  }

  async function sync() {
    busy = true;
    applying = pending;
    pending = null;
    const writing = applying !== null;
    render();
    const state = await (writing ? api.invoke('brightness:set', applying) : api.invoke('brightness:get'))
      .catch(() => writing ? requestFailed : { level: null, failed: false });
    if (disposed) return;
    busy = false;
    applying = null;
    actual = state;
    checking = false;
    if (actual.level === null) pending = null;
    render();
    schedule(pending !== null ? 0 : actual.level !== null ? 4000 : 12000);
  }

  slider.addEventListener('input', () => {
    pending = slider.valueAsNumber;
    render();
    schedule(120);
  });
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  const onVisibility = () => { if (document.hidden) dispose(); };
  document.addEventListener('visibilitychange', onVisibility);
  sync();
  return dispose;
}
