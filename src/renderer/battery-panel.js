'use strict';

function mountBatteryPanel(body, setTitle) {
  const modes = {
    efficiency: 'Best power efficiency',
    balanced: 'Balanced',
    performance: 'Best performance',
  };
  const symbol = h('span', { class: 'battery-symbol', 'aria-hidden': 'true' });
  const label = h('div', { class: 'battery-level' });
  const detail = h('div', { class: 'battery-detail' });
  const fill = h('span');
  const gauge = h('div', { class: 'battery-gauge', role: 'meter', 'aria-label': 'Battery charge', 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  const hero = h('div', { class: 'battery-hero' }, h('div', { class: 'battery-summary' },
    symbol, h('div', {}, label, detail)), gauge);
  const selector = h('select', { id: 'battery-mode', hidden: true, onchange: changeMode },
    Object.entries(modes).map(([value, text]) => h('option', { value }, text)));
  const modeHint = h('div', { class: 'battery-detail', role: 'status' });
  const modeCard = h('div', { class: 'battery-mode-card' },
    h('div', { class: 'battery-mode-row' }, h('label', { for: 'battery-mode' }, 'Power mode'), selector), modeHint);

  const settingsError = h('div', { class: 'battery-detail', role: 'status', hidden: true });
  const settings = (key, text, graphic) => h('button', {
    class: 'battery-settings', onclick: async () => {
      settingsError.hidden = true;
      const opened = await api.invoke('battery:settings', key).catch(() => false);
      if (!stopped && !opened) {
        settingsError.textContent = 'Could not open Windows power settings.';
        settingsError.hidden = false;
      }
    },
  }, icon(graphic, 16), text);
  const powerText = h('span');
  const powerSettings = settings('power', powerText, 'settings');
  const saverSettings = settings('saver', 'Energy / battery saver settings', 'bolt');
  body.append(h('div', { class: 'battery-content' }, hero, modeCard,
    h('div', { class: 'battery-settings-list' }, powerSettings, saverSettings), settingsError));

  let state, stopped = false, saving = false, failure = false, request = 0;
  let chargeTime = null, chargeSample = 0, lastSymbol, lastTitle;
  const updateText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function paint() {
    const b = state;
    const hasBattery = b?.present === true || b?.level != null;
    const charge = b?.level;
    const title = hasBattery ? 'Battery & power' : 'Power';
    if (title !== lastTitle) { setTitle(title); lastTitle = title; }
    hero.dataset.batteryState = b?.charging ? 'charging' : b?.low ? 'low' : b?.saver ? 'saver' : 'normal';
    const graphic = b?.charging ? 'bolt' : hasBattery ? 'battery' : 'power';
    if (graphic !== lastSymbol) {
      symbol.replaceChildren(icon(graphic, 22));
      lastSymbol = graphic;
    }
    updateText(label, charge != null ? charge + '%' : b?.pluggedIn ? 'Plugged in' : hasBattery ? 'Battery' : 'Power status');
    let status;
    if (b?.charging) status = chargeTime ? `Charging · ~${fmt.dur(chargeTime)} to full` : 'Charging';
    else if (b?.present === false) status = 'No system battery detected';
    else if (b?.pluggedIn === true && b.charging === false) status = charge === 100 ? 'Fully charged · Plugged in' : 'Plugged in · Not charging';
    else if (b?.pluggedIn === false && hasBattery) status = b.remaining ? `${b.low ? 'Low battery · ' : ''}${fmt.dur(b.remaining)} remaining` : b.low ? 'Low battery' : 'On battery';
    else status = b ? 'Battery status unavailable' : 'Checking Windows power status…';
    updateText(detail, b?.saver ? status + ' · Saver on' : status);
    gauge.hidden = charge == null;
    if (charge != null) {
      gauge.setAttribute('aria-valuenow', charge);
      fill.style.setProperty('--battery-level', charge / 100);
    }
    selector.hidden = !b?.mode;
    if (b?.mode && !saving && selector.value !== b.mode) selector.value = b.mode;
    selector.disabled = b?.saver === true;
    selector.setAttribute('aria-disabled', String(saving || selector.disabled));
    updateText(modeHint, saving ? 'Applying in Windows…' :
      failure ? 'Windows could not change the mode. Open Power settings to manage it.' :
      !b?.mode ? 'Manage power mode in Windows Settings.' :
      b.saver ? 'Turn off energy saver in Windows to change power mode.' : '');
    updateText(powerText, hasBattery ? 'Power & battery settings' : 'Power & sleep settings');
    saverSettings.hidden = !hasBattery;
  }

  async function refresh() {
    if (stopped || saving) return;
    const id = ++request;
    const next = await api.invoke('battery:details').catch(() => null);
    if (stopped || id !== request) return;
    state = next || {};
    if (!state.charging) { chargeTime = null; chargeSample = 0; }
    paint();
    if (state.charging && Date.now() - chargeSample >= 30000) {
      chargeSample = Date.now();
      const seconds = await api.invoke('battery:charge-time').catch(() => null);
      if (stopped || id !== request) return;
      chargeTime = seconds;
      paint();
    }
  }

  async function changeMode() {
    if (stopped || saving || !state?.mode || state.saver) {
      if (state?.mode) selector.value = state.mode;
      return;
    }
    const selected = selector.value;
    request++;
    saving = true;
    failure = false;
    paint();
    const applied = await api.invoke('battery:mode', selected).catch(() => false);
    if (stopped) return;
    failure = !applied;
    saving = false;
    if (applied) state.mode = selected;
    paint();
    refresh();
  }

  paint();
  refresh();
  const timer = setInterval(refresh, 10000);
  return () => { stopped = true; clearInterval(timer); };
}
