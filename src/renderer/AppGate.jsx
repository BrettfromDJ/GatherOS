import React from 'react';
import { useLicense } from './hooks/useLicense.js';
import App from './App.jsx';
import SigninScreen from './components/SigninScreen.jsx';
import PaywallModal from './components/PaywallModal.jsx';

// Top-level license gate. Decides whether the user sees the app, the
// signin screen, or the paywall — based on the entitlement state
// resolved by useLicense(). Mounted from main.jsx as the only child
// of the root.
//
// Why a wrapper: keeps App.jsx focused on the moodboard UI, and
// makes it impossible to forget the gate when the App tree gets
// torn down + re-mounted (e.g. during a future hot-reload story).
export default function AppGate() {
  const { state, requestMagicLink, signOut } = useLicense();

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
        onSubscribe={(plan) => {
          // TODO Phase 3c: open Paddle.js checkout overlay with the
          // matching priceId from src/shared/licensing-config.js.
          console.log('[paywall] subscribe →', plan);
        }}
      />
    );
  }

  // 'entitled' or 'offline' — let the app run. Phase 4 adds an
  // offline / payment-failed banner that overlays App.
  return <App />;
}
