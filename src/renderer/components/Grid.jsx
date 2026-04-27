import React, { useMemo } from 'react';
import ImageCard from './ImageCard.jsx';
import styles from './Grid.module.css';

export default function Grid({ saves, selected, onSelect, onOpen, onContextMenu, onDragStart, columns, loading, view, search, semanticSearchActive, colorFilter }) {
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
    const trimmedSearch = (search || '').trim();
    const isCollection = view?.type === 'collection';

    let title = 'Nothing saved yet';
    let hint = 'Press ⌘⇧S to screenshot, or drag images into this window';
    if (trimmedSearch) {
      // Active search: distinguish "no matches" from "empty library".
      title = `No matches for "${trimmedSearch}"`;
      hint = semanticSearchActive
        ? 'Try a different description, or turn off Visual search to fall back to keyword matching.'
        : 'Try a different keyword.';
    } else if (colorFilter) {
      title = 'No saves match that color';
      hint = 'Click the chip in the toolbar to clear the filter.';
    } else if (isCollection) {
      title = 'Collection is empty';
      hint = 'Right-click any image and choose "Add to Collection"';
    }

    return (
      <div className={styles.state}>
        <div className={styles.emptyTitle}>{title}</div>
        <div className={styles.emptyHint}>{hint}</div>
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
              onDragStart={onDragStart}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
