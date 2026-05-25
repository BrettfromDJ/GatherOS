// First-run walkthrough steps. Each step renders the same tooltip
// shell — what differs is the target it spotlights and how it
// advances. Step targets are CSS selectors resolved at render time
// against the live DOM. A step with target: null centers the
// tooltip on the viewport (used for the intro / outro screens).
//
// Advance types:
//   - { type: 'next', label }        explicit Next button
//   - { type: 'click' }              waits for a click on the target
//   - { type: 'theme', value }       waits for <html data-theme> to flip
//   - { type: 'choice', options }    final-step branch (keep / fresh)
//
// Placement is the tooltip's position relative to the target;
// ignored when target is null.

export const STEPS = [
  // 1. Intro
  {
    id: 'intro',
    target: null,
    placement: 'center',
    title: 'Welcome to GatherOS',
    body: 'A quick tour of how to capture, organize, and reuse references. Takes about a minute — you can exit any time.',
    advance: { type: 'next', label: 'Get started' },
  },
  // 2. Switch to dark mode
  {
    id: 'dark-mode',
    target: '[data-onboarding="theme-toggle"]',
    placement: 'bottom',
    title: 'Try dark mode',
    body: 'Tap the theme toggle to flip to dark. (It also looks great in light.)',
    advance: { type: 'theme', value: 'dark' },
  },
  // 3. Collections (no required action, just a callout)
  {
    id: 'collections',
    target: '[data-onboarding="mode-folders"]',
    placement: 'bottom',
    title: 'Collections',
    body: "Group saves by project, mood, or anything else. A save can live in many collections at once — they're tags, not folders.",
    advance: { type: 'next', label: 'Next' },
  },
  // 4. Click a specific starter-pack image
  {
    id: 'pick-image',
    target: '[data-save-title="Bold Typography Design"]',
    placement: 'right',
    title: 'Open a save',
    body: 'Click "Bold Typography Design" to look at it in detail.',
    advance: { type: 'click' },
  },
  // 5. Detail panel
  {
    id: 'detail-panel',
    target: '[data-onboarding="detail-panel"]',
    placement: 'left',
    title: 'Detail view',
    body: 'Tags, source URL, palette, and AI-extracted text live here. Click anything to edit inline — autosaves as you type.',
    advance: { type: 'next', label: 'Next' },
  },
  // 6. Close detail
  {
    id: 'close-detail',
    target: '[data-onboarding="detail-close"]',
    placement: 'left',
    title: 'Close it',
    body: 'Click × to head back to your library.',
    advance: { type: 'click' },
  },
  // 7. Spaces mode
  {
    id: 'spaces-mode',
    target: '[data-onboarding="mode-boards"]',
    placement: 'bottom',
    title: 'Spaces',
    body: 'Spaces are infinite canvases — moodboards, layouts, whatever you want. Click "Spaces" to switch.',
    advance: { type: 'click' },
  },
  // 8. New space
  {
    id: 'new-space',
    target: '[data-onboarding="new-space"]',
    placement: 'right',
    title: 'Create a space',
    body: 'Click "New space" to start your first canvas.',
    advance: { type: 'click' },
  },
  // 9. Inside the new space
  {
    id: 'inside-space',
    target: null,
    placement: 'center',
    title: "You're in a Space",
    body: 'Drag images from the library, add sticky notes, draw connections. Hit Present to go full-screen for a clean view.',
    advance: { type: 'next', label: 'Finish walkthrough' },
  },
  // 10. Keep or fresh
  {
    id: 'keep-or-fresh',
    target: null,
    placement: 'center',
    title: 'Keep the starter pack?',
    body: 'Hold onto these images while you explore, or move them to Trash — you can always restore them later.',
    advance: {
      type: 'choice',
      options: [
        { label: 'Keep starter pack', value: 'keep' },
        { label: 'Start fresh', value: 'fresh', danger: true },
      ],
    },
  },
];
