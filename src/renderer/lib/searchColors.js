// Color names for the search token UI — swatch suggestions when the
// user types `color:` and hex validation for typed values.
//
// KEEP IN SYNC with src/main/colorNames.js (the backend resolves
// `color:<name>` against that map). Duplicated rather than shared
// because main is CJS and the renderer bundle is ESM.

export const COLOR_NAMES = {
  // Reds / pinks
  red: '#ff0000',
  crimson: '#dc143c',
  scarlet: '#ff2400',
  ruby: '#9b111e',
  maroon: '#800000',
  burgundy: '#800020',
  salmon: '#fa8072',
  coral: '#ff7f50',
  tomato: '#ff6347',
  brick: '#b22222',
  firebrick: '#b22222',
  rose: '#ff007f',
  pink: '#ffc0cb',
  hotpink: '#ff69b4',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  blush: '#de5d83',

  // Oranges / browns / earth
  orange: '#ffa500',
  tangerine: '#f28500',
  amber: '#ffbf00',
  peach: '#ffcc99',
  apricot: '#fbceb1',
  rust: '#b7410e',
  ochre: '#cc7722',
  sienna: '#a0522d',
  brown: '#8b4513',
  chocolate: '#d2691e',
  tan: '#d2b48c',
  taupe: '#483c32',
  beige: '#f5f5dc',
  khaki: '#c3b091',
  cream: '#fffdd0',
  ivory: '#fffff0',

  // Yellows / golds
  yellow: '#ffd700',
  gold: '#ffd700',
  mustard: '#ffdb58',
  lemon: '#fff44f',
  butter: '#fff8b6',

  // Greens
  green: '#2e8b57',
  lime: '#a4c639',
  olive: '#808000',
  forest: '#228b22',
  emerald: '#50c878',
  mint: '#3eb489',
  sage: '#9caf88',
  moss: '#8a9a5b',
  jade: '#00a36c',
  teal: '#008080',

  // Blues
  blue: '#1e88e5',
  navy: '#000080',
  sky: '#87ceeb',
  azure: '#007fff',
  royal: '#4169e1',
  cerulean: '#007ba7',
  cobalt: '#0047ab',
  indigo: '#4b0082',
  cyan: '#00d8d8',
  aqua: '#00ffff',
  turquoise: '#40e0d0',
  periwinkle: '#ccccff',
  denim: '#1560bd',
  slate: '#708090',

  // Purples
  purple: '#800080',
  violet: '#7f00ff',
  lavender: '#b497d8',
  plum: '#8e4585',
  mauve: '#b784a7',
  lilac: '#c8a2c8',

  // Neutrals
  black: '#000000',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  charcoal: '#36454f',
  silver: '#c0c0c0',
  graphite: '#383838',
  pearl: '#eae0c8',
  bone: '#e3dac9',
};

// Alias spellings / same-hex duplicates hidden from the suggestion list
// (still valid to type — the backend resolves them all).
const SUGGEST_SKIP = new Set(['grey', 'firebrick', 'fuchsia', 'gold']);

// With nothing typed yet, an alphabetical-ish dump would open on eight
// shades of red. Lead with a spectrum instead so the empty `color:`
// popover reads as "pick a hue".
const DEFAULT_ORDER = [
  'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple',
  'pink', 'brown', 'beige', 'black', 'white', 'gray',
];

// Full list in display order: spectrum leads, everything else follows
// in palette order.
export const COLOR_SUGGESTIONS = [
  ...DEFAULT_ORDER.map((name) => ({ name, hex: COLOR_NAMES[name] })),
  ...Object.entries(COLOR_NAMES)
    .filter(([name]) => !SUGGEST_SKIP.has(name) && !DEFAULT_ORDER.includes(name))
    .map(([name, hex]) => ({ name, hex })),
];

// Normalize a typed hex value ("1a2b3c", "#abc") to #rrggbb, or null.
// Mirrors parseColor's hex branches in src/main/searchQuery.js.
export function parseHexColor(value) {
  const v = String(value || '').trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(v)) return v.startsWith('#') ? v : `#${v}`;
  if (/^#?[0-9a-f]{3}$/.test(v)) {
    const s = v.replace('#', '');
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return null;
}

// Hex (or null) a `color:` value will resolve to on the backend —
// named color or raw hex. Used to validate chips and paint swatches.
export function resolveColor(value) {
  const v = String(value || '').trim().toLowerCase();
  return parseHexColor(v) || COLOR_NAMES[v] || null;
}
