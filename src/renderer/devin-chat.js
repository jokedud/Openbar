'use strict';

const devinChatErrors = {
  install: ['Install Devin CLI', 'OpenBar uses Devin CLI for local chats and desktop actions.'],
  login: ['Sign in to Devin CLI', 'Run devin auth login in a terminal, then check again.'],
  unavailable: ['Could not reach Devin CLI', 'Check that the CLI is up to date, then try again.'],
  stopped: ['Chat stopped', 'Your next message starts a new Devin session.'],
};
let stopDevinChatUpdates;

function mountDevinChat(body, back) {
  stopDevinChatUpdates?.();
  const invoke = (action, ...args) => api.invoke(`devin:chat-${action}`, ...args);
  const head = h('div', { class: 'devin-chat-kicker' }, icon('devin', 14), 'LOCAL CHAT');
  const status = h('div', { class: 'devin-chat-status muted', role: 'status' });
  const timeline = h('div', { class: 'devin-chat-timeline', role: 'log', 'aria-label': 'Chat messages' });
  const approval = h('div', { class: 'devin-chat-approval', hidden: true });
  const entry = h('textarea', { rows: 2, maxlength: 4000, placeholder: 'Message Devin…', 'aria-label': 'Message Devin' });
  const send = h('button', { class: 'btn primary', type: 'submit' }, 'Send');
  const stop = h('button', { class: 'btn', type: 'button', onclick: () => invoke('stop'), hidden: true }, 'Stop');
  const compose = h('form', { class: 'devin-chat-compose', onsubmit: (e) => {
    e.preventDefault();
    const text = entry.value.trim();
    if (!text || send.disabled) return;
    entry.value = '';
    send.disabled = true;
    invoke('send', text).catch(() => paint({ error: 'unavailable' }));
  } }, entry, send, stop);
  entry.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    compose.requestSubmit();
  });
  const disclaimer = h('div', { class: 'devin-chat-notice' },
    h('strong', {}, 'You’re in control'),
    'Approved screenshots may be sent to the model. Devin CLI runs with your Windows account’s permissions. OpenBar asks before using its desktop tools.');
  const root = h('section', { class: 'devin-content devin-chat' }, head, status, disclaimer, timeline, approval, compose);
  body.append(root);
  setHead('Chat with Devin', h('button', { class: 'btn', onclick: async () => {
    await invoke('stop').catch(() => {});
    back();
  } }, 'Sessions'), actionBtn('plus', 'Start a new chat', async () => {
    entry.value = '';
    await invoke('reset').catch(() => {});
    check();
  }));

  let approvalId, focusedEntry = false;
  function check() {
    paint({ checking: true });
    invoke('status').then((state) => paint(state || { error: 'unavailable' })).catch(() => paint({ error: 'unavailable' }));
  }
  function paint({ messages = [], busy, checking, error, approval: pending, grants } = {}) {
    const setup = ['install', 'login'].includes(error);
    const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 40;
    timeline.hidden = !messages.length;
    disclaimer.hidden = messages.length > 0;
    timeline.replaceChildren(...messages.map(({ role, text }) =>
      h('div', { class: `devin-chat-message ${role}` }, h('div', { class: 'devin-chat-speaker' }, role === 'user' ? 'You' : 'Devin'),
        h('div', {}, text || 'Thinking…'))));
    if (nearBottom) timeline.scrollTop = timeline.scrollHeight;
    status.replaceChildren();
    if (checking) status.append('Checking Devin CLI…');
    else if (error) {
      const [title, detail] = devinChatErrors[error] || devinChatErrors.unavailable;
      status.append(h('strong', {}, title), h('div', {}, detail));
      if (setup || error === 'unavailable') status.append(h('div', { class: 'devin-chat-actions' },
        error === 'install' ? h('button', { class: 'btn primary', onclick: () => api.invoke('open', 'https://docs.devin.ai/cli') }, 'Installation guide') : null,
        h('button', { class: 'btn', onclick: check }, 'Check again')));
    } else if (grants) {
      status.append(`${grants} desktop permission${grants === 1 ? '' : 's'} allowed for this session`,
        h('button', { class: 'btn', onclick: () => invoke('stop') }, 'End session'));
    }
    status.hidden = !status.childNodes.length;
    compose.hidden = setup || !!checking;
    entry.disabled = !!busy;
    send.disabled = !!busy;
    send.hidden = !!busy;
    stop.hidden = !busy;
    if (!compose.hidden && !busy && !focusedEntry) {
      focusedEntry = true;
      requestAnimationFrame(() => { if (root.isConnected && document.hasFocus()) entry.focus(); });
    }
    approval.hidden = !pending;
    root.classList.toggle('confirming', !!pending);
    if (approvalId !== pending?.id) {
      approvalId = pending?.id;
      approval.replaceChildren();
      if (pending) {
        const choice = (label, decision, primary) => h('button', {
          class: primary ? 'btn primary' : 'btn', onclick: () => invoke('approve', pending.id, decision),
        }, label);
        approval.append(h('div', { class: 'devin-chat-kicker' }, 'DESKTOP PERMISSION'),
          h('strong', {}, pending.label), h('p', {}, pending.detail),
          h('div', { class: 'devin-chat-actions' },
            choice('Deny', 'deny'), choice('Allow once', 'once', true), choice('Allow for this session', 'session')),
          h('small', { class: 'muted' }, 'Session access applies only to this action type.'));
      }
    }
  }
  stopDevinChatUpdates = api.on('devin:chat-update', (state) => { if (root.isConnected) paint(state); });
  check();
}
