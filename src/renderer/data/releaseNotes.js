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
    version: '0.8.0',
    items: [
      {
        Icon: CardsIcon,
        title: 'Browse collections like a crate',
        description: 'The Collections tab is now a wall of record sleeves you flip through. Hover to pull one out and read its cover, arrow-key across them, and click to dive in.',
      },
      {
        Icon: WindowIcon,
        title: 'Cosmos support, coming soon',
        description: 'Cosmos is joining X and Instagram as a place you can save from — images and videos from cosmos.so, synced straight into your library. It arrives with an upcoming browser-extension update.',
      },
      {
        Icon: GlassIcon,
        title: 'Choose a collection’s cover',
        description: 'Right-click any save inside a collection and set it as the cover shown on its sleeve. Reset it back to automatic anytime from the new ⋯ menu next to the title.',
      },
      {
        Icon: PermissionIcon,
        title: 'A redesigned browser panel, and fixes',
        description: 'The extension panel was rebuilt to match the app, plus fixes to video thumbnails, trackpad scrolling that jumped between screens, and a round of polish.',
      },
    ],
  },
  {
    version: '0.7.0',
    items: [
      {
        Icon: CardsIcon,
        title: 'Collections inside collections',
        description: 'Nest a collection inside another and drill in to see what’s there. A parent now shows everything from the collections nested in it, and you can rename, delete, or file straight into a nested one from any menu.',
      },
      {
        Icon: GlassIcon,
        title: 'Search that finds everything',
        description: 'Search now reliably turns up saves by their name, caption, and on-image text — and a save you’ve named yourself jumps to the top of the results.',
      },
      {
        Icon: WindowIcon,
        title: 'A sharper ⌘K',
        description: 'The command palette opens with your recently viewed images, gives every command its own icon, tells captured posts apart from saves, and scrolls through the full list.',
      },
      {
        Icon: PermissionIcon,
        title: 'Shortcuts and polish',
        description: 'The keyboard shortcuts sheet now lists screen capture and tab navigation, alongside a round of visual fixes across collections and menus.',
      },
    ],
  },
  {
    version: '0.6.0',
    items: [
      {
        Icon: GlassIcon,
        title: 'Filter search with chips',
        description: 'Type tag:, collection:, color: or before: in search and pick from live suggestions — each filter becomes a removable chip. Or press the new filter button and never type syntax at all.',
      },
      {
        Icon: WindowIcon,
        title: 'One ⌘K for everything',
        description: 'The command palette searches your whole library — saves, collections, tags, spaces — and runs commands, from new collection to any settings page. Type > to see commands only.',
      },
      {
        Icon: CardsIcon,
        title: 'Sort by most viewed',
        description: 'The grid can now order by the saves you open most, alongside newest and oldest first.',
      },
      {
        Icon: PermissionIcon,
        title: 'Faster, and nothing fails silently',
        description: 'Search is indexed and stays instant in big libraries, moodboard exports no longer freeze the app, and anything that fails now says so instead of vanishing.',
      },
    ],
  },
  {
    version: '0.5.0',
    items: [
      {
        Icon: CardsIcon,
        title: 'Make a moodboard',
        description: 'Select a few images and export an animated moodboard — a clean, square GIF that cuts through your picks. Videos come along as their first frame.',
      },
      {
        Icon: PermissionIcon,
        title: 'Smoother with big libraries',
        description: 'Scrolling stays fluid through thousands of bookmarks — off-screen cards no longer do rendering work they don’t need to.',
      },
      {
        Icon: WindowIcon,
        title: 'Fixes and polish',
        description: 'A round of small fixes across the app — steadier drag-and-drop, cleaner toasts, and a handful of rough edges smoothed out.',
      },
    ],
  },
  {
    version: '0.4.4',
    items: [
      {
        Icon: WindowIcon,
        title: 'The grid takes over on scroll',
        description: 'Scroll into your library and the toolbar rolls away — the masonry goes edge-to-edge with just the tabs floating at the top, so your work fills the whole screen.',
      },
      {
        Icon: CardsIcon,
        title: 'File into collections from anywhere',
        description: 'Pick up a card while scrolled and a slim collection tab slides out from the right edge to drop it into — no scrolling back up. Collections it already lives in are marked.',
      },
      {
        Icon: GlassIcon,
        title: 'Eyedropper loupe',
        description: 'The colour picker is now a real magnifier — a zoomed loupe with the live hex follows your cursor; click to copy and the ring flashes the colour.',
      },
      {
        Icon: PermissionIcon,
        title: 'Search that teaches',
        description: 'The search field rotates through real tags and the dominant colours from your own library (“Try ‘navy’”), so you learn what’s searchable. A near-duplicate tag now offers to merge instead of fragmenting.',
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
//   • Patch bumps (same major.minor — e.g. 0.4.3 → 0.4.4): never show.
//     These are bug fixes and polish; users don't need a "What's new"
//     modal every single release.
//   • Minor/major bumps (e.g. 0.3.x → 0.4.x): surface the notes block for
//     the new line, matched by major.minor so any patch within it (0.4.4,
//     0.4.7…) still finds the 0.4 showcase. Intermediate skipped versions
//     are intentionally not concatenated — keeps the modal readable.
export function pickNotesForUpgrade(currentVersion, lastSeen) {
  if (!currentVersion || !lastSeen) return null;
  if (compareVersions(currentVersion, lastSeen) <= 0) return null;
  const cur = String(currentVersion).split('.').map((x) => parseInt(x, 10) || 0);
  const seen = String(lastSeen).split('.').map((x) => parseInt(x, 10) || 0);
  // Only a minor or major change earns the modal. Same line → silent.
  if (cur[0] === seen[0] && cur[1] === seen[1]) return null;
  // Match by major.minor so the showcase shows regardless of which patch
  // the user happens to land on.
  return RELEASE_NOTES.find((r) => {
    const v = String(r.version).split('.').map((x) => parseInt(x, 10) || 0);
    return v[0] === cur[0] && v[1] === cur[1];
  }) || null;
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
