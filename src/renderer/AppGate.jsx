import React, { useEffect, useRef } from 'react';
import { useLicense } from './hooks/useLicense.js';
import App from './App.jsx';
import SigninScreen from './components/SigninScreen.jsx';
import PaywallModal from './components/PaywallModal.jsx';
import AccountBanner from './components/AccountBanner.jsx';

// Top-level license gate. Decides whether the user sees the app, the
// signin screen, or the paywall — based on the entitlement state
// resolved by useLicense(). Mounted from main.jsx as the only child
// of the root.
//
// Why a wrapper: keeps App.jsx focused on the moodboard UI, and
// makes it impossible to forget the gate when the App tree gets
// torn down + re-mounted (e.g. during a future hot-reload story).
export default function AppGate() {
  const { state, verify, requestMagicLink, signOut } = useLicense();
  // While the user is on the paywall and we've handed them off to
  // the LS hosted-checkout in their browser, poll license/verify on a
  // shorter cadence so the app flips out of paywall as soon as the
  // webhook lands. We stop polling once we leave 'expired'.
  const checkoutPollRef = useRef(null);

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

  if (state.status === 'loading') {
    // Brief — usually just one tick while the cached cache is read.
    // Render nothing to avoid a flash of the signin screen.
    return null;
  }

  if (state.status === 'unauth' || state.status === 'error') {
    return <SigninScreen onRequestMagicLink={requestMagicLink} />;
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
      <AccountBanner
        license={state.license}
        onOpenCustomerPortal={() => window.moodmark.licensing.openCustomerPortal()}
      />
    </>
  );
}
