import React, { useEffect, useRef, useState } from 'react';
import styles from './FeaturedBuckets.module.css';
import { CollectionIcon } from './Sidebar.jsx';
import { fileUrl } from '../lib/fileUrl.js';

const PREVIEW_COUNT = 4;
const COMPACT_SCROLL_PX = 60;

export default function FeaturedBuckets({ collections, onPickBucket }) {
  const [previews, setPreviews] = useState({}); // { bucketId: [save, ...] }
  const [compact, setCompact] = useState(false);
  const containerRef = useRef(null);

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

  // Watch the grid's scroll container — past a small threshold the
  // bar collapses into pills.
  useEffect(() => {
    const sc = document.querySelector('.grid-scroll');
    if (!sc) return;
    function onScroll() {
      setCompact(sc.scrollTop > COMPACT_SCROLL_PX);
    }
    onScroll();
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, []);

  if (!collections || collections.length === 0) return null;

  return (
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
  );
}
