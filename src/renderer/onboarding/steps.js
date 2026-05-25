// First-run walkthrough steps. Each step renders the same tooltip
// shell — what differs is the target it spotlights and how it
// advances. Step targets are CSS selectors resolved at render time
// against the live DOM; target: null means no spotlight (used by
// the intro).
//
// Advance types:
//   - { type: 'next', label, clickBefore } explicit Next button.
//                                    Optional clickBefore is a
//                                    selector — if set, the overlay
//                                    dispatches a click on it
//                                    before advancing. Used to send
//                                    the user back to the library
//                                    after the detail-panel step.
//   - { type: 'appears', selector }  waits for a selector to mount
//                                    (e.g. detail panel appearing).

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
  {
    id: 'pick-image',
    target: '[data-save-title="Bold Typography Design"]',
    title: 'Open a save',
    body: 'Double-click "Bold Typography Design" to open it in the detail view.',
    advance: { type: 'appears', selector: '[data-onboarding="detail-panel"]' },
  },
  // 3. Detail view explainer. Next clicks the close button for the
  // user so they're back in the library before step 4 highlights
  // the Collections tab.
  {
    id: 'detail-panel',
    target: '[data-onboarding="detail-panel"]',
    title: 'Detail view',
    body: 'Tags, source URL, palette, and AI-extracted text live here. Click anything to edit inline — autosaves as you type.',
    advance: {
      type: 'next',
      label: 'Next',
      clickBefore: '[data-onboarding="detail-close"]',
    },
  },
  // 4. Collections tab.
  {
    id: 'collections',
    target: '[data-onboarding="mode-folders"]',
    title: 'Collections',
    body: "Group saves by project, mood, or anything else. A save can live in many collections at once — they're tags, not folders.",
    advance: { type: 'next', label: 'Next' },
  },
  // 5. Spaces tab — last step.
  {
    id: 'spaces',
    target: '[data-onboarding="mode-boards"]',
    title: 'Spaces',
    body: 'Infinite canvases for moodboards and layouts. Drag images in, add notes, and present full-screen.',
    advance: { type: 'next', label: 'Done' },
  },
];
