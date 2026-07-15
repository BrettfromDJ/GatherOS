const PLATFORMS = new Set(['x', 'instagram']);
const MODES = new Set(['catch-up', 'fixed', 'all']);
const STAGES = new Set(['starting', 'scanning', 'saving', 'stopping', 'complete', 'stopped', 'failed']);
const COUNTERS = ['scanned', 'saved', 'known', 'failed'];

function validateSnapshot(value) {
  if (!value || typeof value !== 'object') return 'snapshot must be an object';
  if (typeof value.runId !== 'string' || value.runId.length === 0 || value.runId.length > 200) return 'runId required';
  if (!PLATFORMS.has(value.platform)) return 'invalid platform';
  if (!MODES.has(value.mode)) return 'invalid mode';
  if (!STAGES.has(value.stage)) return 'invalid stage';
  if (!Number.isFinite(value.startedAt) || value.startedAt < 0) return 'invalid startedAt';
  if (!(value.target === null || (Number.isInteger(value.target) && value.target > 0))) return 'invalid target';
  for (const key of COUNTERS) {
    if (!Number.isInteger(value[key]) || value[key] < 0) return `invalid ${key}`;
  }
  if (value.message !== null && typeof value.message !== 'string') return 'invalid message';
  return null;
}

function createSocialImportState({
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onChange = () => {},
} = {}) {
  let active = null;
  let cancelRequested = false;
  let staleTimer = null;
  let lastHeartbeatAt = 0;
  let stalled = false;

  const view = () => (active ? { ...active, cancelRequested, stalled } : null);
  const emit = () => { try { onChange(view()); } catch { /* renderer notification is best effort */ } };
  const armStaleTimer = () => {
    if (staleTimer !== null) clearTimer(staleTimer);
    if (!active || ['complete', 'stopped', 'failed'].includes(active.stage)) return;
    staleTimer = setTimer(() => {
      staleTimer = null;
      if (!active || now() - lastHeartbeatAt < 30_000) return;
      stalled = true;
      emit();
    }, Math.max(0, 30_000 - (now() - lastHeartbeatAt)));
    if (staleTimer && typeof staleTimer.unref === 'function') staleTimer.unref();
  };

  function update(snapshot) {
    const error = validateSnapshot(snapshot);
    if (error) return { ok: false, error };
    if (!active) {
      if (snapshot.stage !== 'starting') return { ok: false, error: 'run must start with starting stage' };
    } else if (snapshot.stage === 'starting' && ['complete', 'stopped', 'failed'].includes(active.stage)) {
      cancelRequested = false;
      active = null;
    } else if (snapshot.runId !== active.runId) {
      return { ok: false, error: 'runId mismatch' };
    }
    for (const key of COUNTERS) {
      if (active && snapshot[key] < active[key]) return { ok: false, error: `${key} cannot decrease` };
    }
    active = { ...snapshot };
    lastHeartbeatAt = now();
    stalled = false;
    if (snapshot.stage === 'starting') cancelRequested = false;
    if (['complete', 'stopped', 'failed'].includes(snapshot.stage)) {
      if (staleTimer !== null) clearTimer(staleTimer);
    } else {
      armStaleTimer();
    }
    emit();
    return { ok: true, cancelRequested };
  }

  function cancel(runId) {
    if (!active || active.runId !== runId || ['complete', 'stopped', 'failed'].includes(active.stage)) {
      return { ok: false, error: 'run not active' };
    }
    cancelRequested = true;
    if (active.stage !== 'stopping') active = { ...active, stage: 'stopping', message: active.message || 'Stopping…' };
    emit();
    return { ok: true, cancelRequested: true };
  }

  function dismiss(runId) {
    if (!active || active.runId !== runId || !['complete', 'stopped', 'failed'].includes(active.stage)) {
      return { ok: false, error: 'not dismissible' };
    }
    active = null;
    cancelRequested = false;
    emit();
    return { ok: true };
  }

  return { update, cancel, dismiss, get: view, validateSnapshot };
}

module.exports = { createSocialImportState, validateSnapshot };
