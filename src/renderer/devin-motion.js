'use strict';
(() => {
  const LOCAL_ACTIVITY_MS = 30000;
  const DROP_MS = 780;
  const HOLD_MS = 3600;
  const FRAME_MS = 125;
  const FOCUS_STOPS = [[.42, .39], [.62, .55], [.49, .64], [.34, .48]];

  function isWorking(status) {
    return ['running', 'working', 'resuming'].includes(status?.toLowerCase());
  }

  function activeSession(local, cloud, now) {
    const cloudIds = new Set(cloud.map(({ id }) => id));
    const live = cloud.filter(({ status }) => isWorking(status)).concat(local.filter(({ id, updatedAt }) =>
      !cloudIds.has(id) && updatedAt != null && updatedAt <= now && now - updatedAt < LOCAL_ACTIVITY_MS));
    return live.reduce((latest, session) => !latest || (session.updatedAt || 0) > (latest.updatedAt || 0)
      ? session : latest, null)?.id ?? null;
  }

  function cursorTransition(next, phase) {
    if (!next.cursor) return 'off';
    if (next.working) return 'work';
    if (phase === 'work') return 'drop';
    if (phase === 'drop' || phase === 'hold') return phase;
    return 'off';
  }

  function focusStop(elapsed) {
    return FOCUS_STOPS[Math.floor(Math.max(0, elapsed) / 4800) % FOCUS_STOPS.length];
  }

  const motion = { activeSession, cursorTransition, focusStop, DROP_MS, HOLD_MS, FRAME_MS };
  if (typeof module === 'object') module.exports = motion;
  else window.devinMotion = motion;
})();
