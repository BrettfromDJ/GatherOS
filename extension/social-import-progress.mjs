const HOST_NAME = 'co.gatheros.host';
const STAGES = new Set(['starting', 'scanning', 'saving', 'stopping', 'complete', 'stopped', 'failed']);

export function createSocialImportProgress({
  sendNativeMessage,
  hostName = HOST_NAME,
  randomUUID = () => globalThis.crypto.randomUUID(),
  log = () => {},
} = {}) {
  if (typeof sendNativeMessage !== 'function') throw new TypeError('sendNativeMessage required');
  if (typeof randomUUID !== 'function') throw new TypeError('randomUUID required');
  let snapshot = null;
  let cancelRequested = false;
  let warned = false;

  async function report() {
    if (!snapshot) return { ok: false, cancelRequested };
    try {
      const response = await sendNativeMessage(hostName, { type: 'social-import-status', ...snapshot });
      cancelRequested = !!response?.cancelRequested;
      return { ok: response?.ok !== false, cancelRequested };
    } catch (error) {
      if (!warned) {
        warned = true;
        try { log('[gatheros] social import progress unavailable:', error?.message || error); } catch { /* ignore */ }
      }
      return { ok: false, cancelRequested };
    }
  }

  async function start({ platform, mode, target = null, startedAt = Date.now(), message = null } = {}) {
    snapshot = {
      runId: randomUUID(), platform, mode, stage: 'starting',
      scanned: 0, saved: 0, known: 0, failed: 0,
      target: target === undefined ? null : target, startedAt, message,
    };
    cancelRequested = false;
    warned = false;
    await report();
    return getSnapshot();
  }

  async function update(patch = {}) {
    if (!snapshot) throw new Error('progress run not started');
    const next = { ...snapshot, ...patch };
    if (!STAGES.has(next.stage)) throw new Error('invalid stage');
    if (cancelRequested && ['starting', 'scanning', 'saving'].includes(next.stage)) next.stage = 'stopping';
    for (const key of ['scanned', 'saved', 'known', 'failed']) {
      if (!Number.isInteger(next[key]) || next[key] < snapshot[key]) throw new Error(`${key} must be monotonic`);
    }
    snapshot = next;
    const response = await report();
    return { ...getSnapshot(), ...response };
  }

  async function finish(stage = 'complete', message = null) {
    if (!['complete', 'stopped', 'failed'].includes(stage)) throw new Error('invalid terminal stage');
    return update({ stage, message });
  }

  function getSnapshot() {
    return snapshot ? { ...snapshot, cancelRequested } : null;
  }

  return {
    start,
    update,
    finish,
    report,
    getSnapshot,
    isCancellationRequested: () => cancelRequested,
    beforeNext: () => !cancelRequested,
  };
}
