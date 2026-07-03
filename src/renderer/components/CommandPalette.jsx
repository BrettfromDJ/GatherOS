import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Eclipse } from 'lucide-react';
import styles from './CommandPalette.module.css';
import { CollectionIcon } from './Sidebar.jsx';
import { resolveAsset } from '../lib/asset.js';

function HashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <line x1="3"  y1="6"  x2="13.5" y2="6" />
      <line x1="2.5" y1="10" x2="13"   y2="10" />
      <line x1="6.5" y1="2.5" x2="5"   y2="13.5" />
      <line x1="11"  y1="2.5" x2="9.5" y2="13.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.4" y1="10.4" x2="13.5" y2="13.5" />
    </svg>
  );
}

// Terminal-style chevron — the "this row is an action" glyph.
function CommandIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 4.5 7 8l-3.5 3.5" />
      <line x1="8.5" y1="11.5" x2="13" y2="11.5" />
    </svg>
  );
}

// Spaces glyph — the same Eclipse mark the Spaces tab uses, so the
// two surfaces read as the same thing.
function SpaceIcon() {
  return <Eclipse size={14} strokeWidth={1.6} aria-hidden="true" />;
}

const SEARCH_DEBOUNCE = 80;
const PER_GROUP = 6;
// The empty state doubles as a command menu; cap so the panel opens
// compact and typing narrows from there.
const EMPTY_STATE_COMMANDS = 9;

function matchScore(label, keywords, q) {
  const l = String(label).toLowerCase();
  if (l.startsWith(q)) return 0;
  if (l.includes(q)) return 1;
  if (keywords && String(keywords).toLowerCase().includes(q)) return 2;
  return -1;
}

