'use strict';

const NOTIF_PALETTE = [
  '#4e93ff', '#6c7bff', '#a864ff', '#e05fa0',
  '#f07148', '#e5a130', '#38b57c', '#2ea8c4',
];

function notifAccent(appName) {
  let hash = 0;
  const s = String(appName || 'W');
  for (let i = 0; i < s.length; i++) hash = ((hash * 31) + s.charCodeAt(i)) | 0;
  return NOTIF_PALETTE[Math.abs(hash) % NOTIF_PALETTE.length];
}

function formatNotifTime(arrivalMs, now = Date.now()) {
  if (!Number.isFinite(arrivalMs) || arrivalMs <= 0) return '';
  const diffSec = Math.max(0, Math.round((now - arrivalMs) / 1000));
  if (diffSec < 45) return 'Just now';
  if (diffSec < 3600) return `${Math.max(1, Math.round(diffSec / 60))}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  const days = Math.round(diffSec / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(arrivalMs).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function mountNotificationsPanel(body, setHead) {
  let stopped = false;
  let lastKey = null;
  const initialState = OB.state.notifications || { status: 'unavailable', items: [], unread: 0 };
  const highlightedUnread = new Set((initialState.items || []).filter((item) => item.unread).map((item) => item.id));

  const root = h('section', { class: 'notif-content' });
  const listWrap = h('div', { class: 'notif-list', role: 'list', 'aria-label': 'Recent Windows notifications' });
  const emptyWrap = h('div', { class: 'notif-empty', hidden: true });
  const footer = h('div', { class: 'notif-footer' });

  const openTarget = async (target, closeAfter = false) => {
    const ok = await api.invoke('notifications:open', target).catch(() => false);
    if (ok && closeAfter) api.invoke('panel:close');
  };

  if (OB.platform === 'win32') {
    footer.append(
      h('button', { class: 'btn', type: 'button', onclick: () => openTarget('center', true) }, icon('bell', 13), 'Notification center'),
      h('button', { class: 'btn', type: 'button', onclick: () => openTarget('settings', true) }, icon('settings', 13), 'Settings'),
    );
  } else {
    footer.hidden = true;
  }

  root.append(listWrap, emptyWrap, footer);
  body.append(root);

  function renderHeader(items) {
    const actions = [];
    if (items.length > 0) {
      actions.push(h('button', {
        class: 'btn notif-clear-btn',
        type: 'button',
        title: 'Clear all notifications',
        onclick: () => api.invoke('notifications:clear'),
      }, 'Clear all'));
    }
    actions.push(actionBtn('refresh', 'Refresh notifications', () => api.invoke('notifications:refresh')));
    if (OB.platform === 'win32') {
      actions.push(actionBtn('settings', 'Windows notification settings', () => openTarget('settings', true)));
    }
    setHead('Notifications', ...actions);
  }

  function renderEmpty(status) {
    listWrap.hidden = true;
    emptyWrap.hidden = false;
    const isUnsupported = status === 'unsupported';
    const isUnavailable = status === 'unavailable';
    const heading = isUnsupported
      ? 'Windows notifications only'
      : isUnavailable ? 'Notifications unavailable' : 'All caught up';
    const copy = isUnsupported
      ? 'Recent notification history is available on Windows 10 and 11.'
      : isUnavailable
        ? 'Windows notification history was not found on this PC.'
        : 'No recent Windows notifications.';
    emptyWrap.replaceChildren(
      h('div', { class: 'notif-empty-emblem', 'aria-hidden': 'true' }, icon('bell', 24)),
      h('strong', {}, heading),
      h('p', { class: 'muted' }, copy),
    );
  }

  function buildCard(item) {
    const isNew = item.unread || highlightedUnread.has(item.id);
    const clickable = !!item.launchUrl;
    const color = notifAccent(item.app);
    const initial = (item.app || 'W').trim().charAt(0).toUpperCase();
    const dismissBtn = h('button', {
      class: 'notif-dismiss',
      type: 'button',
      title: 'Dismiss',
      'aria-label': `Dismiss ${item.title}`,
      onclick: (e) => {
        e.stopPropagation();
        highlightedUnread.delete(item.id);
        api.invoke('notifications:dismiss', item.id);
      },
    }, icon('x', 12));

    const meta = h('div', { class: 'notif-meta' },
      h('span', { class: 'notif-app ellipsis' }, item.app),
      isNew ? h('span', { class: 'notif-unread-dot', title: 'New' }) : null,
      h('span', { class: 'notif-time' }, formatNotifTime(item.arrivalMs)),
    );

    const card = h('article', {
      class: `notif-card ${isNew ? 'is-new' : ''} ${clickable ? 'is-clickable' : ''}`,
      role: 'listitem',
      'data-notif-id': item.id,
      tabindex: clickable ? '0' : null,
      onclick: clickable ? () => openTarget(item.launchUrl, true) : null,
      onkeydown: clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTarget(item.launchUrl, true); } } : null,
    },
      h('div', { class: 'notif-avatar', style: { background: color }, 'aria-hidden': 'true' }, initial),
      h('div', { class: 'notif-body' },
        meta,
        h('div', { class: 'notif-title' }, item.title),
        item.body ? h('div', { class: 'notif-text' }, item.body) : null,
      ),
      dismissBtn,
    );
    return card;
  }

  function render(next) {
    if (stopped) return;
    const state = next || { status: 'unavailable', items: [], unread: 0 };
    const items = Array.isArray(state.items) ? state.items : [];
    renderHeader(items);
    const key = JSON.stringify({ status: state.status, items: items.map((i) => [i.id, i.title, i.body, i.arrivalMs, i.unread || highlightedUnread.has(i.id)]) });
    if (key === lastKey) return;
    lastKey = key;

    if (state.status !== 'ready' || items.length === 0) {
      renderEmpty(state.status);
      return;
    }
    emptyWrap.hidden = true;
    listWrap.hidden = false;
    listWrap.replaceChildren(...items.map(buildCard));
  }

  const unsubscribe = OB.on((kind, patch) => {
    if (kind === 'state' && patch && 'notifications' in patch) {
      for (const item of patch.notifications?.items || []) {
        if (item.unread) highlightedUnread.add(item.id);
      }
      render(patch.notifications);
    }
  });

  render(initialState);
  if (initialState.unread > 0) {
    api.invoke('notifications:mark-read').catch(() => {});
  }
  api.invoke('notifications:refresh').then((fresh) => {
    if (stopped || !fresh) return;
    for (const item of fresh.items || []) {
      if (item.unread) highlightedUnread.add(item.id);
    }
    render(fresh);
    if (fresh.unread > 0) api.invoke('notifications:mark-read').catch(() => {});
  }).catch(() => {});

  return () => {
    stopped = true;
    unsubscribe();
  };
}
