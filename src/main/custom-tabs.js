'use strict';
const path = require('path');

function label(value) {
  return typeof value === 'string' ? value.trim().slice(0, 48) : '';
}

function shortcutTarget(kind, value) {
  if (typeof value !== 'string' || /[\x00-\x1f]/.test(value)) return null;
  const target = value.trim();
  if (kind === 'website' && /^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      return url.hostname && !url.username && !url.password ? url.href : null;
    } catch (_) { return null; }
  }
  if (kind !== 'app' && kind !== 'folder') return null;
  if (!/^(?:[a-z]:[\\/]|\\\\[^?.\\/][^\\/]*[\\/][^\\/]+)/i.test(target)) return null;
  if (kind === 'app' && !/\.(exe|lnk|appref-ms)$/i.test(path.win32.basename(target))) return null;
  return target;
}

function uniqueEntries(values, convert) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    if (!value || typeof value.id !== 'string' || !/^[\w-]{1,64}$/.test(value.id) || seen.has(value.id)) return [];
    const entry = convert(value);
    if (!entry) return [];
    seen.add(value.id);
    return [{ id: value.id, ...entry }];
  });
}

function normalizeCustomTabs(tabs) {
  return uniqueEntries(tabs, (tab) => {
    const name = label(tab.name);
    if (!name) return null;
    const items = uniqueEntries(tab.items, (item) => {
      if (item.kind === 'widget' && typeof item.widget === 'string' && /^[a-z]+$/i.test(item.widget)) {
        return { kind: 'widget', widget: item.widget };
      }
      const name = label(item.name);
      const target = shortcutTarget(item.kind, item.target);
      return name && target ? { kind: item.kind, name, target } : null;
    });
    return { name, items };
  });
}

module.exports = { normalizeCustomTabs, shortcutTarget };
