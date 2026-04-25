import React from 'react';
import styles from './ImageCard.module.css';
import { fileUrl } from '../lib/fileUrl.js';

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
      <path
        d="M3 7.2 L6 10 L11 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ImageCard({
  record,
  selected,
  selectionActive,
  onSelect,
  onOpen,
  onContextMenu,
}) {
  const src = fileUrl(record.file_path);
  const aspect =
    record.width && record.height ? record.width / record.height : 4 / 3;

  return (
    <button
      type="button"
      className={[
        styles.card,
        selected && styles.selected,
        selectionActive && styles.showSelectables,
      ].filter(Boolean).join(' ')}
      onClick={(e) => onSelect(record.id, e.metaKey || e.ctrlKey || e.shiftKey)}
      onDoubleClick={() => onOpen(record)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(record.id, e.clientX, e.clientY);
        }
      }}
    >
      <div className={styles.frame} style={{ aspectRatio: aspect }}>
        {src && (
          <img
            src={src}
            className={styles.image}
            alt={record.title || ''}
            loading="lazy"
            draggable={false}
          />
        )}
        <span
          role="checkbox"
          aria-checked={!!selected}
          tabIndex={-1}
          className={`${styles.checkbox} ${selected ? styles.checkboxOn : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(record.id, true);
          }}
          title={selected ? 'Deselect' : 'Select'}
        >
          {selected && <CheckIcon />}
        </span>
        {record.favorited ? <div className={styles.star}>★</div> : null}
      </div>
      {record.title && <div className={styles.title}>{record.title}</div>}
    </button>
  );
}
