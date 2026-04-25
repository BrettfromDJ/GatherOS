import React from 'react';
import ImageCard from './ImageCard.jsx';
import styles from './Grid.module.css';

export default function Grid({ saves, selected, onSelect, onOpen, columns, loading }) {
  if (loading && saves.length === 0) {
    return <div className={styles.state} />;
  }

  if (saves.length === 0) {
    return (
      <div className={styles.state}>
        <div className={styles.emptyTitle}>Nothing saved yet</div>
        <div className={styles.emptyHint}>
          Press ⌘⇧S to screenshot, or drag images into this window
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.grid}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {saves.map((s) => (
        <ImageCard
          key={s.id}
          record={s}
          selected={selected.has(s.id)}
          selectionActive={selected.size > 0}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
