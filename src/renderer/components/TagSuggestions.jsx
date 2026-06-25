import React from 'react';
import styles from './TagSuggestions.module.css';

export default function TagSuggestions({
  suggestions,
  activeIndex,
  onPick,
  onHoverIndex,
  showCreateRow,
  draft,
}) {
  if (suggestions.length === 0 && !showCreateRow) return null;

  return (
    <div className={styles.list} role="listbox">
      {suggestions.map((tag, i) => (
        <button
          key={tag.id}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          className={[
            styles.item,
            tag.__merge && styles.mergeItem,
            i === activeIndex && styles.active,
          ].filter(Boolean).join(' ')}
          // Near-dup merge row: clarify that picking it folds the typed
          // variant into the existing tag.
          title={tag.__merge && draft
            ? `“${draft}” looks like a duplicate — use the existing #${tag.name}`
            : undefined}
          // Use mousedown so the click registers before the input's blur fires.
          onMouseDown={(e) => { e.preventDefault(); onPick(tag); }}
          onMouseEnter={() => onHoverIndex(i)}
        >
          {tag.__merge && <span className={styles.mergeBadge}>Similar</span>}
          <span className={styles.hash}>#</span>
          <span className={styles.name}>{tag.name}</span>
          {tag.__merge && draft && (
            <span className={styles.mergeNote}>merge “{draft}”</span>
          )}
          {!tag.__merge && tag.save_count > 0 && (
            <span className={styles.count}>{tag.save_count}</span>
          )}
        </button>
      ))}
      {showCreateRow && (
        <button
          type="button"
          role="option"
          aria-selected={activeIndex === suggestions.length}
          className={[
            styles.item,
            styles.createItem,
            activeIndex === suggestions.length && styles.active,
          ].filter(Boolean).join(' ')}
          onMouseDown={(e) => { e.preventDefault(); onPick({ id: null, name: draft }); }}
          onMouseEnter={() => onHoverIndex(suggestions.length)}
        >
          <span className={styles.createLabel}>Create</span>
          <span className={styles.hash}>#</span>
          <span className={styles.name}>{draft}</span>
        </button>
      )}
    </div>
  );
}
