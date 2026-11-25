'use strict';

let dockTabId = null;
const dockTabs = h('nav', { id: 'dock-tabs', 'aria-label': 'Dock tabs' });
const shortcutIcons = { app: 'desktop', folder: 'folder', website: 'link' };
const dockLeft = document.getElementById('left');
let tabStrip, tabFolder;

function folderButton(label, onclick) {
  const button = h('button', { class: 'w dock-folder', 'aria-label': label, 'aria-haspopup': 'dialog', title: label, onclick },
    h('span', { class: 'folder-preview', 'aria-hidden': 'true' }),
    h('span', { class: 'folder-count', 'aria-hidden': 'true' }));
  button.hidden = true;
  return button;
}

function clippedTiles(strip) {
  return [...strip.children].filter((tile) => tile.offsetLeft < strip.scrollLeft ||
    tile.offsetLeft + tile.offsetWidth > strip.scrollLeft + strip.clientWidth);
}

function updateFolder(button, strip, container, panel, preview) {
  const hidden = strip.scrollWidth <= container.clientWidth;
  if (button.hidden !== hidden) button.hidden = hidden;
  const expanded = openPanel === panel;
  button.classList.toggle('open', expanded);
  button.setAttribute('aria-expanded', String(expanded));
  if (button.hidden) return;
  const items = clippedTiles(strip).filter((tile) => tile.matches('button'));
  const icons = items.slice(0, 4).map(preview);
  const signature = JSON.stringify([items.length, icons.map((el) => el.outerHTML)]);
  if (button.dataset.preview === signature) return;
  button.dataset.preview = signature;
  button.firstElementChild.replaceChildren(...icons);
  button.lastElementChild.textContent = items.length > 4 ? `+${items.length - 4}` : '';
}

function updateTabFolder() {
  if (!tabFolder || !dockTabs.isConnected) return;
  updateFolder(tabFolder, tabStrip, dockTabs, 'tabOverflow', (tab) =>
    tab.dataset.tab ? h('span', { class: 'folder-initial' }, tab.title[0]) : icon('windows', 12));
}

document.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.deltaX || !e.deltaY) return;
  let strip = e.target.closest('.widget-strip, .zone, #dock-tabs');
  if (strip?.id === 'dock-tabs') strip = tabStrip;
  if (strip?.classList.contains('widget-strip') && strip.scrollWidth <= strip.clientWidth) strip = strip.closest('.zone');
  if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? strip.clientWidth : 1;
  strip.scrollLeft += e.deltaY * unit;
}, { passive: false });

function dockTabItems(homeItems) {
  const active = renderDockTabs(OB.settings.customTabs);
  const bar = document.getElementById('bar');
  if (bar.dataset.customTab !== active?.id) {
    if (active) bar.dataset.customTab = active.id; else delete bar.dataset.customTab;
    resetDockLeftScroll();
  }
  return active ? active.items : homeItems;
}

function renderDockTabs(tabs) {
  const active = tabs.find((t) => t.id === dockTabId);
  dockTabId = active?.id || null;
  if (!tabs.length) {
    if (dockTabs.isConnected) {
      dockTabs.remove();
      resetDockLeftScroll();
    }
    return null;
  }
  if (!tabStrip) {
    tabStrip = h('div', { class: 'tab-strip', onscroll: updateTabFolder });
    tabFolder = folderButton('More tabs', (e) => {
      const items = clippedTiles(tabStrip).map((tab) => ({ id: tab.dataset.tab }));
      if (items.length) return api.invoke('panel:toggle', 'tabOverflow', centerX(e.currentTarget), items);
    });
    tabFolder.classList.add('tab-more');
    dockTabs.append(tabStrip, tabFolder);
  }
  if (!dockTabs.isConnected) dockLeft.before(dockTabs);
  const buttons = [{ id: null, name: 'Default widgets' }, ...tabs];
  for (const [index, tab] of buttons.entries()) {
    const isDefault = tab.id === null;
    let button = tabStrip.children[index];
    if (!button) {
      const label = isDefault ? icon('windows', 18) : h('span', { class: 'ellipsis' });
      if (isDefault) label.setAttribute('aria-hidden', 'true');
      button = h('button', { class: 'w', 'aria-label': isDefault ? tab.name : null,
        onclick: (e) => selectDockTab(e.currentTarget.dataset.tab) }, label);
      tabStrip.append(button);
    }
    button.dataset.tab = tab.id || '';
    button.setAttribute('aria-pressed', String(tab.id === dockTabId));
    button.title = tab.name;
    if (!isDefault && button.firstChild.textContent !== tab.name) button.firstChild.textContent = tab.name;
  }
  while (tabStrip.childElementCount > buttons.length) tabStrip.lastElementChild.remove();
  return active;
}

function selectDockTab(id) {
  dockTabId = id || null;
  if (openPanel) api.invoke('panel:close');
  scheduleRender();
}

function resetDockLeftScroll() {
  dockLeft.scrollLeft = 0;
  for (const strip of dockLeft.querySelectorAll('.widget-strip')) strip.scrollLeft = 0;
}

function dockShortcut(item) {
  return h('button', { class: 'w dock-shortcut', title: item.name, 'data-tab-item': item.id },
    icon(shortcutIcons[item.kind], 16), h('span', { class: 'ellipsis' }, item.name));
}
