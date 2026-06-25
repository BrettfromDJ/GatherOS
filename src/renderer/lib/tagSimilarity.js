// Near-duplicate tag detection. Tags are stored lowercased, trimmed and
// #-stripped with a unique name, so case/# variants already collapse on
// their own. What still fragments a vocabulary is plural/singular pairs
// ("gradient" vs "gradients"), separator variants ("co-lor" vs "color"),
// and one-character typos ("gradiant"). When a freshly-typed tag looks
// like one of those, the UI can offer to merge into the existing tag
// instead of minting a near-duplicate.

// Strip to bare alphanumerics so separators/case/whitespace collapse:
// "Co-Lor" / "co lor" / "color" all normalise to "color".
function normalize(s) {
  return String(s || '').toLowerCase().replace(/^#+/, '').replace(/[^a-z0-9]/g, '');
}

// Crude singulariser covering the English plurals tags actually hit.
function singularize(s) {
  if (s.length > 4 && s.endsWith('ies')) return `${s.slice(0, -3)}y`; // bodies → body
  if (s.length > 4 && s.endsWith('ses')) return s.slice(0, -2);       // glasses → glass
  if (s.length > 3 && s.endsWith('es')) return s.slice(0, -2);        // boxes → box
  if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1); // cats → cat
  return s;
}

function stem(s) {
  return singularize(normalize(s));
}

// Levenshtein distance ≤ max, with early bail-out. Only used on longer
// words, where a single-character slip is far likelier a typo of an
// existing tag than a deliberately distinct concept.
function withinEditDistance(a, b, max) {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return false;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j += 1) prev[j] = j;
  for (let i = 1; i <= al; i += 1) {
    curr[0] = i;
    let rowBest = curr[0];
    for (let j = 1; j <= bl; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowBest) rowBest = curr[j];
    }
    if (rowBest > max) return false;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl] <= max;
}

// Returns the existing tag a draft most likely duplicates, or null.
// `excludeIds` skips tags already on the save. Prefers the most-used
// candidate so the offer points at the canonical tag.
export function findNearDuplicateTag(draft, tags, { excludeIds } = {}) {
  const d = normalize(draft);
  if (d.length < 3) return null; // too short to judge confidently
  const draftRaw = String(draft || '').trim().toLowerCase().replace(/^#+/, '');
  const dStem = stem(draft);
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);

  let best = null;
  for (const t of tags || []) {
    if (!t || !t.name || exclude.has(t.id)) continue;
    // Exact existing tag (same stored name) isn't a near-dup — it's THE
    // tag, handled by the normal suggestion/exact-match path.
    if (t.name.toLowerCase() === draftRaw) continue;
    const tn = normalize(t.name);
    if (!tn) continue;

    let isNear = false;
    if (tn === d) isNear = true;                        // separator/whitespace variant
    else if (stem(t.name) === dStem) isNear = true;     // plural/singular
    else if (d.length >= 5 && withinEditDistance(d, tn, 1)) isNear = true; // 1-char typo

    if (isNear && (!best || (t.save_count || 0) > (best.save_count || 0))) {
      best = t;
    }
  }
  return best;
}
