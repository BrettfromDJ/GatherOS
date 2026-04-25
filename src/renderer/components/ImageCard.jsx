import React from 'react';
import styles from './ImageCard.module.css';
import { fileUrl } from '../lib/fileUrl.js';

export default function ImageCard({ record, selected, onSelect, onOpen }) {
  const src = fileUrl(record.file_path);
  const aspect =
    record.width && record.height ? record.width / record.height : 4 / 3;

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      onClick={(e) => onSelect(record.id, e.metaKey || e.ctrlKey || e.shiftKey)}
      onDoubleClick={() => onOpen(record)}
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
        {record.favorited ? <div className={styles.star}>★</div> : null}
      </div>
      {record.title && <div className={styles.title}>{record.title}</div>}
    </button>
  );
}
