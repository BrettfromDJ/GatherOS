import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './QuickSwitcher.module.css';
import { CollectionIcon } from './Sidebar.jsx';
import { fileUrl } from '../lib/fileUrl.js';

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

const SEARCH_DEBOUNCE = 80;
const PER_GROUP = 6;

export default function QuickSwitcher({
  open,
  onClose,
  collections = [],
  allTags = [],
  onPickBucket,
  onPickTag,
  onPickSave,
}) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [saveResults, setSaveResults] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset state on open / close.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setSaveResults([]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced backend search for saves. Returns top N.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
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
  }, [query, open]);

  const bucketResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return collections
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, PER_GROUP);
  }, [query, collections]);

  const tagResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allTags
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, PER_GROUP);
  }, [query, allTags]);

  // Flat ordered list — drives keyboard nav.
  const items = useMemo(() => {
    const out = [];
    for (const b of bucketResults) out.push({ type: 'bucket', record: b, key: `b:${b.id}` });
    for (const t of tagResults) out.push({ type: 'tag', record: t, key: `t:${t.id}` });
    for (const s of saveResults) out.push({ type: 'save', record: s, key: `s:${s.id}` });
    return out;
  }, [bucketResults, tagResults, saveResults]);

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
    if (!item) return;
    if (item.type === 'bucket') onPickBucket?.(item.record.id);
    else if (item.type === 'tag') onPickTag?.(item.record.name);
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

  return ReactDOM.createPortal(
    <div className={styles.scrim} onMouseDown={onClose}>
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.searchRow}>
          <span className={styles.searchIcon}><SearchIcon /></span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Search collections, tags, saves…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className={styles.kbd}>esc</span>
        </div>

        {(items.length > 0) ? (
          <div className={styles.results} ref={listRef}>
            {bucketResults.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupLabel}>Collections</div>
                {bucketResults.map((b) => {
                  const idx = nextIdx();
                  return (
                    <button
                      key={`b:${b.id}`}
                      data-qs-idx={idx}
                      className={[styles.row, activeIdx === idx && styles.rowActive].filter(Boolean).join(' ')}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => pick({ type: 'bucket', record: b })}
                    >
                      <span className={styles.rowIcon}>
                        <CollectionIcon />
                      </span>
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
                    <button
                      key={`t:${t.id}`}
                      data-qs-idx={idx}
                      className={[styles.row, activeIdx === idx && styles.rowActive].filter(Boolean).join(' ')}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => pick({ type: 'tag', record: t })}
                    >
                      <span className={styles.rowIcon}><HashIcon /></span>
                      <span className={styles.rowLabel}>{t.name}</span>
                      <span className={styles.rowKind}>Tag</span>
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
                  const src = fileUrl(s.thumb_path || s.file_path);
                  return (
                    <button
                      key={`s:${s.id}`}
                      data-qs-idx={idx}
                      className={[styles.row, activeIdx === idx && styles.rowActive].filter(Boolean).join(' ')}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => pick({ type: 'save', record: s })}
                    >
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
            {query.trim() ? `No matches for "${query.trim()}"` : 'Start typing to search…'}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
