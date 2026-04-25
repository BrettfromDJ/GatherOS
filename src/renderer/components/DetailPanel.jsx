import React from 'react';
import styles from './DetailPanel.module.css';
import { fileUrl } from '../lib/fileUrl.js';

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function defaultExportName(record) {
  const ext = (record.file_path.split('.').pop() || 'png').toLowerCase();
  if (record.title) return `${record.title}.${ext}`;
  return `moodmark-${record.id.slice(0, 8)}.${ext}`;
}

export default function DetailPanel({
  record,
  onClose,
  onToggleFavorite,
  onDelete,
  onOpenInPreview,
}) {
  const src = fileUrl(record.file_path);
  const favorited = !!record.favorited;

  const handleExport = () => {
    window.moodmark.image.export(record.file_path, defaultExportName(record));
  };

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.headerLabel}>Details</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close">
          ×
        </button>
      </header>

      <div className={styles.preview}>
        {src && (
          <img
            src={src}
            className={styles.image}
            alt={record.title || ''}
            draggable={false}
          />
        )}
      </div>

      <dl className={styles.meta}>
        {record.title && (
          <>
            <dt>Title</dt>
            <dd>{record.title}</dd>
          </>
        )}
        <dt>Saved</dt>
        <dd>{formatDate(record.created_at)}</dd>
        {record.width && record.height && (
          <>
            <dt>Dimensions</dt>
            <dd>
              {record.width} × {record.height}
            </dd>
          </>
        )}
        {record.file_size ? (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(record.file_size)}</dd>
          </>
        ) : null}
      </dl>

      <div className={styles.actions}>
        <button
          className={`${styles.actionBtn} ${favorited ? styles.active : ''}`}
          onClick={() => onToggleFavorite(record.id, !favorited)}
        >
          {favorited ? '★ Favorited' : '☆ Favorite'}
        </button>
        <button
          className={styles.actionBtn}
          onClick={() => onOpenInPreview(record.file_path)}
        >
          Open full size
        </button>
        <button className={styles.actionBtn} onClick={handleExport}>
          Export…
        </button>
        <button
          className={`${styles.actionBtn} ${styles.danger}`}
          onClick={() => onDelete(record.id)}
        >
          Delete
        </button>
      </div>
    </aside>
  );
}
