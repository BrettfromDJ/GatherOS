import React, { useEffect, useMemo, useRef, useState } from 'react';
import Grid from './Grid.jsx';
import { fileUrl } from '../lib/fileUrl.js';
import { buildSearchPlaceholders } from '../lib/searchPlaceholders.js';
import { COLOR_SUGGESTIONS, parseHexColor, resolveColor } from '../lib/searchColors.js';
import {
  addChips,
  composeQuery,
  explodeQuery,
  quoteValue,
  trailingFragment,
} from '../lib/searchTokens.js';
import styles from './SearchView.module.css';

// How long each rotating placeholder term lingers before the next.
const PLACEHOLDER_ROTATE_MS = 2000;

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.4" y1="10.4" x2="13.5" y2="13.5" />
    </svg>
  );
}

function HashGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6" x2="13.5" y2="6" />
      <line x1="2.5" y1="10" x2="13" y2="10" />
      <line x1="6.5" y1="2.5" x2="5" y2="13.5" />
      <line x1="11" y1="2.5" x2="9.5" y2="13.5" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" />
    </svg>
  );
}

function UntaggedGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6" x2="13.5" y2="6" />
      <line x1="2.5" y1="10" x2="13" y2="10" />
      <line x1="6.5" y1="2.5" x2="5" y2="13.5" />
      <line x1="11" y1="2.5" x2="9.5" y2="13.5" />
      <line x1="2" y1="14" x2="14" y2="2" />
    </svg>
  );
}

// Sliders — the "add a filter" affordance.
function FilterGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="4.5" x2="14" y2="4.5" />
      <line x1="2" y1="11.5" x2="14" y2="11.5" />
      <circle cx="6" cy="4.5" r="1.8" fill="var(--surface-1)" />
      <circle cx="10.5" cy="11.5" r="1.8" fill="var(--surface-1)" />
    </svg>
  );
}

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

const DATE_PRESETS = [
  { label: 'A week ago', days: 7 },
  { label: 'A month ago', days: 30 },
  { label: 'Three months ago', days: 90 },
  { label: 'A year ago', days: 365 },
];

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const FILTER_MENU = [
  { key: 'tag', label: 'Tag', Glyph: HashGlyph },
  { key: 'collection', label: 'Collection', Glyph: FolderGlyph },
  { key: 'color', label: 'Color', Glyph: null }, // swatch trio drawn inline
  { key: 'before', label: 'Saved before', Glyph: CalendarGlyph },
  { key: 'after', label: 'Saved after', Glyph: CalendarGlyph },
  { key: 'is', label: 'Untagged only', Glyph: UntaggedGlyph },
];

function TokenChip({ chip, onRemove }) {
  const { key, value } = chip;
  return (
    <span className={styles.token}>
      {key === 'tag' && <span className={styles.tokenIcon}><HashGlyph /></span>}
      {key === 'collection' && <span className={styles.tokenIcon}><FolderGlyph /></span>}
      {key === 'color' && (
        <span className={styles.tokenSwatch} style={{ background: resolveColor(value) }} aria-hidden="true" />
      )}
      {(key === 'before' || key === 'after') && <span className={styles.tokenIcon}><CalendarGlyph /></span>}
      {key === 'is' && <span className={styles.tokenIcon}><UntaggedGlyph /></span>}
      <span className={styles.tokenLabel}>
        {(key === 'before' || key === 'after') && (
          <span className={styles.tokenKey}>{key} </span>
        )}
        {key === 'is' ? 'untagged' : value}
      </span>
      <button
        type="button"
        className={styles.tokenX}
        onClick={onRemove}
        aria-label={`Remove ${key === 'is' ? 'untagged' : `${key} ${value}`} filter`}
      >
        ×
      </button>
    </span>
  );
}

