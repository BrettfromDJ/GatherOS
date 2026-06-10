import React, { useEffect, useRef, useState } from 'react';
import { useLicense } from './hooks/useLicense.js';
import { useEntitlement } from './hooks/useEntitlement.js';
import { PENDING_UPGRADE_KEY } from './context/entitlement.jsx';
import App from './App.jsx';
import SigninScreen from './components/SigninScreen.jsx';
import AccountBanner from './components/AccountBanner.jsx';
import DbIntegrityBanner from './components/DbIntegrityBanner.jsx';

// Dev override for previewing gate screens without juggling real
// license / trial state. Set in DevTools and reload:
//   localStorage.setItem('moodmark.dev.gate', 'signin')   // SigninScreen
//   localStorage.setItem('moodmark.dev.gate', 'app')      // skip gate, App
//   localStorage.setItem('moodmark.dev.gate', 'free')     // App, free tier
//   localStorage.removeItem('moodmark.dev.gate')          // back to real
// Captured once on module load so toggling needs a reload (clearer
// than reacting mid-session, which would surprise active state).
const DEV_GATE = (() => {
  try { return localStorage.getItem('moodmark.dev.gate') || null; }
  catch { return null; }
})();
if (DEV_GATE) {
  // eslint-disable-next-line no-console
  console.warn(`[AppGate] dev override active: ${DEV_GATE}. Remove with localStorage.removeItem('moodmark.dev.gate').`);
}

// Synthetic entitlement for the 'free' dev override so the App can be
// previewed in its locked state without an expired account.
const DEV_FREE_ENTITLEMENT = {
  mode: 'free', paid: false,
  trial: { startedAt: 0, endsAt: 0, active: false, daysLeft: 0 },
  canCreateSave: false, proUnlocked: false, serverTrialing: false, loading: false,
};

