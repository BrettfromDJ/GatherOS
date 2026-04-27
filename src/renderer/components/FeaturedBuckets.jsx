import React, { useEffect, useRef, useState } from 'react';
import styles from './FeaturedBuckets.module.css';
import { CollectionIcon } from './Sidebar.jsx';
import { fileUrl } from '../lib/fileUrl.js';

const PREVIEW_COUNT = 4;

export default function FeaturedBuckets({ collections, onPickBucket }) {
  const [previews, setPreviews] = useState({}); // { bucketId: [save, ...] }
  const [compact, setCompact] = useState(false);
  const containerRef = useRef(null);
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

  // Toggle compact based on whether a 1px sentinel sitting above
  // the row is visible inside the scroll container. IntersectionObserver
  // doesn't oscillate the way a scrollTop check did — the sentinel
  // is above the row and never moves when the row shrinks/grows,
  // so there's no feedback loop.
  useEffect(() => {
    const sc = document.querySelector('.grid-scroll');
    const sentinel = sentinelRef.current;
    if (!sc || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => setCompact(!entry.isIntersecting),
      { root: sc, threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, []);

  if (!collections || collections.length === 0) return null;

  return (
    <>
      {/* IntersectionObserver target — when this 1px line above the
          row scrolls out of view, the row collapses. */}
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
    <div
      ref={containerRef}
      className={[styles.row, compact && styles.compact].filter(Boolean).join(' ')}
    >
      <div className={styles.scroller}>
        {collections.map((c) => {
          const items = previews[c.id] || [];
          return (
            <button
              key={c.id}
              type="button"
              className={styles.card}
              onClick={() => onPickBucket?.(c.id)}
              title={c.name}
            >
              <div className={styles.stack}>
                {items.length === 0 ? (
                  <div className={styles.stackEmpty}>
                    <span className={styles.stackEmptyIcon} style={{ color: 'var(--icon-blue)' }}>
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
                <span className={styles.name}>{c.name}</span>
                <span className={styles.count}>
                  <span className={styles.countNum}>{c.save_count}</span>
                  <span className={styles.countLabel}> {c.save_count === 1 ? 'save' : 'saves'}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}
