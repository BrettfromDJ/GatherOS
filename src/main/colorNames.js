// Maps common color names → representative hex values. Used by the
// search bar so typing "orange" or "navy" augments the result set
// with saves whose extracted palette contains a perceptually-similar
// color (ΔE comparison done in db.filterByColor).
//
// Includes the standard CSS color names plus a handful of designer
// synonyms ("blush", "rust", "sage", "teal" etc.). Lowercased keys.

const COLOR_NAMES = {
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

// Returns the first color hex matched in the query string, or null
// if no recognized color name is present. Strips non-letters so
// "Orange." or "orange," still hits.
function detectColorName(query) {
  if (!query) return null;
  const words = String(query).toLowerCase().split(/[\s,]+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (clean && COLOR_NAMES[clean]) return COLOR_NAMES[clean];
  }
  return null;
}

module.exports = { detectColorName, COLOR_NAMES };
