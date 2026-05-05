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
