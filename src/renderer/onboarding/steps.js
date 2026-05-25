// First-run walkthrough steps. Each step renders the same tooltip
// shell — what differs is the target (if any) and how it advances.
// Step targets are CSS selectors resolved at render time against
// the live DOM; target: null means no spotlight (the tooltip is
// pinned bottom-left either way).
//
// Optional fields:
//   - onEnter:      selector the overlay clicks on its own when
//                   the step becomes active (used to auto-navigate
//                   the user between modes without an extra Next).
//   - dimSiblings:  true to fade every card except the target,
//                   pulling the eye by contrast instead of a
//                   stroke ring. The fade is applied via a CSS
//                   rule on body[data-onboarding-dim="cards"] —
//                   ImageCard sets its own inline style so a JS-
//                   driven approach gets clobbered on re-render.
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
  // 1. Intro — modal-style, no spotlight.
  {
    id: 'intro',
    target: null,
    title: 'Welcome to GatherOS',
    body: 'A quick tour — about 30 seconds. You can exit any time.',
    advance: { type: 'next', label: 'Get started' },
  },
  // 2. Spotlight an image, advance when the detail panel mounts.
  // No stroke ring — instead we dim every other card so the target
  // pops by contrast. The image name is omitted on purpose: the
  // visual treatment points to the right one.
  {
    id: 'pick-image',
    target: '[data-save-title="Bold Typography Design"]',
    dimSiblings: true,
    title: 'Open a save',
    body: 'Double-click the highlighted image to open it in the detail view.',
    advance: { type: 'appears', selector: '[data-onboarding="detail-panel"]' },
  },
  // 3. Detail view explainer. No spotlight — the panel is already
  // on screen. Next closes the panel for the user.
  {
    id: 'detail-panel',
    target: null,
    title: 'Detail view',
    body: 'Tags, source URL, palette, and AI-extracted text live here. Click anything to edit inline — autosaves as you type.',
    advance: {
      type: 'next',
      label: 'Next',
      clickBefore: '[data-onboarding="detail-close"]',
    },
  },
  // 4. Collections — the overlay switches to the Collections tab
  // on entry, then explains it.
  {
    id: 'collections',
    target: null,
    onEnter: '[data-onboarding="mode-folders"]',
    title: 'Collections',
    body: "Group saves by project, mood, or anything else. A save can live in many collections at once — they're tags, not folders.",
    advance: { type: 'next', label: 'Next' },
  },
  // 5. Spaces — same pattern. Next advances to the final choice.
  {
    id: 'spaces',
    target: null,
    onEnter: '[data-onboarding="mode-boards"]',
    title: 'Spaces',
    body: 'Infinite canvases for moodboards and layouts. Drag images in, add notes, and present full-screen.',
    advance: { type: 'next', label: 'Next' },
  },
  // 6. Keep / start-fresh. The chosen option's `action` fires
  // before the overlay closes — 'fresh' removes the starter-pack
  // saves on the main process. Either branch flips back to the
  // Library tab so the user lands somewhere actionable.
  {
    id: 'finale',
    target: null,
    onEnter: '[data-onboarding="mode-library"]',
    title: 'Keep the starter pack?',
    body: "These images came pre-loaded so you'd have something to look at. Hang on to them, or clear them out to start with an empty library.",
    advance: {
      type: 'choice',
      options: [
        { label: 'Keep them', value: 'keep' },
        { label: 'Start fresh', value: 'fresh', action: 'remove-starter-pack', danger: true },
      ],
    },
  },
];
