'use strict';

function mountVolumePanel(body) {
  const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Output volume', disabled: true });
  const level = h('span', { class: 'volume-level', 'aria-hidden': 'true' }, '—');
  const speaker = icon('speaker', 22);
  const mute = h('button', { class: 'volume-mute', 'aria-label': 'Mute output', 'aria-pressed': 'false', disabled: true }, speaker);
  const status = h('p', { class: 'volume-status', role: 'status' }, 'Checking Windows audio…');
  const controls = h('div', { class: 'volume-controls' }, mute, h('div', { class: 'volume-track' }, slider), level);
  const settings = h('button', {
    class: 'btn volume-settings',
    onclick: () => api.invoke('open', 'ms-settings:sound'),
  }, icon('settings', 15), 'Windows sound settings', h('span', { class: 'volume-external', 'aria-hidden': 'true' }, '↗'));
  body.append(h('section', { class: 'volume-content' },
    h('div', { class: 'volume-card' }, status, controls), settings));

  let active = true, request = 0, busy = false, current = null;
  function render(state) {
    current = state;
    const ready = state.status === 'ready';
    slider.disabled = mute.disabled = !ready;
    mute.setAttribute('aria-pressed', String(ready && state.muted));
    speaker.classList.toggle('volume-silent', !ready || state.muted || state.volume === 0);
    controls.dataset.muted = String(ready && state.muted);
    const message = ready ? (state.muted ? 'Default output · Muted' : 'Default Windows output')
      : state.status === 'no-output' ? 'No audio output device detected' : 'Windows audio is unavailable';
    if (status.textContent !== message) status.textContent = message;
    const percent = ready ? state.volume : 0;
    slider.value = percent;
    controls.style.setProperty('--volume-fill', percent + '%');
    level.textContent = ready ? percent + '%' : '—';
  }

  async function update(channel, ...args) {
    busy = true;
    const id = ++request;
    let next;
    try { next = await api.invoke(channel, ...args); } catch (_) { next = { status: 'unavailable' }; }
    if (!active || id !== request) return;
    busy = false;
    render(next);
  }

  slider.addEventListener('input', () => {
    const volume = Number(slider.value);
    render({ ...current, volume });
    update('volume:change', 'volume', volume);
  });
  mute.addEventListener('click', () => {
    const muted = !current.muted;
    render({ ...current, muted });
    update('volume:change', 'mute', muted);
  });
  const stop = OB.on((kind, patch) => {
    if (kind === 'state' && patch.volume && !busy) render(patch.volume);
  });
  update('volume:read');
  return () => { active = false; stop(); };
}