// The dedicated Search tab. A search-first canvas: an oversized hero
// field on top, then either a landing state (recent searches +
// suggested tags) while the query is empty, or the scrollable masonry
// of matching saves once the user types. Reuses the library <Grid> for
// results so card behavior (select, peek, drag, context menu) is
// identical to the rest of the app.
export default function SearchView({
  search,
  onSearchChange,
  onRecordSearch,
  onClearRecentSearches,
  recentSearches = [],
  suggestedTags = [],
  allTags = [],
  collections = [],
  onOpenCollection,
  onOpenCommandPalette,
  searchInputRef,
  scrollRef,
  // grid passthrough
  saves,
  selected,
  loading,
  columns,
  layout,
  view,
  semanticSearchActive,
  colorFilter,
  freshIds,
  morphId,
  tweetTypeFilter,
  sourceFilter,
  highlightId,
  onSelect,
  onSetSelection,
  onOpen,
  onContextMenu,
  onDragStart,
  onHover,
  onForceClick,
}) {
  const localRef = useRef(null);
  const inputRef = searchInputRef || localRef;
  const hasQuery = !!(search || '').trim();
  const resultCount = saves.length;

  /* ── Token state ─────────────────────────────────────────────────── */
  // Local chips+text mirror of the `search` prop. We re-derive whenever
  // the prop changes to something we didn't compose ourselves (recents
  // click, Escape clear, programmatic set) — otherwise the local shape
  // is authoritative so typing never reflows mid-keystroke.
  const [tok, setTok] = useState(() => {
    const ex = explodeQuery(search);
    return { chips: addChips([], ex.chips), text: ex.text };
  });
  const lastComposedRef = useRef(search);
  useEffect(() => {
    if (search !== lastComposedRef.current) {
      // addChips applies singleton semantics (color/is/before/after) to
      // hand-typed or recorded strings that repeat a last-wins key.
      const ex = explodeQuery(search);
      setTok({ chips: addChips([], ex.chips), text: ex.text });
      lastComposedRef.current = search;
    }
  }, [search]);
  const { chips, text } = tok;

  const commit = (next) => {
    setTok(next);
    const composed = composeQuery(next.chips, next.text);
    lastComposedRef.current = composed;
    onSearchChange(composed);
  };

  // Trailing in-progress token in the input, e.g. `tag:ser`. Anchored to
  // the end of the text so it tracks what the user is typing right now.
  const frag = useMemo(() => trailingFragment(text), [text]);

  const [focused, setFocused] = useState(false);
  const [popDismissed, setPopDismissed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const fragSignature = frag ? `${frag.key}:${frag.value}` : '';
  useEffect(() => {
    setActiveIdx(0);
    setPopDismissed(false);
  }, [fragSignature]);

  const suggestions = useMemo(() => {
    if (!frag) return [];
    const q = frag.value.toLowerCase();
    if (frag.key === 'tag') {
      const used = new Set(chips.filter((c) => c.key === 'tag').map((c) => c.value));
      return [...allTags]
        .filter((t) => !used.has(t.name.toLowerCase()) && t.name.toLowerCase().includes(q))
        .sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          if (aStarts !== bStarts) return aStarts - bStarts;
          return (b.save_count || 0) - (a.save_count || 0);
        })
        .slice(0, 8)
        .map((t) => ({
          key: 'tag',
          value: t.name.toLowerCase(),
          label: t.name,
          meta: t.save_count != null ? String(t.save_count) : null,
          Icon: HashGlyph,
        }));
    }
    if (frag.key === 'collection') {
      const used = new Set(chips.filter((c) => c.key === 'collection').map((c) => c.value.toLowerCase()));
      return collections
        .filter((c) => !used.has(c.name.toLowerCase()) && c.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((c) => ({
          key: 'collection',
          value: c.name,
          label: c.name,
          meta: c.save_count != null ? String(c.save_count) : null,
          Icon: FolderGlyph,
        }));
    }
    if (frag.key === 'color') {
      const rows = COLOR_SUGGESTIONS
        .filter((c) => (q ? c.name.startsWith(q) : true))
        .slice(0, 8)
        .map((c) => ({ key: 'color', value: c.name, label: c.name, meta: c.hex, swatch: c.hex }));
      const hex = parseHexColor(frag.value);
      if (hex) rows.unshift({ key: 'color', value: hex, label: `Use ${hex}`, swatch: hex });
      return rows;
    }
    if (frag.key === 'is') {
      return 'untagged'.startsWith(q)
        ? [{ key: 'is', value: 'untagged', label: 'Untagged', meta: 'saves with no tags', Icon: UntaggedGlyph }]
        : [];
    }
    if (frag.key === 'before' || frag.key === 'after') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(frag.value)) {
        return [{ key: frag.key, value: frag.value, label: `Use ${frag.value}`, Icon: CalendarGlyph }];
      }
      return DATE_PRESETS.map((p) => ({
        key: frag.key,
        value: isoDaysAgo(p.days),
        label: p.label,
        meta: isoDaysAgo(p.days),
        Icon: CalendarGlyph,
      }));
    }
    return [];
  }, [frag, chips, allTags, collections]);

  const popOpen = focused && !!frag && !popDismissed && suggestions.length > 0;
  const showDateHint = popOpen && (frag.key === 'before' || frag.key === 'after')
    && !/^\d{4}-\d{2}-\d{2}$/.test(frag.value);

  const applySuggestion = (row) => {
    if (!row || !frag) return;
    const base = text.slice(0, text.length - frag.len);
    commit({ chips: addChips(chips, [{ key: row.key, value: row.value }]), text: base });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const removeChip = (idx) => {
    commit({ chips: chips.filter((_, i) => i !== idx), text });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleInputChange = (val) => {
    // Chipify every COMPLETE valid token in the settled part of the
    // input (everything before the trailing in-progress fragment). This
    // catches typed-syntax-plus-space, pasted multi-token queries, and
    // free text mixed around tokens — while never grabbing the token
    // still being typed.
    const tail = trailingFragment(val);
    const head = tail ? val.slice(0, val.length - tail.len) : val;
    if (/\S/.test(head)) {
      const parsed = explodeQuery(head);
      if (parsed.chips.length) {
        const fragStr = tail ? val.slice(val.length - tail.len) : '';
        const sep = parsed.text && /\s$/.test(head) ? ' ' : '';
        commit({
          chips: addChips(chips, parsed.chips),
          text: `${parsed.text}${sep}${fragStr}`,
        });
        return;
      }
    }
    commit({ chips, text: val });
  };

  const handleKeyDown = (e) => {
    if (popOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        applySuggestion(suggestions[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        // First Esc only closes the popover; a second falls through to
        // the clear-query behavior below.
        e.preventDefault();
        e.stopPropagation();
        setPopDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter') {
      // Commit every complete typed token as chips (including the
      // trailing one) even without touching the popover.
      const parsed = explodeQuery(text);
      if (parsed.chips.length) {
        e.preventDefault();
        const nextChips = addChips(chips, parsed.chips);
        commit({ chips: nextChips, text: parsed.text });
        onRecordSearch?.(composeQuery(nextChips, parsed.text).trim());
        return;
      }
      if (search.trim()) onRecordSearch?.(search.trim());
      return;
    }
    if (e.key === 'Backspace' && text === '' && chips.length > 0) {
      e.preventDefault();
      removeChip(chips.length - 1);
      return;
    }
    if (e.key === 'Escape' && search) {
      // Clear the query but stay in the search tab; swallow so the
      // global Esc handler doesn't also fire.
      e.preventDefault();
      e.stopPropagation();
      onSearchChange('');
    }
  };

  /* ── Filter menu (the no-syntax path) ────────────────────────────── */
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterWrapRef = useRef(null);
  useEffect(() => {
    if (!filterMenuOpen) return undefined;
    const onDown = (e) => {
      if (filterWrapRef.current && !filterWrapRef.current.contains(e.target)) {
        setFilterMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [filterMenuOpen]);

  const pickFilter = (key) => {
    setFilterMenuOpen(false);
    // Commit anything complete already sitting in the input (e.g. a
    // half-finished `tag:serif` the user typed before reaching for the
    // menu) so it becomes a chip instead of stranded text.
    const parsed = explodeQuery(text);
    const baseChips = addChips(chips, parsed.chips);
    const baseText = parsed.text;
    if (key === 'is') {
      commit({ chips: addChips(baseChips, [{ key: 'is', value: 'untagged' }]), text: baseText });
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    // Seed the token prefix into the input; the suggestion popover opens
    // off the trailing fragment as soon as the field refocuses.
    const sep = baseText && !/\s$/.test(baseText) ? ' ' : '';
    commit({ chips: baseChips, text: `${baseText}${sep}${key}:` });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Focus the hero field whenever the search tab mounts.
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitTerm = (term) => {
    const t = String(term || '').trim();
    if (!t) return;
    onSearchChange(t);
    onRecordSearch?.(t);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const recents = useMemo(
    () => (recentSearches || []).filter((t) => t && t.trim()).slice(0, 6),
    [recentSearches],
  );

  // Rotating, library-personal placeholder: real tags + the dominant
  // colours in the user's own saves, cycled while the field is empty so
  // it teaches what's searchable ("Try 'navy'", "Try 'branding'").
  const placeholders = useMemo(
    () => buildSearchPlaceholders({ tags: suggestedTags, saves }),
    [suggestedTags, saves],
  );
  const [phIndex, setPhIndex] = useState(0);
  useEffect(() => {
    // Only rotate on the empty landing (no query) with more than one
    // term to cycle; pause otherwise so a typed query is never disturbed.
    if (hasQuery || placeholders.length <= 1) return undefined;
    const id = setInterval(
      () => setPhIndex((i) => (i + 1) % placeholders.length),
      PLACEHOLDER_ROTATE_MS,
    );
    return () => clearInterval(id);
  }, [hasQuery, placeholders.length]);
  const ghostTerm = placeholders.length
    ? placeholders[phIndex % placeholders.length]
    : null;

  // Horizontal collections row — left/right arrows scroll it, and each
  // arrow disables when there's nothing more to reveal that way.
  const collRef = useRef(null);
  const [collArrows, setCollArrows] = useState({ left: false, right: false });
  const updateCollArrows = () => {
    const el = collRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setCollArrows((a) => (a.left === left && a.right === right ? a : { left, right }));
  };
  const scrollColls = (dir) => {
    const el = collRef.current;
    // Page by a full view (~5 cards); mandatory snap lands it on a card edge.
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
  };
  // Re-measure when the row mounts (landing shown), its content changes,
  // or the window resizes — so the arrows only appear when it overflows.
  useEffect(() => {
    const id = requestAnimationFrame(updateCollArrows);
    window.addEventListener('resize', updateCollArrows);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', updateCollArrows);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections.length, hasQuery]);

  return (
    <div className={`grid-scroll ${styles.scroll}`} ref={scrollRef}>
      <div className={styles.hero}>
        <div className={styles.fieldWrap}>
          <div className={styles.field}>
            <span className={styles.fieldIcon}><SearchGlyph /></span>
            {chips.map((chip, i) => (
              <TokenChip
                key={`${chip.key}-${chip.value}-${i}`}
                chip={chip}
                onRemove={() => removeChip(i)}
              />
            ))}
            <div className={styles.inputWrap}>
              <input
                ref={inputRef}
                className={styles.input}
                type="text"
                value={text}
                /* Native placeholder is empty — the rotating ghost below
                   stands in for it so it can cross-fade. aria-label keeps a
                   stable name for screen readers while the visual rotates. */
                placeholder=""
                aria-label="Search your library by title, tag, source or colour"
                role="combobox"
                aria-expanded={popOpen}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={handleKeyDown}
              />
              {!hasQuery && (
                ghostTerm ? (
                  // key on the term so each rotation remounts → fade-in.
                  <span key={ghostTerm} className={styles.ghost} aria-hidden="true">
                    Try <span className={styles.ghostTerm}>“{ghostTerm}”</span>
                  </span>
                ) : (
                  <span className={styles.ghost} aria-hidden="true">
                    Search titles, tags and sources…
                  </span>
                )
              )}
            </div>
            {/* Teach the shortcut at the moment of highest relevance:
                the user is mid-search, and ⌘K would've gotten them here
                (and more) from anywhere. */}
            {onOpenCommandPalette && (
              <button
                type="button"
                className={styles.kbdBtn}
                onClick={onOpenCommandPalette}
                aria-label="Open command palette"
                data-tooltip="Search & commands anywhere"
              >
                ⌘K
              </button>
            )}
            <span className={styles.filterWrap} ref={filterWrapRef}>
              <button
                type="button"
                className={`${styles.filterBtn}${filterMenuOpen ? ` ${styles.filterBtnActive}` : ''}`}
                onClick={() => setFilterMenuOpen((v) => !v)}
                aria-label="Add a filter"
                aria-expanded={filterMenuOpen}
                data-tooltip={filterMenuOpen ? undefined : 'Add a filter'}
              >
                <FilterGlyph />
              </button>
              {filterMenuOpen && (
                <div className={styles.filterMenu} role="menu">
                  {FILTER_MENU.map(({ key, label, Glyph }) => (
                    <button
                      key={key}
                      type="button"
                      className={styles.popRow}
                      role="menuitem"
                      onClick={() => pickFilter(key)}
                    >
                      <span className={styles.popIcon}>
                        {Glyph ? <Glyph /> : (
                          <span className={styles.swatchTrio} aria-hidden="true">
                            <i style={{ background: '#ff6347' }} />
                            <i style={{ background: '#2e8b57' }} />
                            <i style={{ background: '#1e88e5' }} />
                          </span>
                        )}
                      </span>
                      <span className={styles.popLabel}>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </span>
            {hasQuery && (
              <button
                type="button"
                className={styles.clear}
                onClick={() => { onSearchChange(''); inputRef.current?.focus(); }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          {popOpen && (
            <div className={styles.pop} role="listbox" aria-label="Filter suggestions">
              {showDateHint && (
                <div className={styles.popHint}>Pick a preset or type a date — YYYY-MM-DD</div>
              )}
              {suggestions.map((row, i) => (
                <button
                  key={`${row.key}-${row.value}-${row.label}`}
                  type="button"
                  className={`${styles.popRow}${i === activeIdx ? ` ${styles.popRowActive}` : ''}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  /* Commit on pointerdown, not click: the app has several
                     document-level mousedown listeners (context menu,
                     switcher, dropdowns) that can blur the input and
                     unmount this popover between mousedown and mouseup —
                     which silently eats the click. pointerdown fires
                     before any of that can happen; preventDefault keeps
                     focus in the input. */
                  onPointerDown={(e) => {
                    e.preventDefault();
                    applySuggestion(row);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIdx(i)}
                  /* Fallback for synthetic clicks (assistive tech) that
                     skip pointer events; applySuggestion's !frag guard
                     makes a double fire a no-op. */
                  onClick={() => applySuggestion(row)}
                >
                  <span className={styles.popIcon}>
                    {row.swatch
                      ? <span className={styles.popSwatch} style={{ background: row.swatch }} />
                      : row.Icon && <row.Icon />}
                  </span>
                  <span className={styles.popLabel}>{row.label}</span>
                  {row.meta && <span className={styles.popMeta}>{row.meta}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {hasQuery ? (
          <div className={styles.meta}>
            <span className={styles.count}>{resultCount.toLocaleString()}</span>
            {' '}{resultCount === 1 ? 'result' : 'results'}
            {semanticSearchActive && <span className={styles.metaSoft}> · visual search</span>}
          </div>
        ) : (
          <div className={styles.meta}>
            <span className={styles.count}>{resultCount.toLocaleString()}</span> saves in your library
          </div>
        )}
      </div>

      {hasQuery ? (
        <Grid
          saves={saves}
          selected={selected}
          onSelect={onSelect}
          onSetSelection={onSetSelection}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
          onDragStart={onDragStart}
          onHover={onHover}
          onForceClick={onForceClick}
          columns={columns}
          loading={loading}
          view={view}
          search={search}
          semanticSearchActive={semanticSearchActive}
          colorFilter={colorFilter}
          freshIds={freshIds}
          layout={layout}
          morphId={morphId}
          tweetTypeFilter={tweetTypeFilter}
          sourceFilter={sourceFilter}
          highlightId={highlightId}
          onClearSearch={() => onSearchChange('')}
        />
      ) : (
        <div className={styles.landing}>
          {collections.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <span className={styles.label}>Your collections</span>
                {(collArrows.left || collArrows.right) && (
                  <div className={styles.collArrows}>
                    <button
                      type="button"
                      className={styles.collArrow}
                      onClick={() => scrollColls(-1)}
                      disabled={!collArrows.left}
                      aria-label="Scroll collections left"
                    >
                      <Chevron dir="left" />
                    </button>
                    <button
                      type="button"
                      className={styles.collArrow}
                      onClick={() => scrollColls(1)}
                      disabled={!collArrows.right}
                      aria-label="Scroll collections right"
                    >
                      <Chevron dir="right" />
                    </button>
                  </div>
                )}
              </div>
              <div className={styles.collRow} ref={collRef} onScroll={updateCollArrows}>
                {collections.map((c) => {
                  const covers = Array.isArray(c.thumbs) ? c.thumbs.slice(0, 4) : [];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={styles.collCard}
                      onClick={() => onOpenCollection?.(c.id)}
                    >
                      {covers.length > 0 ? (
                        <span className={styles.collFan} aria-hidden="true">
                          {covers.map((src, i) => (
                            <img key={i} src={fileUrl(src)} alt="" draggable={false} />
                          ))}
                        </span>
                      ) : (
                        <span className={`${styles.collFan} ${styles.collFanEmpty}`} aria-hidden="true">
                          <FolderGlyph />
                        </span>
                      )}
                      <span className={styles.collName}>{c.name}</span>
                      <span className={styles.collMeta}>
                        {(c.save_count ?? 0).toLocaleString()} saves
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {recents.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <span className={styles.label}>Recent</span>
                {onClearRecentSearches && (
                  <button type="button" className={styles.link} onClick={onClearRecentSearches}>
                    Clear
                  </button>
                )}
              </div>
              <div className={styles.chips}>
                {recents.map((t) => (
                  <button key={t} type="button" className={styles.chip} onClick={() => submitTerm(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </section>
          )}

          {suggestedTags.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <span className={styles.label}>Jump to a tag</span>
              </div>
              <div className={styles.chips}>
                {suggestedTags.map((tag) => (
                  <button
                    key={tag.id ?? tag.name}
                    type="button"
                    className={styles.chip}
                    onClick={() => submitTerm(`tag:${quoteValue(tag.name)}`)}
                  >
                    {/* No per-chip counts — a wall of "1"s read as a junk
                        drawer, and the chips are already ordered by count. */}
                    <span className={styles.chipHash}><HashGlyph /></span>
                    {tag.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {recents.length === 0 && suggestedTags.length === 0 && collections.length === 0 && (
            <div className={styles.blank}>Start typing to search your whole library.</div>
          )}
        </div>
      )}
    </div>
  );
}
