// First-run walkthrough steps. Each step renders the same tooltip
// shell — what differs is the target (if any) and how it advances.
// Step targets are CSS selectors resolved at render time against
// the live DOM; target: null means no spotlight (the tooltip is
// pinned bottom-left either way).
//
// Optional fields:
//   - onEnter: selector the overlay clicks on its own when the
//              step becomes active (used to auto-navigate the user
//              between modes without an extra Next click).
//
// Advance types:
//   - { type: 'next', label, clickBefore } explicit Next button.
//                                    clickBefore: a selector the
//                                    overlay clicks before
//                                    advancing (e.g. closing the
//                                    detail panel).
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
  // The image name is omitted on purpose — the spotlight points to
  // the right one, no need to repeat it in copy.
  {
    id: 'pick-image',
    target: '[data-save-title="Bold Typography Design"]',
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
  // 5. Spaces — same pattern. Last step; Done flips back to the
  // Library tab so the user lands somewhere actionable, then
  // closes the overlay.
  {
    id: 'spaces',
    target: null,
    onEnter: '[data-onboarding="mode-boards"]',
    title: 'Spaces',
    body: 'Infinite canvases for moodboards and layouts. Drag images in, add notes, and present full-screen.',
    advance: {
      type: 'next',
      label: 'Done',
      clickBefore: '[data-onboarding="mode-library"]',
    },
  },
];