// Top-level gate. Under the reverse-trial / soft-free-tier model the app
// is NEVER hard-walled: a fresh install runs a local 14-day trial with no
// account, and once that's spent (and there's no paid subscription) the
// app keeps running in a free tier — existing saves stay fully usable,
// only NEW saves and pro features prompt to upgrade. The single remaining
// full-screen screen is the optional SigninScreen, shown only when the
// user explicitly asks to sign in (Settings → Account) so they can attach
// or restore a paid account.
//
// The server license state still drives whether there's an *account* to
// show in the AccountBanner; the local-trial-aware entitlement drives the
// soft gating inside the app.
export default function AppGate() {
  const { state, verify, requestMagicLink, signOut } = useLicense();
  const { entitlement } = useEntitlement(state.status);

  // After the user opens a hosted checkout we poll license/verify on a
  // short cadence so the app flips to paid as soon as the webhook lands.
  // Kicked off by the 'moodmark:checkout-opened' event (fired by the
  // upgrade flows) and by simply being in a non-entitled server state.
  const checkoutPollRef = useRef(null);

  // Latches true when the user explicitly requests signin from somewhere
  // inside the app (Settings → Account → Sign in). Shows the SigninScreen
  // for the duration of this unauth visit.
  const [signinRequested, setSigninRequested] = useState(false);

  useEffect(() => {
    function onRequest() { setSigninRequested(true); }
    window.addEventListener('moodmark:request-signin', onRequest);
    return () => window.removeEventListener('moodmark:request-signin', onRequest);
  }, []);

  // Settings dispatches this when the user confirms the sign-out
  // dialog. Routing through here (instead of calling the licensing
  // IPC directly from Settings) means useLicense's setState fires in
  // the same tick, so the entitlement re-resolves immediately.
  useEffect(() => {
    function onRequest() { signOut(); }
    window.addEventListener('moodmark:request-signout', onRequest);
    return () => window.removeEventListener('moodmark:request-signout', onRequest);
  }, [signOut]);

  // Reset the explicit-signin latch once we leave the unauth state
  // (e.g. the magic link landed and we're entitled now).
  useEffect(() => {
    if (state.status !== 'unauth') setSigninRequested(false);
  }, [state.status]);

  // Fast-poll verify for 2 minutes after a checkout is opened, so the
  // app flips to paid the moment the subscription webhook is processed.
  useEffect(() => {
    function startPolling() {
      if (checkoutPollRef.current != null) return;
      let ticks = 0;
      checkoutPollRef.current = setInterval(() => {
        ticks += 1;
        if (ticks > 30) {
          clearInterval(checkoutPollRef.current);
          checkoutPollRef.current = null;
          return;
        }
        verify({ force: true });
      }, 4000);
    }
    window.addEventListener('moodmark:checkout-opened', startPolling);
    return () => {
      window.removeEventListener('moodmark:checkout-opened', startPolling);
      if (checkoutPollRef.current != null) {
        clearInterval(checkoutPollRef.current);
        checkoutPollRef.current = null;
      }
    };
  }, [verify]);

  // Stop polling once we land on a paid/entitled state.
  useEffect(() => {
    if (entitlement.mode === 'paid' && checkoutPollRef.current != null) {
      clearInterval(checkoutPollRef.current);
      checkoutPollRef.current = null;
    }
  }, [entitlement.mode]);

  // Resume a pending upgrade after "Sign in to upgrade". The moment the
  // user has an account, pick up exactly where they left off — no second
  // click. If they still need to pay (server 'expired'), continue
  // straight to checkout; if signing in already gave them access
  // (entitled / offline grace), there's nothing to buy, so just clear it.
  useEffect(() => {
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_UPGRADE_KEY) || 'null'); }
    catch { pending = null; }
    if (!pending) return;
    // Not signed in yet (or mid-verify) — wait for the next transition.
    if (state.status === 'unauth' || state.status === 'loading' || state.status === 'error') return;
    // We have an account now — consume the intent exactly once.
    try { localStorage.removeItem(PENDING_UPGRADE_KEY); } catch { /* ignore */ }
    if (state.status === 'expired') {
      (async () => {
        const result = await window.moodmark.licensing.openCheckout(pending.plan || 'monthly');
        if (result?.ok) {
          window.dispatchEvent(new CustomEvent('moodmark:checkout-opened'));
        } else {
          // Couldn't open checkout — fall back to the upgrade modal so the
          // user can retry rather than being left with no feedback.
          console.error('[upgrade] auto-checkout after signin failed:', result?.error);
          window.dispatchEvent(
            new CustomEvent('moodmark:request-upgrade', { detail: { feature: pending.feature || null } }),
          );
        }
      })();
    }
  }, [state.status]);

  // ── Gate ────────────────────────────────────────────────────────
  // An explicit sign-in request (from the upgrade modal's "Sign in to
  // upgrade", Settings → Account, etc.) wins over everything — including
  // the dev gates — so the sign-in screen always shows when asked for.
  // It's optional now, so it carries a "back to app" escape hatch.
  if (signinRequested && state.status !== 'entitled' && state.status !== 'offline') {
    return (
      <SigninScreen
        onRequestMagicLink={requestMagicLink}
        onCancel={() => {
          // Backing out of sign-in abandons any pending upgrade intent so
          // a later unrelated sign-in doesn't surprise-open checkout.
          try { localStorage.removeItem(PENDING_UPGRADE_KEY); } catch { /* ignore */ }
          setSigninRequested(false);
        }}
      />
    );
  }

  if (DEV_GATE === 'signin' || DEV_GATE === 'unauth') {
    return <SigninScreen onRequestMagicLink={requestMagicLink} />;
  }
  if (DEV_GATE === 'app') {
    return <App entitlement={{ ...entitlement, mode: entitlement.mode, loading: false }} />;
  }
  if (DEV_GATE === 'free' || DEV_GATE === 'paywall') {
    return <App entitlement={DEV_FREE_ENTITLEMENT} />;
  }

  // ── Real gate ───────────────────────────────────────────────────
  if (state.status === 'loading') {
    // Brief — usually one tick while the cached license is read. Render
    // nothing to avoid a flash of the signin screen.
    return null;
  }

  // Everything else runs the app. The entitlement prop carries the
  // trial/free/paid mode so the app can show the trial countdown, the
  // upgrade banner, and the per-feature locks. The AccountBanner only
  // mounts when there's a real account (license) to surface.
  return (
    <>
      <App entitlement={entitlement} />
      <DbIntegrityBanner
        onOpenBackups={() => {
          // App.jsx listens for this and pops Settings open on the
          // Data drawer so the user can pick a snapshot.
          window.dispatchEvent(
            new CustomEvent('moodmark:open-settings', { detail: { drawer: 'data' } }),
          );
        }}
      />
      {state.license ? (
        <AccountBanner
          license={state.license}
          onOpenCustomerPortal={() => window.moodmark.licensing.openCustomerPortal()}
        />
      ) : null}
    </>
  );
}
