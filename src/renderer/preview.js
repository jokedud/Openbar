'use strict';

const surface = document.getElementById('preview');
const listEl = document.getElementById('list');
let currentPayload = null;

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
      api.invoke('preview:action', win.hwnd, 'close');
    },
  }, icon('x', 12));
}

function attachCardEvents(node, win) {
  node.addEventListener('click', () => api.invoke('preview:action', win.hwnd, 'focus'));
  node.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      api.invoke('preview:action', win.hwnd, 'close');
    }
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.invoke('preview:context-menu', win.hwnd);
  });
}

function renderPreview(payload) {
  currentPayload = payload;
  const wins = payload?.windows || [];
  const compact = !!payload?.compact;
  surface.classList.toggle('compact', compact);

  if (!payload?.switching) {
    surface.classList.remove('enter');
    void surface.offsetWidth;
    surface.classList.add('enter');
  }

  const nodes = wins.map((win) => {
    if (compact) {
      const row = h('div', {
        class: `preview-row ${win.active ? 'active' : ''} ${win.minimized ? 'minimized' : ''}`,
        title: win.title,
      },
      appIconNode(win),
      h('span', { class: 'preview-title' }, win.title || win.exe || 'Window'),
      win.minimized ? h('span', { class: 'preview-tag' }, 'Min') : null,
      closeButton(win));
      attachCardEvents(row, win);
      return row;
    }

    const thumb = h('div', { class: 'preview-thumb', 'data-hwnd': String(win.hwnd) },
      win.icon ? h('img', { class: 'preview-fallback', src: win.icon, draggable: 'false' }) : null);
    const card = h('div', {
      class: `preview-card ${win.active ? 'active' : ''} ${win.minimized ? 'minimized' : ''} ${payload.hasLiveThumbnails ? 'live' : ''}`,
      'aria-label': win.title || win.exe || 'Window',
    },
    h('div', { class: 'preview-head' },
      appIconNode(win),
      h('span', { class: 'preview-title' }, win.title || win.exe || 'Window'),
      win.minimized ? h('span', { class: 'preview-tag' }, 'Min') : null,
      closeButton(win)),
    thumb);
    attachCardEvents(card, win);
    return card;
  });

  listEl.replaceChildren(...nodes);
  requestAnimationFrame(reportThumbnailSlots);
}

surface.addEventListener('mouseenter', () => api.send('preview:enter-surface'));
surface.addEventListener('mouseleave', () => api.send('preview:leave-surface'));

OB.init().then(() => {
  observeSurface(surface);
  new ResizeObserver(reportThumbnailSlots).observe(listEl);
  api.on('preview:data', renderPreview);
});
