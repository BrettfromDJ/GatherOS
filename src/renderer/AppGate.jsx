import React, { useEffect, useRef, useState } from 'react';
import { useLicense } from './hooks/useLicense.js';
import App from './App.jsx';
import SigninScreen from './components/SigninScreen.jsx';
import PaywallModal from './components/PaywallModal.jsx';
import AccountBanner from './components/AccountBanner.jsx';
import DbIntegrityBanner from './components/DbIntegrityBanner.jsx';

// Top-level license gate. Decides whether the user sees the app, the
// signin screen, or the paywall — based on the entitlement state
// resolved by useLicense(). Mounted from main.jsx as the only child
// of the root.
//
// Guest mode: a brand-new launch with no session and an empty library
// drops straight into the app so the user can land their first save
// before being asked to sign in. The moment that first save commits,
// the gate flips and we show the signin screen. After that, any
// 'unauth' state (e.g. an explicit sign-out) goes back to the
// signin screen — past that first save, auth is required.
export default function AppGate() {
  const { state, verify, requestMagicLink, signOut } = useLicense();
  // While the user is on the paywall and we've handed them off to
  // the LS hosted-checkout in their browser, poll license/verify on a
  // shorter cadence so the app flips out of paywall as soon as the
  // webhook lands. We stop polling once we leave 'expired'.
  const checkoutPollRef = useRef(null);

  // null = haven't checked yet (brief flash); number = actual count.
  // Re-fetched whenever we land in 'unauth' so a sign-out-then-launch
  // user with existing saves goes straight to the signin screen.
  const [guestSaveCount, setGuestSaveCount] = useState(null);
  // Latches true the moment a save lands while we're in guest mode,
  // which immediately flips the render to SigninScreen on the next
  // tick. We don't reset it during the same unauth visit — once
  // they've saved, the gate is up.
  const [guestSaveLanded, setGuestSaveLanded] = useState(false);

  useEffect(() => {
    if (state.status === 'expired' && checkoutPollRef.current == null) {
      // 4s × 30 = 2 min of fast polling after a checkout was opened.
      // After that we fall back to focus + 6h background re-verify.
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
    if (state.status !== 'expired' && checkoutPollRef.current != null) {
      clearInterval(checkoutPollRef.current);
      checkoutPollRef.current = null;
    }
    return () => {
      if (checkoutPollRef.current != null) {
        clearInterval(checkoutPollRef.current);
        checkoutPollRef.current = null;
      }
    };
  }, [state.status, verify]);

  // Re-check the save count any time we re-enter 'unauth'. A 0 count
  // grants guest access; anything > 0 goes straight to signin (the
  // user has signed out at some point and shouldn't be allowed to
  // keep adding saves without auth).
  useEffect(() => {
    if (state.status !== 'unauth') {
      setGuestSaveCount(null);
      setGuestSaveLanded(false);
      return undefined;
    }
    let cancelled = false;
    window.moodmark?.saves?.counts?.().then((counts) => {
      if (cancelled) return;
      setGuestSaveCount(counts?.all ?? 0);
    }).catch(() => { if (!cancelled) setGuestSaveCount(0); });
    return () => { cancelled = true; };
  }, [state.status]);

  // While the user is in guest mode (unauth + 0 saves), watch for the
  // first save. The 1.4s delay lets the masonry land animation play
  // and the user feel the win before we put up the auth screen.
  useEffect(() => {
    if (state.status !== 'unauth') return undefined;
    if (guestSaveCount !== 0) return undefined;
    if (guestSaveLanded) return undefined;
    if (!window.moodmark?.on) return undefined;
    const off = window.moodmark.on('save:created', () => {
      setTimeout(() => setGuestSaveLanded(true), 1400);
    });
    return off;
  }, [state.status, guestSaveCount, guestSaveLanded]);

  if (state.status === 'loading') {
    // Brief — usually just one tick while the cached cache is read.
    // Render nothing to avoid a flash of the signin screen.
    return null;
  }

  if (state.status === 'unauth' || state.status === 'error') {
    // Guest mode: empty library + no session = let them in for one
    // save. Once guestSaveLanded latches, fall through to signin.
    if (state.status === 'unauth' && guestSaveCount === 0 && !guestSaveLanded) {
      return (
        <>
          <App />
          <DbIntegrityBanner
            onOpenBackups={() => {
              window.dispatchEvent(
                new CustomEvent('moodmark:open-settings', { detail: { drawer: 'data' } }),
              );
            }}
          />
        </>
      );
    }
    // Either we've already checked and the library has saves, or the
    // count is mid-flight (null). For null, render nothing for a beat
    // rather than flashing the signin form.
    if (state.status === 'unauth' && guestSaveCount === null) return null;
    // If the gate fired because guestSaveLanded just latched, show
    // the warmer "save your library" copy. Sign-out / re-launch with
    // existing saves still gets the cold default headline.
    const reason = guestSaveLanded ? 'post-save' : undefined;
    return <SigninScreen onRequestMagicLink={requestMagicLink} reason={reason} />;
  }

  if (state.status === 'expired') {
    return (
      <PaywallModal
        license={state.license}
        onSignOut={signOut}
        onSubscribe={async (plan) => {
          // Hosted checkout: main process asks the worker to mint a
          // checkout URL with our user_id baked in, then opens it in
          // the user's default browser via shell.openExternal. We
          // poll license/verify in the background (see effect above)
          // so the paywall flips off as soon as the webhook lands.
          const result = await window.moodmark.licensing.openCheckout(plan);
          if (!result?.ok) {
            console.error('[paywall] openCheckout failed:', result?.error);
          }
        }}
      />
    );
  }

  // 'entitled' or 'offline' — let the app run. Layer the account
  // banner on top so payment-failed / offline states are surfaced
  // without blocking the UI.
  return (
    <>
      <App />
      <DbIntegrityBanner
        onOpenBackups={() => {
          // App.jsx listens for this and pops Settings open on the
          // Data drawer so the user can pick a snapshot. Fire-and-
          // forget — keeps AppGate from owning Settings UI state.
          window.dispatchEvent(
            new CustomEvent('moodmark:open-settings', { detail: { drawer: 'data' } }),
          );
        }}
      />
      <AccountBanner
        license={state.license}
        onOpenCustomerPortal={() => window.moodmark.licensing.openCustomerPortal()}
      />
    </>
  );
}
