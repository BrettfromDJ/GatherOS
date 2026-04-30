import React, { useEffect, useRef, useState } from 'react';
import styles from './FeaturedBuckets.module.css';
import { CollectionIcon } from './Sidebar.jsx';
import { fileUrl } from '../lib/fileUrl.js';
import ContextMenu from './ContextMenu.jsx';

const PREVIEW_COUNT = 4;

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 2.5l2 2-7.5 7.5H4v-2z" />
      <path d="M10 4l2 2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5a0.75 0.75 0 0 1 0.75 -0.75h3.5a0.75 0.75 0 0 1 0.75 0.75V4" />
      <path d="M3.75 4v9a0.75 0.75 0 0 0 0.75 0.75h7a0.75 0.75 0 0 0 0.75 -0.75V4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

// Two-layer layout for the featured buckets:
//   1. .cardsRow flows with the masonry — when you scroll, the cards
//      go up and out of view naturally, no sticky positioning.
//   2. .pillBar is sticky at top: 0, invisible by default. Once the
//      sentinel at the bottom of .cardsRow leaves the viewport (i.e.
//      the cards have scrolled past), pillBar fades in. Scroll back
//      up and it fades out as the cards come back.
export default function FeaturedBuckets({
  collections,
  onPickBucket,
  onRenameCollection,
  onDeleteCollection,
  onShuffleView,
}) {
  const [previews, setPreviews] = useState({}); // { bucketId: [save, ...] }
  const [pillsVisible, setPillsVisible] = useState(false);
  // Right-click context menu anchor + the bucket it targets.
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, collection }
  // Inline rename state — when set, the card's name area renders an
  // input instead of the label.
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
  const sentinelRef = useRef(null);

  // Pre-fetch up to N preview images per bucket. One IPC per bucket;
  // fine for sidebars with a handful of buckets, would want a single
  // batch query at much larger scale.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next = {};
      await Promise.all(
        collections.map(async (c) => {
          try {
            const data = await window.moodmark.saves.getAll({ collectionId: c.id });
            next[c.id] = (data || []).slice(0, PREVIEW_COUNT);
          } catch {
            next[c.id] = [];
          }
        }),
      );
      if (!cancelled) setPreviews(next);
    }
    load();
    return () => { cancelled = true; };
  }, [collections]);

  // Sentinel at the bottom of .cardsRow. While it's in the scroll
  // viewport, cards are still at least partially visible — keep
  // pills hidden. Once it scrolls out the top, cards have fully
  // gone behind the title bar — fade pills in.
  useEffect(() => {
    const sc = document.querySelector('.grid-scroll');
    const sentinel = sentinelRef.current;
    if (!sc || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([entry]) => {
      setPillsVisible(!entry.isIntersecting);
    }, { root: sc, threshold: 0 });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, []);

  function handleCardContextMenu(e, collection) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, collection });
  }

  function startRename(collection) {
    setRenamingId(collection.id);
    setRenameDraft(collection.name);
    requestAnimationFrame(() => renameInputRef.current?.select());
  }

  async function commitRename() {
    const next = renameDraft.trim();
    const id = renamingId;
    setRenamingId(null);
    setRenameDraft('');
    if (!id || !next) return;
    const original = collections.find((c) => c.id === id);
    if (!original || next === original.name) return;
    await onRenameCollection?.({ id, name: next });
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  if (!collections || collections.length === 0) return null;

  return (
    <>
      {/* Sticky pill bar — always rendered, opacity-controlled.
          The outer slot is sticky+0-height so it doesn't push the
          card row down with empty space; the inner element overflows
          downward visually when pills become visible.
          pointer-events flips with visibility so clicks don't fall
          on invisible pills overlaying the masonry. */}
      <div className={styles.pillBarSlot} aria-hidden="true">
      <div
        className={[styles.pillBar, pillsVisible && styles.pillBarVisible]
          .filter(Boolean)
          .join(' ')}
        aria-hidden={!pillsVisible}
      >
        <div className={styles.scroller}>
          {collections.map((c) => {
            const items = previews[c.id] || [];
            return (
              <button
                key={`pill-${c.id}`}
                type="button"
                className={[styles.card, styles.pillCard].join(' ')}
                onClick={() => onPickBucket?.(c.id)}
                onContextMenu={(e) => handleCardContextMenu(e, c)}
                title={c.name}
                tabIndex={pillsVisible ? 0 : -1}
              >
                <div className={styles.stack}>
                  {items.length === 0 ? (
                    <div className={styles.stackEmpty}>
                      <span className={styles.stackEmptyIcon}>
                        <CollectionIcon />
                      </span>
                    </div>
                  ) : (
                    items.slice(0, 1).map((s) => (
                      <img
                        key={s.id}
                        src={fileUrl(s.thumb_path || s.file_path)}
                        alt=""
                        draggable={false}
                      />
                    ))
                  )}
                </div>
                <div className={styles.meta}>
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.count}>
                    <span className={styles.countNum}>{c.save_count}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      </div>

      {/* Cards row — normal flow, scrolls with content. */}
      <div className={styles.cardsRow}>
        <div className={styles.scroller}>
          {collections.map((c) => {
            const items = previews[c.id] || [];
            const isRenaming = renamingId === c.id;
            return (
              <div
                key={c.id}
                className={styles.card}
                role="button"
                tabIndex={isRenaming ? -1 : 0}
                onClick={(e) => {
                  if (isRenaming) return;
                  // Ignore clicks that originated on the rename input
                  // (browsers re-bubble through the wrapping div).
                  if (e.target.closest(`.${styles.cardRenameInput}`)) return;
                  onPickBucket?.(c.id);
                }}
                onKeyDown={(e) => {
                  if (isRenaming) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPickBucket?.(c.id);
                  }
                }}
                onContextMenu={(e) => handleCardContextMenu(e, c)}
                title={c.name}
              >
                <div className={styles.stack}>
                  {items.length === 0 ? (
                    <div className={styles.stackEmpty}>
                      <span className={styles.stackEmptyIcon}>
                        <CollectionIcon />
                      </span>
                    </div>
                  ) : (
                    items.slice(0, PREVIEW_COUNT).map((s) => (
                      <img
                        key={s.id}
                        src={fileUrl(s.thumb_path || s.file_path)}
                        alt=""
                        draggable={false}
                      />
                    ))
                  )}
                </div>
                <div className={styles.meta}>
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      autoFocus
                      className={styles.cardRenameInput}
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={commitRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={styles.name}>{c.name}</span>
                  )}
                  <span className={styles.count}>
                    <span className={styles.countNum}>{c.save_count}</span>
                    <span className={styles.countLabel}> {c.save_count === 1 ? 'save' : 'saves'}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sentinel at bottom of cards row — drives pillBar visibility. */}
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={[
            ...(typeof onShuffleView === 'function' ? [{
              label: 'Shuffle',
              icon: (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.5 4.5h2.3l6.4 7h2.3" />
                  <path d="M2.5 11.5h2.3l3-3.5" />
                  <path d="M8.2 7l3-3.5h2.3" />
                  <path d="M12 2.5l1.5 2-1.5 2" />
                  <path d="M12 9.5l1.5 2-1.5 2" />
                </svg>
              ),
              onClick: () => onShuffleView({ type: 'collection', id: ctxMenu.collection.id }),
            }] : []),
            {
              label: 'Rename',
              icon: <PencilIcon />,
              onClick: () => startRename(ctxMenu.collection),
            },
            {
              label: 'Delete Bucket',
              icon: <TrashIcon />,
              danger: true,
              onClick: () => onDeleteCollection?.(ctxMenu.collection.id),
            },
          ]}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}
