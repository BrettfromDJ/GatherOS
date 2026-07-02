import React from 'react';
import { FolderClosed, Plus } from 'lucide-react';
import { fileUrl } from '../lib/fileUrl.js';
import styles from './ChildCollectionsRail.module.css';

// Drill-in nesting, the calm half: the top-level collection displays
// never change — children only surface HERE, as a compact rail above a
// parent collection's saves. One level deep by design (the DB enforces
// it), so this rail never recurses.
export default function ChildCollectionsRail({
  childCollections = [],
  onPick,
  onCreateChild,
}) {
  if (!childCollections.length) return null;
  return (
    <section className={styles.rail} aria-label="Collections inside this collection">
      <div className={styles.label}>Inside this collection</div>
      <div className={styles.row}>
        {childCollections.map((c) => {
          const cover = Array.isArray(c.thumbs) && c.thumbs.length > 0 ? c.thumbs[0] : null;
          const count = c.save_count || 0;
          return (
            <button
              key={c.id}
              type="button"
              className={styles.card}
              onClick={() => onPick?.(c.id)}
            >
              {cover ? (
                <img className={styles.cover} src={fileUrl(cover)} alt="" draggable={false} loading="lazy" />
              ) : (
                <span className={`${styles.cover} ${styles.coverEmpty}`} aria-hidden="true">
                  <FolderClosed size={18} strokeWidth={1.5} />
                </span>
              )}
              <span className={styles.meta}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.count}>{count} {count === 1 ? 'save' : 'saves'}</span>
              </span>
            </button>
          );
        })}
        {onCreateChild && (
          <button
            type="button"
            className={`${styles.card} ${styles.cardNew}`}
            onClick={onCreateChild}
          >
            <span className={`${styles.cover} ${styles.coverEmpty}`} aria-hidden="true">
              <Plus size={16} strokeWidth={1.6} />
            </span>
            <span className={styles.meta}>
              <span className={`${styles.name} ${styles.nameMuted}`}>New child</span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
