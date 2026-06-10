// Entitlement = "what is this user allowed to do right now", combining
// the local no-account trial with the server licensing state.
//
//   'paid'  — active paid subscription → everything unlocked, forever.
//   'trial' — the local 14-day trial is still running, OR the server says
//             the account is in an (entitled) trial → full app.
//   'free'  — trial is over and there's no paid subscription → soft free
//             tier: existing saves stay fully usable, but creating NEW
//             saves and the pro features (AI, X sync, boards, multiple
//             libraries) prompt to upgrade. No hard wall, no data taken.
//
// SAFETY: this fails OPEN. A user is only ever put in 'free' when we are
// CONFIDENT the trial is over AND there's no subscription. Any
// uncertainty (cache unreadable, offline, can't verify) resolves to a
// permissive mode so a paying user is never wrongly blocked.

const { getPref, setPref } = require('./settings');

const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Lazy requires to avoid require cycles.
let _licensing = null;
function licensing() {
  if (!_licensing) _licensing = require('./licensing');
  return _licensing;
}

function hasSession() {
  try { return !!licensing().hasSession(); }
  catch { return false; }
}

// True only for a genuinely fresh install: no prior library and no
// licensing session. On uncertainty we lean toward "new" so a real new
// user is never denied their trial.
function isNewInstall() {
  if (hasSession()) return false;
  try {
    const db = require('./db');
    if (typeof db.getSmartViewCounts === 'function') {
      const c = db.getSmartViewCounts();
      const total = (c?.all || 0) + (c?.trash || 0);
      if (total > 0) return false;
    }
  } catch { /* db not ready — treat as new */ }
  return true;
}

// Decide the trial start exactly once. New installs get the 14-day clock
// from now; existing users (updating into this build) get 0 — i.e. the
// local trial is already spent, so their access is driven purely by their
// account state and they don't get a free reset.
function ensureTrialDecided() {
  if (getPref('trialStartedAt', null) !== null) return;
  setPref('trialStartedAt', isNewInstall() ? Date.now() : 0);
}

function localTrial() {
  const startedAt = getPref('trialStartedAt', null);
  if (!startedAt) return { startedAt: startedAt || null, endsAt: null, active: false, daysLeft: 0 };
  const endsAt = startedAt + TRIAL_DAYS * DAY_MS;
  const daysLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / DAY_MS));
  return { startedAt, endsAt, active: Date.now() < endsAt, daysLeft };
}

// Synchronous read of the cached server license state (no network).
function serverState() {
  try {
    const lic = licensing();
    if (typeof lic.getCachedState === 'function') return lic.getCachedState();
  } catch { /* ignore */ }
  return { state: 'unauth' };
}

function build(mode, trial, server) {
  return {
    mode,
    paid: mode === 'paid',
    trial,
    serverTrialing: !!(server && server.state === 'entitled'
      && (server.reason === 'trial' || (server.subscription && server.subscription.status === 'trialing'))),
    // Gating flags the callers enforce.
    canCreateSave: mode !== 'free',
    proUnlocked: mode !== 'free',
  };
}

function getEntitlement() {
  ensureTrialDecided();
  const server = serverState();
  const trial = localTrial();
  const sub = server && server.subscription;

  // Active paid subscription → unlocked forever.
  if (server.state === 'entitled' && sub && sub.status !== 'trialing') {
    return build('paid', trial, server);
  }
  // Any other entitled / offline-grace state (incl. server trial) → allow.
  if (server.state === 'entitled' || server.state === 'offline') {
    return build('trial', trial, server);
  }
  // Local trial still running → allow.
  if (trial.active) return build('trial', trial, server);
  // Couldn't determine the server state → fail open, don't downgrade.
  if (server.state === 'error') return build('trial', trial, server);
  // Confirmed: server says expired, or never signed in and the local trial
  // is spent → free tier.
  if (server.state === 'expired' || server.state === 'unauth') {
    return build('free', trial, server);
  }
  // Anything unexpected → fail open.
  return build('trial', trial, server);
}

// Cheap boolean guard for save entry points. Fails OPEN — if anything
// throws while resolving entitlement, we allow the save rather than risk
// blocking a paying user.
function canCreateSave() {
  try { return getEntitlement().canCreateSave; }
  catch { return true; }
}

module.exports = { TRIAL_DAYS, ensureTrialDecided, localTrial, getEntitlement, canCreateSave };
