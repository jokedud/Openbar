'use strict';

async function loadTrayApps(target) {
  if (target.getAttribute('aria-busy') === 'true') return;
  target.setAttribute('aria-busy', 'true');
  const status = h('div', { class: 'empty', role: 'status' }, 'Looking for background apps…');
  target.replaceChildren(status);
  const items = await api.invoke('tray-apps:list').catch(() => null);
  target.removeAttribute('aria-busy');
  if (!status.isConnected) return;
  if (!items?.length) {
    status.textContent = items ? 'No apps in the Windows notification area.' : 'Could not read the Windows notification area. Try refreshing.';
    return;
  }
  const list = h('div', { class: 'tray-apps-list' });
  let pending = false;
  async function activate(item, kind) {
    if (pending) return;
    pending = true;
    const ok = await api.invoke('tray-apps:activate', item.id, kind).catch(() => false);
    pending = false;
    if (!ok && list.isConnected) {
      message.textContent = 'Could not reach that tray icon. Refresh to try again.';
    }
  }
  const ordered = [...items].sort((a, b) => Number(b.inOverflow) - Number(a.inOverflow));
  for (const item of ordered) {
    const context = (event) => { event.preventDefault(); activate(item, 'menu'); };
    const row = h('button', {
      class: 'tray-apps-item',
      title: item.label,
      onclick: () => activate(item, 'open'),
      oncontextmenu: context,
      onkeydown: (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) context(event);
      },
    }, h('span', { class: 'tray-apps-glyph', 'aria-hidden': 'true' }, Array.from(item.label)[0].toUpperCase()),
    h('span', { class: 'ellipsis' }, item.label));
    list.append(row);
  }
  const message = h('div', { class: 'tray-apps-hint', role: 'status' }, 'Click to open · Right-click for app options');
  target.replaceChildren(list, message);
}
