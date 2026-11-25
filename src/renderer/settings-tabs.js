'use strict';

let editingTab = null;
const TAB_SHORTCUTS = { app: 'App', website: 'Website', folder: 'Folder' };

function drawCustomTabs(m) {
  const tabs = S().customTabs;
  const active = tabs.find((t) => t.id === editingTab) || tabs[0];
  editingTab = active?.id;
  const update = (next) => save({ customTabs: next }).then(draw);
  const edit = (patch) => update(S().customTabs.map((t) => t.id === active.id ? { ...t, ...patch(t) } : t));
  const append = (item) => edit((t) => ({ items: [...t.items, { id: crypto.randomUUID(), ...item }] }));
  const move = (list, from, to) => {
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };
  const action = (title, fn, content, disabled = false) => h('button', {
    class: 'btn icon', type: 'button', title, 'aria-label': title, disabled, onclick: fn,
  }, content);
  const nameForm = (value, button, submit) => {
    const name = h('input', { type: 'text', value, required: true, maxlength: 48, placeholder: 'e.g. Work', 'aria-label': 'Tab name' });
    return h('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      if (name.value.trim()) submit(name.value.trim());
    } }, name, h('button', { class: 'btn' }, button));
  };
  m.append(h('h1', {}, 'Custom tabs'), h('p', { class: 'lead' }, 'Create spaces for work, games, or anything else. Choose a tab on the dock to show its items on the left. Home brings back your usual widgets.'));
  m.append(h('h2', {}, 'Add a tab'), nameForm('', 'Add tab', (name) => {
    editingTab = crypto.randomUUID();
    update([...tabs, { id: editingTab, name, items: [] }]);
  }));
  if (!active) return;

  const idx = tabs.indexOf(active);
  const picker = sel(tabs.map((t) => [t.id, t.name]), editingTab, (id) => { editingTab = id; draw(); });
  picker.setAttribute('aria-label', 'Select tab to edit');
  m.append(h('h2', {}, 'Edit a tab'), h('div', { class: 'row' }, picker,
    action('Move tab left', () => update(move(tabs, idx, idx - 1)), '←', idx === 0),
    action('Move tab right', () => update(move(tabs, idx, idx + 1)), '→', idx === tabs.length - 1),
    action('Remove tab', () => {
      if (confirm(`Remove “${active.name}” and its items?`)) update(tabs.filter((t) => t.id !== active.id));
    }, icon('trash', 14))), h('div', { class: 'field' }, nameForm(active.name, 'Rename tab', (name) => edit(() => ({ name })))));

  const items = active.items;
  m.append(h('h2', {}, 'Tab items'));
  if (!items.length) m.append(h('p', { class: 'hint' }, 'This tab is empty. Add a widget or a shortcut below.'));
  else m.append(h('div', { class: 'list' }, ...items.map((item, i) => {
    const name = item.kind === 'widget' ? (WIDGETS[item.widget] || item.widget) : item.name;
    return h('div', { class: 'li' },
      h('div', { class: 'grow ellipsis' }, name, item.target ? h('div', { class: 'hint ellipsis', title: item.target }, `${TAB_SHORTCUTS[item.kind]} · ${item.target}`) : null),
      action(`Move ${name} up`, () => edit(() => ({ items: move(items, i, i - 1) })), '↑', i === 0),
      action(`Move ${name} down`, () => edit(() => ({ items: move(items, i, i + 1) })), '↓', i === items.length - 1),
      action(`Remove ${name}`, () => edit((t) => ({ items: t.items.filter((x) => x.id !== item.id) })), icon('trash', 14)));
  })));
  const available = Object.entries(WIDGETS).filter(([key]) => key === 'sep' || !items.some((i) => i.widget === key));
  const widgets = sel(available, available[0][0], () => {});
  widgets.setAttribute('aria-label', 'Widget to add');
  m.append(h('div', { class: 'row' }, widgets, h('button', {
    class: 'btn', onclick: () => append({ kind: 'widget', widget: widgets.value }),
  }, 'Add widget')));

  m.append(h('h2', {}, 'Add a shortcut'), shortcutForm(append));
}

function shortcutForm(append) {
  const name = h('input', { type: 'text', required: true, maxlength: 48, placeholder: 'Shortcut name', 'aria-label': 'Shortcut name' });
  const target = h('input', { type: 'text', required: true, placeholder: 'https://example.com', 'aria-label': 'Shortcut URL or path' });
  const error = h('p', { class: 'hint bad', role: 'alert' });
  const browse = h('button', { class: 'btn', type: 'button', style: { display: 'none' }, onclick: async () => {
    const selectedKind = kind.value;
    const chosen = await api.invoke('tabs:browse', selectedKind);
    if (!chosen || selectedKind !== kind.value) return;
    target.value = chosen;
    if (!name.value.trim()) name.value = chosen.split(/[\\/]/).filter(Boolean).pop().replace(/\.(exe|lnk|appref-ms)$/i, '').slice(0, 48);
  } }, 'Browse…');
  const kind = sel(Object.entries(TAB_SHORTCUTS), 'website', (value) => {
    target.value = '';
    target.placeholder = value === 'website' ? 'https://example.com' : 'Absolute Windows path';
    browse.style.display = value === 'website' ? 'none' : '';
    error.textContent = '';
  });
  kind.setAttribute('aria-label', 'Shortcut type');
  const submit = h('button', { class: 'btn' }, 'Add shortcut');
  return h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const type = kind.value, label = name.value.trim();
    if (!label) { error.textContent = 'Enter a shortcut name.'; return; }
    submit.disabled = true;
    try {
      const validTarget = await api.invoke('tabs:target', type, target.value);
      if (validTarget) await append({ kind: type, name: label, target: validTarget });
      else error.textContent = type === 'website' ? 'Enter a complete http:// or https:// URL.' : 'Choose a target or enter a full Windows path.';
    } finally { submit.disabled = false; }
  } },
  h('div', { class: 'row', style: { flexWrap: 'wrap' } }, kind, name, target, browse, submit), error);
}
