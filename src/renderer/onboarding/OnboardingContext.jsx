import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { STEPS } from './steps.js';

// Settings key used to remember whether the user has already seen
// (or dismissed) the walkthrough. Once set to true on the main
// process's prefs.json, the auto-start on App boot is suppressed.
export const ONBOARDING_DONE_PREF = 'onboardingCompleted';

// Holds the index of the active step, or -1 when the walkthrough
// isn't running. Consumers read `active` + `step` to render; they
// call `advance` / `exit` / `goTo` to drive it.
const OnboardingContext = createContext({
  active: false,
  step: null,
  stepIndex: -1,
  totalSteps: STEPS.length,
  start: () => {},
  exit: () => {},
  advance: () => {},
  goTo: () => {},
});

export function useOnboarding() {
  return useContext(OnboardingContext);
}

export function OnboardingProvider({ children }) {
  const [stepIndex, setStepIndex] = useState(-1);

  const active = stepIndex >= 0 && stepIndex < STEPS.length;

  // Persist the "done" flag whenever the walkthrough ends — whether
  // the user finished step 5 or hit Exit. Either way they've seen
  // it; we shouldn't pester them on every relaunch. We track the
  // previous active state with a ref so we only fire on the
  // active → inactive edge, not on first mount.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (wasActiveRef.current && !active) {
      try {
        window.moodmark?.settings?.setPref?.(ONBOARDING_DONE_PREF, true);
      } catch { /* best-effort — failing to persist isn't fatal */ }
    }
    wasActiveRef.current = active;
  }, [active]);

  const start = useCallback(() => setStepIndex(0), []);
  const exit = useCallback(() => setStepIndex(-1), []);
  const advance = useCallback(() => {
    setStepIndex((i) => (i + 1 >= STEPS.length ? -1 : i + 1));
  }, []);
  const goTo = useCallback((id) => {
    const i = STEPS.findIndex((s) => s.id === id);
    if (i >= 0) setStepIndex(i);
  }, []);

  const value = useMemo(() => ({
    active,
    step: active ? STEPS[stepIndex] : null,
    stepIndex,
    totalSteps: STEPS.length,
    start, exit, advance, goTo,
  }), [active, stepIndex, start, exit, advance, goTo]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
