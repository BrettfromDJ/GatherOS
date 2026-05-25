import React, {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react';
import { STEPS } from './steps.js';

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