// The one ⌘K surface: type to search everything — saves, collections,
// tags, spaces and app commands — grouped by type; `>` scopes to
// commands only (the Raycast convention). Replaces the old
// QuickSwitcher, which could only jump to collections/tags/saves.
export default function CommandPalette({
  open,
  onClose,
  collections = [],
  allTags = [],
  boards = [],
  commands = [],
  onPickBucket,
  onPickTag,
  onPickSave,
  onPickBoard,
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [saveResults, setSaveResults] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const pickedRef = useRef(false);

  // `>` scopes to commands; everything else searches all groups.
  const commandsOnly = query.startsWith('>');
  const q = (commandsOnly ? query.slice(1) : query).trim().toLowerCase();

  // Reset state on open / close.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setSaveResults([]);
      pickedRef.current = false;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced backend search for saves. Returns top N. The backend
  // parses filter tokens too, so `tag:serif` narrows properly here.
  useEffect(() => {
    if (!open) return;
    if (!q || commandsOnly) {
      setSaveResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const data = await window.moodmark.saves.getAll({ search: q });
        if (!cancelled) setSaveResults((data || []).slice(0, PER_GROUP));
      } catch { /* ignore */ }
    }, SEARCH_DEBOUNCE);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, commandsOnly, open]);

  const commandResults = useMemo(() => {
    if (!q) {
      // Empty query: the palette opens as a command menu.
      return commands.slice(0, commandsOnly ? commands.length : EMPTY_STATE_COMMANDS);
    }
    return commands
      .map((c) => ({ c, score: matchScore(c.label, c.keywords, q) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c)
      .slice(0, commandsOnly ? 20 : PER_GROUP);
  }, [q, commandsOnly, commands]);

  const bucketResults = useMemo(() => {
    if (!q || commandsOnly) return [];
    return collections
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, PER_GROUP);
  }, [q, commandsOnly, collections]);

  const tagResults = useMemo(() => {
    if (!q || commandsOnly) return [];
    return allTags
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, PER_GROUP);
  }, [q, commandsOnly, allTags]);

  const boardResults = useMemo(() => {
    if (!q || commandsOnly) return [];
    return boards
      .filter((b) => (b.name || '').toLowerCase().includes(q))
      .slice(0, PER_GROUP);
  }, [q, commandsOnly, boards]);

  // Flat ordered list — drives keyboard nav. Commands lead: they're
  // the group whose position muscle memory learns.
  const items = useMemo(() => {
    const out = [];
    for (const c of commandResults) out.push({ type: 'command', record: c, key: `c:${c.id}` });
    for (const b of bucketResults) out.push({ type: 'bucket', record: b, key: `b:${b.id}` });
    for (const t of tagResults) out.push({ type: 'tag', record: t, key: `t:${t.id}` });
    for (const b of boardResults) out.push({ type: 'board', record: b, key: `bd:${b.id}` });
    for (const s of saveResults) out.push({ type: 'save', record: s, key: `s:${s.id}` });
    return out;
  }, [commandResults, bucketResults, tagResults, boardResults, saveResults]);

  // Reset highlight when results change.
  useEffect(() => { setActiveIdx(0); }, [items.length]);

  // Keep active row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-qs-idx="${activeIdx}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  function pick(item) {
    if (!item || pickedRef.current) return;
    pickedRef.current = true;
    if (item.type === 'command') item.record.run?.();
    else if (item.type === 'bucket') onPickBucket?.(item.record.id);
    else if (item.type === 'tag') onPickTag?.(item.record.name);
    else if (item.type === 'board') onPickBoard?.(item.record.id);
    else if (item.type === 'save') onPickSave?.(item.record.id);
    onClose?.();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (items.length === 0 ? 0 : Math.min(items.length - 1, i + 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(items[activeIdx]);
    }
  }

  if (!open) return null;

  let runningIdx = -1;
  function nextIdx() { runningIdx += 1; return runningIdx; }

  // Shared row wiring so every group gets identical interaction:
  // commit on pointerdown (before any global mousedown listener can
  // steal the gesture), click kept as an assistive-tech fallback —
  // pickedRef makes a double fire a no-op.
  const rowProps = (idx, item) => ({
    'data-qs-idx': idx,
    type: 'button',
    className: [styles.row, activeIdx === idx && styles.rowActive].filter(Boolean).join(' '),
    onMouseEnter: () => setActiveIdx(idx),
    onPointerDown: (e) => { e.preventDefault(); pick(item); },
    onClick: () => pick(item),
  });

  return ReactDOM.createPortal(
    <div className={styles.scrim} onMouseDown={onClose}>
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}><SearchIcon /></span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Search or run a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className={styles.kbd}>esc</span>
        </div>

        {(items.length > 0) ? (
          <div className={styles.results} ref={listRef}>
            {commandResults.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupLabel}>Commands</div>
                {commandResults.map((c) => {
                  const idx = nextIdx();
                  return (
                    <button key={`c:${c.id}`} {...rowProps(idx, { type: 'command', record: c })}>
                      <span className={styles.rowIcon}>{c.Icon ? <c.Icon /> : <CommandIcon />}</span>
                      <span className={styles.rowLabel}>{c.label}</span>
                      {c.hint && <span className={styles.rowHint}>{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {bucketResults.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupLabel}>Collections</div>
                {bucketResults.map((b) => {
                  const idx = nextIdx();
                  return (
                    <button key={`b:${b.id}`} {...rowProps(idx, { type: 'bucket', record: b })}>
                      <span className={styles.rowIcon}><CollectionIcon /></span>
                      <span className={styles.rowLabel}>{b.name}</span>
                      <span className={styles.rowKind}>Collection</span>
                    </button>
                  );
                })}
              </div>
            )}

            {tagResults.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupLabel}>Tags</div>
                {tagResults.map((t) => {
                  const idx = nextIdx();
                  return (
                    <button key={`t:${t.id}`} {...rowProps(idx, { type: 'tag', record: t })}>
                      <span className={styles.rowIcon}><HashIcon /></span>
                      <span className={styles.rowLabel}>{t.name}</span>
                      <span className={styles.rowKind}>Tag</span>
                    </button>
                  );
                })}
              </div>
            )}

            {boardResults.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupLabel}>Spaces</div>
                {boardResults.map((b) => {
                  const idx = nextIdx();
                  return (
                    <button key={`bd:${b.id}`} {...rowProps(idx, { type: 'board', record: b })}>
                      <span className={styles.rowIcon}><SpaceIcon /></span>
                      <span className={styles.rowLabel}>{b.name || <span className={styles.rowUntitled}>Untitled board</span>}</span>
                      <span className={styles.rowKind}>Space</span>
                    </button>
                  );
                })}
              </div>
            )}

            {saveResults.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupLabel}>Saves</div>
                {saveResults.map((s) => {
                  const idx = nextIdx();
                  const src = resolveAsset(s, 'thumb');
                  return (
                    <button key={`s:${s.id}`} {...rowProps(idx, { type: 'save', record: s })}>
                      <span className={styles.rowThumb}>
                        {src && <img src={src} alt="" draggable={false} />}
                      </span>
                      <span className={styles.rowLabel}>
                        {s.title || <span className={styles.rowUntitled}>Untitled</span>}
                      </span>
                      <span className={styles.rowKind}>Save</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.empty}>
            {q ? `No matches for "${q}"` : 'Start typing to search…'}
          </div>
        )}

        <div className={styles.footer}>
          <span><span className={styles.kbd}>↑↓</span> navigate</span>
          <span><span className={styles.kbd}>↵</span> select</span>
          <span><span className={styles.kbd}>&gt;</span> commands only</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
