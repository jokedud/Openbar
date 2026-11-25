'use strict';

let dockTabId = null;
const dockTabs = h('nav', { id: 'dock-tabs', 'aria-label': 'Dock tabs' });
const shortcutIcons = { app: 'desktop', folder: 'folder', website: 'link' };

function dockTabItems(homeItems) {
  const active = renderDockTabs(OB.settings.customTabs);
  const bar = document.getElementById('bar');
  if (active && OB.settings.layout === 'pill') bar.style.setProperty('--dock-screen-width', screen.width + 'px');
  if (bar.dataset.customTab !== active?.id) {
    if (active) bar.dataset.customTab = active.id; else delete bar.dataset.customTab;
    document.getElementById('left').scrollLeft = 0;
  }
  return active ? active.items : homeItems;
}

function renderDockTabs(tabs) {
  const active = tabs.find((t) => t.id === dockTabId);
  dockTabId = active?.id || null;
  if (!tabs.length) {
    dockTabs.remove();
    return null;
  }
  const left = document.getElementById('left');
  if (!dockTabs.isConnected) left.before(dockTabs);
  const buttons = [{ id: null, name: 'Home' }, ...tabs];
  for (const [index, tab] of buttons.entries()) {
    let button = dockTabs.children[index];
    if (!button) {
      button = h('button', { class: 'w', onclick: (e) => {
        dockTabId = e.currentTarget.dataset.tab || null;
        if (openPanel) api.invoke('panel:close');
        scheduleRender();
      } }, h('span', { class: 'ellipsis' }));
      dockTabs.append(button);
    }
    button.dataset.tab = tab.id || '';
    button.setAttribute('aria-pressed', String(tab.id === dockTabId));
    button.title = tab.name;
    if (button.firstChild.textContent !== tab.name) button.firstChild.textContent = tab.name;
  }
  while (dockTabs.childElementCount > buttons.length) dockTabs.lastElementChild.remove();
  return active;
}

function dockShortcut(item) {
  return h('button', { class: 'w dock-shortcut', title: item.name, 'data-tab-item': item.id },
    icon(shortcutIcons[item.kind], 16), h('span', { class: 'ellipsis' }, item.name));
}
