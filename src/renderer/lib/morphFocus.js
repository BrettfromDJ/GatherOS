// Drives the masonry-card → focused-view (and back) image morph using
// the View Transitions API. The matched-element animation is keyed by
// `view-transition-name: morph-image` set on the source card's <img>
// and the focused-view's <img> for the same save.
//
// The flow:
//   1. flushSync(() => setMorphId(id)) — synchronously render with
//      the view-transition-name attached to the source <img>, so
//      the browser's "before" snapshot picks it up.
//   2. document.startViewTransition(() => flushSync(applyState)) —
//      browser snapshots the current DOM, runs the callback (which
//      switches grid ↔ focused), snapshots again, and morphs the
//      matched name between positions.
//   3. transition.finished — clear the marker so subsequent renders
//      don't keep the name attached.
//
// Falls back to a plain state change when the API isn't available
// (older Chromium) or when the user has reduced motion enabled.

import { flushSync } from 'react-dom';

export function morphFocus({ setMorphId, applyState, id }) {
  const supported = typeof document !== 'undefined'
    && typeof document.startViewTransition === 'function';
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!supported || reduced) {
    applyState();
    return;
  }

  // Tag the source <img> with the shared view-transition-name and
  // commit that render before the browser snapshots.
  flushSync(() => setMorphId(id));

  const transition = document.startViewTransition(() => {
    flushSync(() => applyState());
  });

  transition.finished.finally(() => setMorphId(null));
}
