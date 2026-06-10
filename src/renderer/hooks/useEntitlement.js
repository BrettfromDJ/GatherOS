import { useCallback, useEffect, useState } from 'react';

// Renderer's view of what the user can do right now — the combination of
// the local no-account trial and the server licensing state, resolved by
// the main-process entitlement layer (src/main/entitlement.js).
//
// Shape consumed by the UI:
//   { mode, paid, trial, canCreateSave, proUnlocked, serverTrialing }
//   mode: 'paid' | 'trial' | 'free'
//   trial: { startedAt, endsAt, active, daysLeft }
//
// Fails OPEN: until the first fetch resolves (and if a fetch ever
// throws) we assume a permissive mode so a paying user is never briefly
// shown a locked UI on launch.
const PERMISSIVE = {
  mode: 'trial',
  paid: false,
  trial: { startedAt: null, endsAt: null, active: true, daysLeft: 14 },
  canCreateSave: true,
  proUnlocked: true,
  serverTrialing: false,
  loading: true,
};

// `dep` is any value that should trigger a re-fetch when it changes —
// AppGate passes the license status so entitlement re-resolves the
// moment the server state flips (sign-in, upgrade, expiry).
export function useEntitlement(dep) {
  const [ent, setEnt] = useState(PERMISSIVE);

  const refresh = useCallback(async () => {
    try {
      const result = await window.moodmark?.entitlement?.get?.();
      if (result && typeof result === 'object') {
        setEnt({ ...result, loading: false });
      }
    } catch {
      // Fail open — keep whatever we had (permissive on first load).
      setEnt((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  // Re-resolve on mount and whenever the license status changes.
  useEffect(() => { refresh(); }, [refresh, dep]);

  // Re-resolve on focus (catches a trial that ticked over to expired
  // while the app was backgrounded) and after any save lands or gets
  // blocked (the save count feeds isNewInstall on a fresh install).
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    let offs = [];
    if (window.moodmark?.on) {
      offs.push(window.moodmark.on('save:created', refresh));
      offs.push(window.moodmark.on('save:needs-upgrade', refresh));
    }
    return () => {
      window.removeEventListener('focus', onFocus);
      offs.forEach((off) => { try { off?.(); } catch { /* ignore */ } });
    };
  }, [refresh]);

  return { entitlement: ent, refreshEntitlement: refresh };
}
