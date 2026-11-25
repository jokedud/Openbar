'use strict';

const surface = document.getElementById('preview');
const listEl = document.getElementById('list');
let currentPayload = null;
let renderedCompact = null;

function layoutRect(el) {
  let x = 0, y = 0;
  let cur = el;
  while (cur) {
    x += cur.offsetLeft - cur.scrollLeft;
    y += cur.offsetTop - cur.scrollTop;
    cur = cur.offsetParent;
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

function reportThumbnailSlots() {
  if (!currentPayload || currentPayload.compact || !currentPayload.hasLiveThumbnails) {
    api.send('preview:slots', []);
    return;
  }
  const slots = [];
  for (const el of listEl.querySelectorAll('.preview-thumb[data-hwnd]')) {
    const r = layoutRect(el);
    if (r.width > 2 && r.height > 2) {
      slots.push({
        hwnd: Number(el.dataset.hwnd),
        x: r.x + 1,
        y: r.y + 1,
        width: r.width - 2,
        height: r.height - 2,
      });
    }
  }
  api.send('preview:slots', slots);
}

function appIconNode(win) {
  if (win.icon) return h('img', { class: 'preview-icon', src: win.icon, draggable: 'false' });
  const ch = (win.exe || win.title || '?').trim().charAt(0).toUpperCase() || '?';
  return h('span', { class: 'preview-ph' }, ch);
}

function closeButton(win) {
  return h('button', {
    class: 'preview-close',
    title: 'Close window',
    'aria-label': `Close ${win.title || 'window'}`,
    onClick: (e) => {
      e.stopPropagation();
      api.send('preview:peek', 0);
      const card = e.currentTarget.closest('[data-hwnd]');
      api.invoke('preview:action', Number(card?.dataset.hwnd || win.hwnd), 'close');
    },
  }, icon('x', 12));
}

function attachCardEvents(node) {
  node.addEventListener('mouseenter', () => {
    const hwnd = Number(node.dataset.hwnd);
    if (hwnd > 0) api.send('preview:peek', hwnd);
  });
  node.addEventListener('mouseleave', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest?.('.preview-card, .preview-row')) {
      api.send('preview:peek', 0);
    }
  });
  node.addEventListener('click', (e) => {
    if (e.target.closest('.preview-close')) return;
    api.send('preview:peek', 0);
    api.invoke('preview:action', Number(node.dataset.hwnd), 'focus');
  });
  node.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      api.send('preview:peek', 0);
      api.invoke('preview:action', Number(node.dataset.hwnd), 'close');
    }
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.send('preview:peek', 0);
    api.invoke('preview:context-menu', Number(node.dataset.hwnd));
  });
}

function createItemNode(win, compact, hasLiveThumbnails) {
  const titleText = win.title || win.exe || 'Window';
  if (compact) {
    const row = h('div', {
      class: `preview-row ${win.active ? 'active' : ''} ${win.minimized ? 'minimized' : ''}`,
      'data-hwnd': String(win.hwnd),
      title: win.title,
    },
    appIconNode(win),
    h('span', { class: 'preview-title' }, titleText),
    h('span', { class: 'preview-tag', style: { display: win.minimized ? '' : 'none' } }, 'Min'),
    closeButton(win));
    attachCardEvents(row);
    return row;
  }

  const thumb = h('div', { class: 'preview-thumb', 'data-hwnd': String(win.hwnd) },
    win.icon ? h('img', { class: 'preview-fallback', src: win.icon, draggable: 'false' }) : null);
  const card = h('div', {
    class: `preview-card ${win.active ? 'active' : ''} ${win.minimized ? 'minimized' : ''} ${hasLiveThumbnails ? 'live' : ''}`,
    'data-hwnd': String(win.hwnd),
    'aria-label': titleText,
  },
  h('div', { class: 'preview-head' },
    appIconNode(win),
    h('span', { class: 'preview-title' }, titleText),
    h('span', { class: 'preview-tag', style: { display: win.minimized ? '' : 'none' } }, 'Min'),
    closeButton(win)),
  thumb);
  attachCardEvents(card);
  return card;
}

function patchItemNode(node, win, compact, hasLiveThumbnails) {
  const titleText = win.title || win.exe || 'Window';
  node.classList.toggle('active', !!win.active);
  node.classList.toggle('minimized', !!win.minimized);
  if (compact) {
    if (node.title !== (win.title || '')) node.title = win.title || '';
  } else {
    node.classList.toggle('live', !!hasLiveThumbnails);
    if (node.getAttribute('aria-label') !== titleText) node.setAttribute('aria-label', titleText);
  }
  const titleEl = node.querySelector('.preview-title');
  if (titleEl && titleEl.textContent !== titleText) titleEl.textContent = titleText;
  const tagEl = node.querySelector('.preview-tag');
  if (tagEl) tagEl.style.display = win.minimized ? '' : 'none';
  const closeEl = node.querySelector('.preview-close');
  const closeLabel = `Close ${win.title || 'window'}`;
  if (closeEl && closeEl.getAttribute('aria-label') !== closeLabel) closeEl.setAttribute('aria-label', closeLabel);
  if (win.icon) {
    const iconEl = node.querySelector('.preview-icon');
    if (iconEl) {
      if (iconEl.getAttribute('src') !== win.icon) iconEl.setAttribute('src', win.icon);
    } else {
      const ph = node.querySelector('.preview-ph');
      if (ph) ph.replaceWith(appIconNode(win));
    }
  }
}

function renderPreview(payload) {
  const prevPayload = currentPayload;
  currentPayload = payload;
  const wins = payload?.windows || [];
  const compact = !!payload?.compact;
  const hasLive = !!payload?.hasLiveThumbnails;
  surface.classList.toggle('compact', compact);

  if (!payload?.switching) {
    surface.classList.remove('enter');
    void surface.offsetWidth;
    surface.classList.add('enter');
  }

  const existing = new Map();
  if (renderedCompact === compact) {
    for (const child of listEl.children) {
      if (child.dataset?.hwnd) existing.set(child.dataset.hwnd, child);
    }
  }

  const desired = wins.map((win) => {
    const key = String(win.hwnd);
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
      patchItemNode(node, win, compact, hasLive);
    } else {
      node = createItemNode(win, compact, hasLive);
    }
    return node;
  });

  for (const stale of existing.values()) stale.remove();
  if (renderedCompact !== compact) {
    listEl.replaceChildren(...desired);
  } else {
    desired.forEach((node, i) => {
      const cur = listEl.children[i];
      if (cur !== node) listEl.insertBefore(node, cur || null);
    });
  }
  renderedCompact = compact;

  const prevKeys = (prevPayload?.windows || []).map((w) => w.hwnd).join(',');
  const nextKeys = wins.map((w) => w.hwnd).join(',');
  if (!payload?.switching || !prevPayload || prevPayload.compact !== compact || prevPayload.hasLiveThumbnails !== hasLive || prevKeys !== nextKeys) {
    requestAnimationFrame(reportThumbnailSlots);
  }
}

surface.addEventListener('mouseenter', () => api.send('preview:enter-surface'));
surface.addEventListener('mouseleave', () => {
  api.send('preview:peek', 0);
  api.send('preview:leave-surface');
});

OB.init().then(() => {
  observeSurface(surface);
  new ResizeObserver(reportThumbnailSlots).observe(listEl);
  api.on('preview:data', renderPreview);
});
