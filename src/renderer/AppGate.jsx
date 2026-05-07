import React, { useCallback } from 'react';
import { useLicense } from './hooks/useLicense.js';
import { usePaddle } from './hooks/usePaddle.js';
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

  // Paddle.js fans events into here. checkout.completed is fired
  // client-side as soon as Paddle confirms the charge — we re-verify
  // shortly after so the entitled bit flips without waiting for the
  // 6-hour background poll. The webhook on the server is still the
  // source of truth.
  const handlePaddleEvent = useCallback(
    (event) => {
      if (event?.name === 'checkout.completed') {
        setTimeout(() => verify({ force: true }), 1500);
      }
    },
    [verify],
  );

  const { ready: paddleReady, openCheckout, priceIds } = usePaddle({
    onEvent: handlePaddleEvent,
  });

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
        canSubscribe={paddleReady}
        onSignOut={signOut}
        onSubscribe={(plan) => {
          const priceId = priceIds?.[plan];
          if (!priceId) {
            console.error('[paywall] no priceId configured for plan:', plan);
            return;
          }
          openCheckout({
            priceId,
            email: state.license?.user?.email,
            // customData is echoed back on every webhook for this
            // checkout — lets the worker link the resulting customer
            // to our user row even before the email matches.
            customData: state.license?.user?.id
              ? { user_id: state.license.user.id }
              : undefined,
          });
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
