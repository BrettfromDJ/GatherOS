// Release notes shown by the "What's new" modal after auto-update.
// One entry per shipped version. The `version` string must match
// the value of app.getVersion() exactly so the launch-time check
// finds it. Items mirror the FeatureCardStack shape: { Icon, title,
// description }.
//
// Adding a release:
//   1. Drop a new object at the *top* of RELEASE_NOTES.
//   2. Use 2–5 items per release. The card stack reads best at that
//      density — beyond 5 the dot indicator gets crowded.
//   3. Lead with what changes the user will *notice*, not refactors.

import {
  GlassIcon,
  WindowIcon,
  CardsIcon,
  AcknowledgmentIcon,
  PermissionIcon,
} from './releaseNotesIcons.jsx';

export const RELEASE_NOTES = [
  {
    version: '0.4.1',
    items: [
      {
        Icon: WindowIcon,
        title: 'A colorful light/dark switch',
        description: 'Toggling between light and dark now sweeps a soft, liquid rainbow across the window — a fresh colorway every time.',
      },
      {
        Icon: CardsIcon,
        title: 'Collections on the search page',
        description: 'Your collections now sit right under the search bar, so you can jump straight into one without leaving search.',
      },
      {
        Icon: GlassIcon,
        title: 'Search clears when you switch tabs',
        description: 'Hop from search back to your library and you’ll see all your saves again, instead of being stuck on old results.',
      },
    ],
  },
  {
    version: '0.4.0',
    items: [
      {
        Icon: GlassIcon,
        title: 'A dedicated search tab',
        description: 'Search is now its own tab — a full, scrollable canvas built to find anything fast across thousands of saves, instead of the small ⌘K box.',
      },
      {
        Icon: WindowIcon,
        title: 'Smaller libraries',
        description: 'New images are optimized as they’re saved, so your library takes far less disk. Already large? Settings → Storage → Reclaim space re-compresses what’s already there.',
      },
      {
        Icon: PermissionIcon,
        title: 'Smoother grid',
        description: 'Scrolling stays smooth even with thousands of saves.',
      },
    ],
  },
  {
    version: '0.1.21',
    items: [
      {
        Icon: PermissionIcon,
        title: 'Drop images directly into folders',
        description: 'Drag a file from Finder, an image from Chrome, or a URL onto any folder in the sidebar — it saves and lands in that folder in one step.',
      },
      {
        Icon: CardsIcon,
        title: 'Lasso to select',
        description: 'Drag on the empty grid background to draw a selection rectangle. Cards highlight live as the rectangle passes over them.',
      },
      {
        Icon: WindowIcon,
        title: 'Drag folders to nest (and back out)',
        description: 'Drop a folder onto another folder’s middle to nest it as a child. Drop on a top-level row to promote it back out.',
      },
      {
        Icon: GlassIcon,
        title: 'Daily backup snapshots',
        description: 'GatherOS quietly snapshots your library every day so you can roll back from Settings → Data if anything ever goes sideways.',
      },
    ],
  },
  {
    version: '0.1.20',
    items: [
      {
        Icon: CardsIcon,
        title: 'Find similar from any image',
        description: 'Right-click a save and pick "Find similar" — works without an OpenAI key by falling back to color palette comparisons.',
      },
      {
        Icon: WindowIcon,
        title: 'Capture window from the menu bar',
        description: 'Three new menu-bar capture options: full screen, a single window, or the existing drag-region selection.',
      },
      {
        Icon: GlassIcon,
        title: 'Duplicate detection on save',
        description: 'GatherOS now hashes every save and surfaces an "Already in your library" toast with a link to the existing entry.',
      },
      {
        Icon: PermissionIcon,
        title: 'Drag images onto the Dock icon',
        description: 'Drop image files (or links from Chrome) directly onto the GatherOS Dock icon to add them to the active library.',
      },
    ],
  },
  {
    version: '0.1.9',
    items: [
      {
        Icon: WindowIcon,
        title: 'Window position remembered',
        description: 'GatherOS reopens at the size and spot you left it.',
      },
      {
        Icon: CardsIcon,
        title: 'Smoother folder transitions',
        description: 'The cards at the top of the grid now glide out cleanly when you scroll.',
      },
      {
        Icon: PermissionIcon,
        title: 'Clearer screen recording prompt',
        description: 'If macOS hasn’t granted Screen Recording yet, we walk you to the right Settings pane.',
      },
      {
        Icon: AcknowledgmentIcon,
        title: 'Open source acknowledgments',
        description: 'See the libraries that power GatherOS in Settings → About.',
      },
    ],
  },
];

// Pick the release notes block to show, or null if there isn't one.
//
// Behaviour:
//   • Brand-new install (no lastSeen): never show. Welcome modal owns
//     first-launch onboarding.
//   • lastSeen === currentVersion: nothing to show.
//   • currentVersion > lastSeen: surface the notes block for
//     currentVersion (intermediate skipped versions are intentionally
//     not concatenated — keeps the modal readable; users who skip a
//     release can find prior notes on the GitHub release page).
export function pickNotesForUpgrade(currentVersion, lastSeen) {
  if (!currentVersion || !lastSeen) return null;
  if (currentVersion === lastSeen) return null;
  if (compareVersions(currentVersion, lastSeen) <= 0) return null;
  return RELEASE_NOTES.find((r) => r.version === currentVersion) || null;
}

// Naive semver compare — splits on '.' and compares integers. Good
// enough for our 0.x channel. Returns -1, 0, or 1.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}
