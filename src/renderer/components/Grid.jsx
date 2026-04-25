import React, { useMemo } from 'react';
import ImageCard from './ImageCard.jsx';
import styles from './Grid.module.css';

export default function Grid({ saves, selected, onSelect, onOpen, onContextMenu, columns, loading, view }) {
  const columnBuckets = useMemo(() => {
    const buckets = Array.from({ length: columns }, () => []);
    saves.forEach((save, i) => {
      buckets[i % columns].push(save);
    });
    return buckets;
  }, [saves, columns]);

  if (loading && saves.length === 0) {
    return <div className={styles.state} />;
  }

  if (saves.length === 0) {
    const isCollection = view?.type === 'collection';
    return (
      <div className={styles.state}>
        {isCollection && (
          <div className={styles.emptyGraphic} aria-hidden="true">
            <div className={styles.blobs}>
              <div className={styles.blobA} />
              <div className={styles.blobB} />
              <div className={styles.blobC} />
            </div>
            <div className={`${styles.glassCardWrap} ${styles.cardA}`}>
              <div className={styles.glassCard} />
            </div>
            <div className={`${styles.glassCardWrap} ${styles.cardB}`}>
              <div className={styles.glassCard} />
            </div>
            <div className={`${styles.glassCardWrap} ${styles.cardC}`}>
              <div className={styles.glassCard} />
            </div>
          </div>
        )}
        <div className={styles.emptyTitle}>
          {isCollection ? 'Collection is empty' : 'Nothing saved yet'}
        </div>
        <div className={styles.emptyHint}>
          {isCollection
            ? 'Right-click any image and choose "Add to Collection"'
            : 'Press ⌘⇧S to screenshot, or drag images into this window'}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {columnBuckets.map((bucket, colIdx) => (
        <div key={colIdx} className={styles.column}>
          {bucket.map((s) => (
            <ImageCard
              key={s.id}
              record={s}
              selected={selected.has(s.id)}
              selectionActive={selected.size > 0}
              onSelect={onSelect}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
