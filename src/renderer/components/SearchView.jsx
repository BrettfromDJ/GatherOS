import React, { useEffect, useMemo, useRef, useState } from 'react';
import Grid from './Grid.jsx';
import { fileUrl } from '../lib/fileUrl.js';
import styles from './SearchView.module.css';

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

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dir === 'left' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
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
  collections = [],
  onOpenCollection,
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
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
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
        <div className={styles.field}>
          <span className={styles.fieldIcon}><SearchGlyph /></span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={search}
            placeholder="Search titles, tags and sources…"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim()) onRecordSearch?.(search.trim());
              if (e.key === 'Escape' && search) {
                // Clear the query but stay in the search tab; swallow so
                // the global Esc handler doesn't also fire.
                e.preventDefault();
                e.stopPropagation();
                onSearchChange('');
              }
            }}
          />
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
                    onClick={() => submitTerm(tag.name)}
                  >
                    <span className={styles.chipHash}><HashGlyph /></span>
                    {tag.name}
                    {tag.save_count != null && (
                      <span className={styles.chipCount}>{tag.save_count}</span>
                    )}
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
