// Search-bar filter syntax — splits an input like
//   "dark moody bucket:fonts tag:serif before:2025-01-01"
// into the cleaned free-text portion + structured filters that
// getAllSaves and the semantic search path can apply directly.
//
// Recognised tokens:
//   tag:<name>        — saves carrying that tag (AND across multiple)
//   bucket:<name>     — saves in that bucket (AND across multiple)
//   color:<name|hex>  — saves whose palette contains the color
//   is:untagged       — saves with zero tags
//   before:<date>     — saves created before that ISO date
//   after:<date>      — saves created after that ISO date
//
// Anything that doesn't match the `key:value` shape (or matches an
// unrecognised key) is left in `text` so the regular substring +
// embedding paths still see the user's free typing.

// Same palette the free-text color detector uses (~45 designer names:
// navy, sage, rust, blush…), so `color:navy` and a bare "navy" resolve
// identically. Previously this used a separate 18-name map, which made
// `color:navy` silently drop the filter.
const { COLOR_NAMES } = require('./colorNames.js');

function parseColor(value) {
  const v = value.trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(v)) return v.startsWith('#') ? v : `#${v}`;
  if (/^#?[0-9a-f]{3}$/.test(v)) {
    // #abc → #aabbcc
    const s = v.replace('#', '');
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return COLOR_NAMES[v] || null;
}

function parseDate(value) {
  // YYYY-MM-DD; treat naked dates as midnight UTC. Bad strings → null.
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ts) ? null : ts;
}

function parseSearchQuery(input) {
  const filters = {
    text: '',
    tagNames: [],
    bucketNames: [],
    colorHex: null,
    untagged: false,
    before: null,
    after: null,
  };
  if (!input || typeof input !== 'string') return filters;

  // Token regex respects quoted values: `bucket:"my fonts"` keeps the
  // space-bearing name as one token. Bare tokens split on whitespace.
  const tokens = input.match(/(\w+:"[^"]*"|\w+:\S+|\S+)/g) || [];
  const remaining = [];

  for (const raw of tokens) {
    const m = raw.match(/^(\w+):(.+)$/);
    if (!m) { remaining.push(raw); continue; }
    const key = m[1].toLowerCase();
    let value = m[2];
    // Strip surrounding quotes from quoted values.
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (!value) { remaining.push(raw); continue; }

    switch (key) {
      case 'tag': {
        const cleaned = value.toLowerCase().replace(/^#+/, '').trim();
        if (cleaned) filters.tagNames.push(cleaned);
        break;
      }
      case 'bucket':
      case 'folder':
      case 'collection': {
        const cleaned = value.toLowerCase().trim();
        if (cleaned) filters.bucketNames.push(cleaned);
        break;
      }
      case 'color': {
        const hex = parseColor(value);
        // Last wins — multiple color: filters AND'd would return zero
        // rows in practice (palettes rarely match two distinct hexes
        // simultaneously), so we collapse to the most recent.
        if (hex) filters.colorHex = hex;
        break;
      }
      case 'is': {
        const cleaned = value.toLowerCase().trim();
        if (cleaned === 'untagged') filters.untagged = true;
        else remaining.push(raw);
        break;
      }
      case 'before': {
        const ts = parseDate(value);
        if (ts != null) filters.before = ts;
        else remaining.push(raw);
        break;
      }
      case 'after': {
        const ts = parseDate(value);
        if (ts != null) filters.after = ts;
        else remaining.push(raw);
        break;
      }
      default:
        remaining.push(raw);
    }
  }

  filters.text = remaining.join(' ').trim();
  return filters;
}

module.exports = { parseSearchQuery };
