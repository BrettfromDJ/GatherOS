// Builds the rotating "Try …" suggestions for the Search tab's hero
// field, drawn from the user's OWN library so the placeholder teaches
// what's searchable and feels personal:
//   • real tag names (what you named things)
//   • the dominant colours actually present in your saves' palettes
//     (what your library looks like — color-name search is a real
//     feature, see main/colorNames.js)
//
// Returns a de-duplicated, interleaved list of bare terms (e.g.
// "branding", "navy"); the caller wraps each as Try “<term>”.

// Compact set of distinct, recognisable colour names with a
// representative RGB. Kept small + perceptually spread so the nearest
// match reads as a name a person would actually type.
const NAMED_COLORS = [
  ['red', [220, 38, 38]],
  ['crimson', [190, 18, 60]],
  ['pink', [236, 72, 153]],
  ['coral', [251, 113, 90]],
  ['orange', [249, 115, 22]],
  ['amber', [245, 158, 11]],
  ['gold', [212, 175, 55]],
  ['yellow', [234, 179, 8]],
  ['lime', [132, 204, 22]],
  ['green', [34, 197, 94]],
  ['emerald', [16, 185, 129]],
  ['teal', [20, 184, 166]],
  ['cyan', [6, 182, 212]],
  ['sky', [56, 165, 233]],
  ['blue', [37, 99, 235]],
  ['navy', [30, 58, 138]],
  ['indigo', [79, 70, 229]],
  ['violet', [139, 92, 246]],
  ['purple', [147, 51, 234]],
  ['magenta', [217, 70, 239]],
  ['brown', [120, 72, 40]],
  ['tan', [210, 180, 140]],
  ['beige', [214, 196, 166]],
];

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 0 = neutral (gray/black/white), 1 = vivid. Used to skip near-neutral
// swatches — backgrounds are overwhelmingly off-white/gray, and "Try
// 'gray'" teaches little, so we surface the chromatic story instead.
function saturation([r, g, b]) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

function nearestColorName([r, g, b]) {
  let best = null;
  let bestDist = Infinity;
  for (const [name, [cr, cg, cb]] of NAMED_COLORS) {
    // Slightly green-weighted euclidean — closer to perceived distance
    // than flat RGB without the cost of a full LAB convert.
    const d = 0.3 * (r - cr) ** 2 + 0.59 * (g - cg) ** 2 + 0.11 * (b - cb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

// Generic teaching terms shown only when the library is too sparse to
// derive anything personal yet (brand-new account). Aspirational, not
// guaranteed to return hits — there's nothing to return at that point.
const FALLBACK = ['gradient', 'typography', 'minimal', 'blue'];

export function buildSearchPlaceholders({ tags = [], saves = [], max = 10 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (term) => {
    const t = String(term || '').trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  // Tally the dominant chromatic colours across a sample of the library.
  const colorTally = new Map();
  let sampled = 0;
  for (const s of saves) {
    if (sampled >= 80) break;
    let pal = s && s.palette;
    if (typeof pal === 'string') {
      try { pal = JSON.parse(pal); } catch { pal = null; }
    }
    if (!Array.isArray(pal) || pal.length === 0) continue;
    sampled += 1;
    // Look at the two most dominant swatches per save.
    for (const hex of pal.slice(0, 2)) {
      const rgb = parseHex(hex);
      if (!rgb || saturation(rgb) < 0.22) continue; // skip neutrals
      const name = nearestColorName(rgb);
      if (name) colorTally.set(name, (colorTally.get(name) || 0) + 1);
    }
  }
  const topColors = [...colorTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // Interleave real tags with real colours so the rotation alternates
  // "what you named" and "what it looks like" rather than clustering.
  const tagNames = tags.map((t) => t && t.name).filter(Boolean);
  let ti = 0;
  let ci = 0;
  while ((ti < tagNames.length || ci < topColors.length) && out.length < max) {
    if (ti < tagNames.length) push(tagNames[ti++]);
    if (ci < topColors.length) push(topColors[ci++]);
  }

  return out.length > 0 ? out : FALLBACK.slice();
}
