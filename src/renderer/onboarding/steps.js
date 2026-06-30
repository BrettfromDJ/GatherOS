// First-run walkthrough steps. Each step renders the same tooltip
// shell — what differs is the target (if any) and how it advances.
// Step targets are CSS selectors resolved at render time against
// the live DOM; target: null means no spotlight (the tooltip is
// pinned bottom-left either way).
//
// Optional fields:
//   - icon:         string key mapped to a lucide glyph in
//                   OnboardingOverlay (currently 'library' /
//                   'collections' / 'spaces'). Renders next to
//                   the step title.
//   - noBack:       true to hide the Previous button on this step.
//                   Currently unused — every step normalizes its
//                   own UI state on entry via onEnter so reverse
//                   navigation always works.
//   - onEnter:      selector (string) or sequence (array of
//                   strings) the overlay clicks on its own when
//                   the step becomes active. Array items dispatch
//                   one per animation frame so the DOM has time to
//                   settle between clicks. Idempotent — re-clicks
//                   a button that's already in the desired state
//                   are no-ops in this app.
//
// Advance types:
//   - { type: 'next', label, clickBefore } explicit Next button.
//                                    clickBefore: a selector the
//                                    overlay clicks before
//                                    advancing (e.g. closing the
//                                    detail panel).
//   - { type: 'appears', selector }  waits for a selector to mount
//                                    (e.g. detail panel appearing).
//   - { type: 'choice', options }    branching final step. Each
//                                    option = { label, value,
//                                    action?, danger? } — action
//                                    is a string keyed in
//                                    OnboardingOverlay (currently
//                                    only 'remove-starter-pack').

export const STEPS = [
  // 1. Library overview. onEnter normalizes state — Library mode,
  // detail panel closed — so reverse navigation from step 2 lands
  // cleanly. Both clicks are no-ops on a fresh first launch.
  // Next opens the named save's detail view before advancing
  // (single click triggers morphFocus — dblclick opens macOS
  // Preview, the wrong UI). Step 2 then explains the panel.
  {
    id: 'saves',
    target: null,
    icon: 'library',
    onEnter: [
      '[data-onboarding="mode-library"]',
      '[data-onboarding="detail-close"]',
    ],
    title: 'Your library',
    body: 'Everything you collect lives here. Drag images in, save URLs, or sync your social bookmarks.',
    advance: {
      type: 'next',
      label: 'Next',
      // Prefer the starter-pack's named save so the tooltip on
      // step 2 always points at the same image. Falls back to any
      // save in the library if that title isn't present (e.g.
      // before the starter pack has been built into a zip).
      clickBefore: [
        '[data-save-title="Bold Typography Design"]',
        '[data-save-id]',
      ],
    },
  },
  // 2. Detail view explainer. onEnter (re-)opens the named save —
  // idempotent on forward entry (step 1's clickBefore already
  // opened it; clicking an already-focused card is a no-op), but
  // required so reverse navigation from step 3 lands with the
  // panel open. Next closes the panel before step 3 switches modes.
  {
    id: 'detail-panel',
    target: null,
    icon: 'detail',
    onEnter: [
      '[data-onboarding="mode-library"]',
      '[data-save-title="Bold Typography Design"]',
      '[data-save-id]',
    ],
    title: 'Detail view',
    body: 'Everything about a save lives here — tags, source, palette, notes, and more.',
    advance: {
      type: 'next',
      label: 'Next',
      clickBefore: '[data-onboarding="detail-close"]',
    },
  },
  // 3. Collections — the overlay switches to the Collections tab
  // on entry, then explains it.
  {
    id: 'collections',
    target: null,
    icon: 'collections',
    onEnter: '[data-onboarding="mode-folders"]',
    title: 'Collections',
    body: 'Group saves by project, mood or anything else. A save can live in many collections at once.',
    advance: { type: 'next', label: 'Next' },
  },
  // 4. Spaces — same pattern. Next advances to the final choice.
  {
    id: 'spaces',
    target: null,
    icon: 'spaces',
    onEnter: '[data-onboarding="mode-boards"]',
    title: 'Spaces',
    body: 'Infinite canvases for moodboards or explorations. Drag images in, arrange them, add notes, and present full-screen.',
    advance: { type: 'next', label: 'Next' },
  },
  // 5. Chrome extension — prompt to install it so X bookmarks and
  // Instagram saves sync into the library automatically. The `cta`
  // opens the Chrome Web Store listing in the browser; the regular
  // Next ('Maybe later') lets them skip without installing.
  {
    id: 'extension',
    target: null,
    icon: 'extension',
    onEnter: '[data-onboarding="mode-library"]',
    title: 'Sync your X & Instagram saves',
    body: 'Add the Chrome extension and everything you bookmark on X or save on Instagram flows straight into your library — no copy-paste.',
    advance: { type: 'next', label: 'Next' },
    cta: {
      label: 'Install extension',
      url: 'https://chromewebstore.google.com/detail/gatheros/jflmnonpoapjncoeankehcmenldecojk',
    },
  },
  // 6. Keep / start-fresh. The chosen option's `action` fires
  // before the overlay closes — 'fresh' removes the starter pack
  // (saves + collections + boards) on the main process. Both
  // branches flip back to the Library tab so the user lands
  // somewhere actionable.
  {
    id: 'finale',
    target: null,
    icon: 'starter',
    // Terminal step — Previous from the choice screen feels off.
    noBack: true,
    onEnter: '[data-onboarding="mode-library"]',
    title: 'Keep the starter pack?',
    body: "These images came pre-loaded so you'd have something to look at. Hang on to them, or wipe the slate clean.",
    advance: {
      type: 'choice',
      // Right-most option is treated as the primary CTA — order
      // here matters. 'Start fresh' is the affirmative answer to
      // the prompt ("Keep the starter pack?"), so it gets the
      // filled pill on the right.
      options: [
        { label: 'Keep them', value: 'keep' },
        { label: 'Start fresh', value: 'fresh', action: 'remove-starter-pack' },
      ],
    },
  },
];
