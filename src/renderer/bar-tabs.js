'use strict';

let dockTabId = null;
const dockTabs = h('nav', { id: 'dock-tabs', 'aria-label': 'Dock tabs' });
const shortcutIcons = { app: 'desktop', folder: 'folder', website: 'link' };
const dockLeft = document.getElementById('left');

dockLeft.addEventListener('wheel', (e) => {
  if ((!dockTabId && OB.settings.layout === 'pill') || e.ctrlKey || e.deltaX ||
      !e.deltaY || dockLeft.scrollWidth <= dockLeft.clientWidth) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? dockLeft.clientWidth : 1;
  dockLeft.scrollLeft += e.deltaY * unit;
}, { passive: false });

function dockTabItems(homeItems) {
  const active = renderDockTabs(OB.settings.customTabs);
  const bar = document.getElementById('bar');
  if (active && OB.settings.layout === 'pill') bar.style.setProperty('--dock-screen-width', screen.width + 'px');
  if (bar.dataset.customTab !== active?.id) {
    if (active) bar.dataset.customTab = active.id; else delete bar.dataset.customTab;
    dockLeft.scrollLeft = 0;
  }
  return active ? active.items : homeItems;
}

function renderDockTabs(tabs) {
  const active = tabs.find((t) => t.id === dockTabId);
  dockTabId = active?.id || null;
  if (!tabs.length) {
    if (dockTabs.isConnected) {
      dockTabs.remove();
      dockLeft.scrollLeft = 0;
    }
    return null;
  }
  if (!dockTabs.isConnected) dockLeft.before(dockTabs);
  const buttons = [{ id: null, name: 'Default widgets' }, ...tabs];
  for (const [index, tab] of buttons.entries()) {
    const isDefault = tab.id === null;
    let button = dockTabs.children[index];
    if (!button) {
      const label = isDefault ? icon('windows', 18) : h('span', { class: 'ellipsis' });
      if (isDefault) label.setAttribute('aria-hidden', 'true');
      button = h('button', { class: 'w', 'aria-label': isDefault ? tab.name : null, onclick: (e) => {
        dockTabId = e.currentTarget.dataset.tab || null;
        if (openPanel) api.invoke('panel:close');
        scheduleRender();
      } }, label);
      dockTabs.append(button);
    }
    button.dataset.tab = tab.id || '';
    button.setAttribute('aria-pressed', String(tab.id === dockTabId));
    button.title = tab.name;
    if (!isDefault && button.firstChild.textContent !== tab.name) button.firstChild.textContent = tab.name;
  }
  while (dockTabs.childElementCount > buttons.length) dockTabs.lastElementChild.remove();
  return active;
}

function dockShortcut(item) {
  return h('button', { class: 'w dock-shortcut', title: item.name, 'data-tab-item': item.id },
    icon(shortcutIcons[item.kind], 16), h('span', { class: 'ellipsis' }, item.name));
}
