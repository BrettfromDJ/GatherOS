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
//                   Used when reverse navigation would land in a
//                   state the previous step doesn't expect.
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
  // 2. Library overview. Next opens the named save's detail view
  // before advancing (single click triggers morphFocus — dblclick
  // opens macOS Preview, the wrong UI). Step 3 then explains the
  // panel that just appeared.
  {
    id: 'saves',
    target: null,
    icon: 'library',
    title: 'Your library',
    body: 'Everything you collect lives here — drag images in, paste URLs, or save from the browser extension.',
    advance: {
      type: 'next',
      label: 'Next',
      // Prefer the starter-pack's named save so the tooltip on
      // step 3 always points at the same image. Falls back to any
      // save in the library if that title isn't present (e.g.
      // before the starter pack has been built into a zip).
      clickBefore: [
        '[data-save-title="Bold Typography Design"]',
        '[data-save-id]',
      ],
    },
  },
  // 3. Detail view explainer. No spotlight — the panel is already
  // on screen. Next closes the panel for the user. noBack: going
  // back to step 2 would immediately re-fire its 'appears' check
  // (the panel is still open) and bounce us right back here.
  {
    id: 'detail-panel',
    target: null,
    noBack: true,
    title: 'Detail view',
    body: 'Tags, source URL, palette, and AI-extracted text live here. Click anything to edit inline — autosaves as you type.',
    advance: {
      type: 'next',
      label: 'Next',
      clickBefore: '[data-onboarding="detail-close"]',
    },
  },
  // 4. Collections — the overlay switches to the Collections tab
  // on entry, then explains it. noBack: step 3 assumes the detail
  // panel is open; we'd have to re-open it on reverse nav, which
  // isn't worth the plumbing.
  {
    id: 'collections',
    target: null,
    icon: 'collections',
    noBack: true,
    onEnter: '[data-onboarding="mode-folders"]',
    title: 'Collections',
    body: "Group saves by project, mood, or anything else. A save can live in many collections at once — they're tags, not folders.",
    advance: { type: 'next', label: 'Next' },
  },
  // 5. Spaces — same pattern. Next advances to the final choice.
  {
    id: 'spaces',
    target: null,
    icon: 'spaces',
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
    noBack: true,
    onEnter: '[data-onboarding="mode-library"]',
    title: 'Keep the starter pack?',
    body: "These images came pre-loaded so you'd have something to look at. Hang on to them, or clear them out to start with an empty library.",
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
