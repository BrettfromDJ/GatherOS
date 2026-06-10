import React, { createContext, useContext } from 'react';

// Renderer-wide access to the resolved entitlement (mode paid/trial/free,
// trial countdown, per-feature locks) plus a single helper to open the
// upgrade modal from any locked action.
//
// Defaults are PERMISSIVE so that if a component reads the context before
// the provider mounts (or outside it, e.g. in tests) nothing is wrongly
// locked — a paying user is never blocked by a missing provider.
const DEFAULT = {
  mode: 'trial',
  paid: false,
  trial: { startedAt: null, endsAt: null, active: true, daysLeft: 14 },
  canCreateSave: true,
  proUnlocked: true,
  serverTrialing: false,
  loading: true,
};

const EntitlementContext = createContext(DEFAULT);

export function EntitlementProvider({ value, children }) {
  return (
    <EntitlementContext.Provider value={value || DEFAULT}>
      {children}
    </EntitlementContext.Provider>
  );
}

// Read the current entitlement anywhere in the tree.
export function useEntitlementValue() {
  return useContext(EntitlementContext);
}

// Convenience: open the upgrade modal from a locked action. `feature` is
// an optional string the modal uses to tailor its headline (e.g.
// 'ai', 'x-sync', 'libraries', 'boards', 'save'). AppGate / App listens
// for this event and mounts the modal.
export function requestUpgrade(feature) {
  window.dispatchEvent(
    new CustomEvent('moodmark:request-upgrade', { detail: { feature: feature || null } }),
  );
}

// True when a given pro feature should be locked right now. Free tier
// locks everything; trial and paid unlock. Fails OPEN on a missing mode.
export function isLocked(entitlement) {
  return !!entitlement && entitlement.mode === 'free';
}
