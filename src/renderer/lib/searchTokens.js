// Token model for the search field's filter chips.
//
// The query STRING stays the single source of truth (App state, recent
// searches and src/main/searchQuery.js all speak it). Chips are a
// projection: recognized complete `key:value` tokens become chips,
// everything else stays free text, and composing chips + text always
// round-trips through the backend tokenizer unchanged.

import { resolveColor } from './searchColors.js';

export const FILTER_KEYS = new Set([
  'tag', 'bucket', 'folder', 'collection', 'color', 'is', 'before', 'after',
]);

// bucket/folder/collection are backend aliases; chips display and
// serialize the canonical `collection`.
export function normalizeKey(k) {
  const key = String(k || '').toLowerCase();
  return key === 'bucket' || key === 'folder' ? 'collection' : key;
}

export function isValidChip(key, value) {
  const v = String(value || '').trim();
  if (!v) return false;
  switch (key) {
    case 'tag':
    case 'collection':
      return true;
    case 'color':
      return !!resolveColor(v);
    case 'is':
      return v.toLowerCase() === 'untagged';
    case 'before':
    case 'after':
      return /^\d{4}-\d{2}-\d{2}$/.test(v);
    default:
      return false;
  }
}

export const quoteValue = (v) => (/\s/.test(v) ? `"${v}"` : v);

export const serializeChip = (c) => `${c.key}:${quoteValue(c.value)}`;

export function composeQuery(chips, text) {
  const head = chips.map(serializeChip).join(' ');
  if (!head) return text;
  return text ? `${head} ${text}` : head;
}

// Split an incoming query string into committed chips + leftover text.
// Mirrors the tokenizer in src/main/searchQuery.js (incl. quoted values)
// so anything the backend would treat as a filter becomes a chip.
export function explodeQuery(input) {
  const chips = [];
  const rest = [];
  const tokens = String(input || '').match(/(\w+:"[^"]*"|\w+:\S+|\S+)/g) || [];
  for (const raw of tokens) {
    const m = raw.match(/^(\w+):(.+)$/);
    if (m && FILTER_KEYS.has(m[1].toLowerCase())) {
      let value = m[2];
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1);
      }
      const key = normalizeKey(m[1]);
      const clean = key === 'tag' ? value.toLowerCase().replace(/^#+/, '') : value;
      if (isValidChip(key, clean)) {
        chips.push({ key, value: clean });
        continue;
      }
    }
    rest.push(raw);
  }
  return { chips, text: rest.join(' ') };
}

// Trailing in-progress token in the input, e.g. `tag:ser` — what the
// suggestion popover keys off. Returns { key, value, len } or null.
export function trailingFragment(text) {
  const m = String(text || '').match(/(\w+):("[^"]*"?|[^\s"]*)$/);
  if (!m) return null;
  const rawKey = m[1].toLowerCase();
  if (!FILTER_KEYS.has(rawKey)) return null;
  let value = m[2] || '';
  if (value.startsWith('"')) value = value.slice(1);
  if (value.endsWith('"')) value = value.slice(0, -1);
  return { key: normalizeKey(rawKey), value, len: m[0].length };
}
