import { useCallback, useEffect, useRef, useState } from 'react';

// Bridge to the main-process licensing module. Owns the renderer's
// view of the entitlement state and re-verifies in the background
// every REVERIFY_INTERVAL_MS (also on window focus and on a fresh
// magic-link auth-result from the deep-link handler).
//
// State machine the UI consumes:
//   { status: 'loading' }                       → splash, do nothing
//   { status: 'unauth' }                        → SigninScreen
//   { status: 'expired', license }              → PaywallModal
//   { status: 'entitled', license }             → run the app
//   { status: 'offline', license }              → run the app + banner
//   { status: 'error', error }                  → SigninScreen + toast

const REVERIFY_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function useLicense() {
  const [state, setState] = useState({ status: 'loading' });
  const intervalRef = useRef(null);

  const verify = useCallback(async ({ force = false } = {}) => {
    const result = await window.moodmark.licensing.verify({ force });
    if (!result) {
      setState({ status: 'error', error: 'no_response' });
      return;
    }
    switch (result.state) {
      case 'unauth':
        setState({ status: 'unauth' });
        break;
      case 'entitled':
        setState({ status: 'entitled', license: result });
        break;
      case 'expired':
        setState({ status: 'expired', license: result });
        break;
      case 'offline':
        setState({ status: 'offline', license: result });
        break;
      case 'error':
      default:
        setState({ status: 'error', error: result.state });
        break;
    }
  }, []);

  // Initial verify on mount.
  useEffect(() => {
    verify();
  }, [verify]);

  // Re-verify on a regular cadence so paid → canceled (or trial →
  // expired) flips before the user re-launches.
  useEffect(() => {
    intervalRef.current = setInterval(() => verify({ force: true }), REVERIFY_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [verify]);

  // Re-verify on window focus — catches the case where the user
  // upgraded / canceled in their browser and tabs back in.
  useEffect(() => {
    const onFocus = () => verify({ force: true });
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [verify]);

  // Listen for the main process's deep-link auth result so the
  // signin screen flips immediately when the user clicks the magic
  // link (rather than waiting for the next focus event).
  useEffect(() => {
    if (!window.moodmark?.on) return undefined;
    const off = window.moodmark.on('licensing:auth-result', (result) => {
      if (result?.ok) verify({ force: true });
      // On failure the SigninScreen will pick up the surfaced error
      // via the result it receives. We could also lift it into state
      // here for a global toast — defer until we add the toast plumbing.
    });
    return off;
  }, [verify]);

  const requestMagicLink = useCallback(
    (email) => window.moodmark.licensing.requestMagicLink(email),
    [],
  );
  const signOut = useCallback(async () => {
    await window.moodmark.licensing.signOut();
    setState({ status: 'unauth' });
  }, []);

  return { state, verify, requestMagicLink, signOut };
}
