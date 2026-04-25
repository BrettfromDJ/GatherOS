import React, { useState } from 'react';
import styles from './DetailPanel.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { sourceName } from '../lib/sourceName.js';

function ExternalLinkIcon() {
  return (
    <svg
      className={styles.miniIcon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 2h3.5v3.5" />
      <path d="M12 2L7 7" />
      <path d="M11.5 8.5V11.5a0.5 0.5 0 0 1 -0.5 0.5H3a0.5 0.5 0 0 1 -0.5 -0.5V3.5a0.5 0.5 0 0 1 0.5 -0.5H5.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      className={styles.miniIcon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M9.5 4V2.5A0.5 0.5 0 0 0 9 2H2.5A0.5 0.5 0 0 0 2 2.5V9A0.5 0.5 0 0 0 2.5 9.5H4" />
    </svg>
  );
}

function CheckMarkIcon() {
  return (
    <svg
      className={styles.miniIcon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7.5L6 10.5 11.5 4.5" />
    </svg>
  );
}

function StarIcon({ filled }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="7,1.5 8.7,5.3 12.8,5.7 9.7,8.4 10.6,12.5 7,10.4 3.4,12.5 4.3,8.4 1.2,5.7 5.3,5.3" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 2h3.5v3.5" />
      <path d="M12 2L7 7" />
      <path d="M11.5 8.5V11.5a0.5 0.5 0 0 1 -0.5 0.5H3a0.5 0.5 0 0 1 -0.5 -0.5V3.5a0.5 0.5 0 0 1 0.5 -0.5H5.5" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 1.5v7.5" />
      <path d="M4 4.5L7 1.5 10 4.5" />
      <path d="M2.5 9v2.5a0.5 0.5 0 0 0 0.5 0.5h8a0.5 0.5 0 0 0 0.5 -0.5V9" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 3.5h10" />
      <path d="M5 3.5V2.25a0.75 0.75 0 0 1 0.75 -0.75h2.5a0.75 0.75 0 0 1 0.75 0.75V3.5" />
      <path d="M3.25 3.5v8.25a0.75 0.75 0 0 0 0.75 0.75h6a0.75 0.75 0 0 0 0.75 -0.75V3.5" />
      <path d="M5.75 6v4M8.25 6v4" />
    </svg>
  );
}

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

function fileTypeLabel(filePath) {
  if (!filePath) return null;
  const ext = (filePath.split('.').pop() || '').toUpperCase();
  if (!ext) return null;
  return ext === 'JPG' ? 'JPEG' : ext;
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
  const typeLabel = fileTypeLabel(record.file_path);
  const [copied, setCopied] = useState(false);

  const handleExport = () => {
    window.moodmark.image.export(record.file_path, defaultExportName(record));
  };

  const openSource = () => {
    if (record.source_url) window.moodmark.shell.openExternal(record.source_url);
  };

  const copySource = async () => {
    if (!record.source_url) return;
    try {
      await navigator.clipboard.writeText(record.source_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.error('Copy failed', err);
    }
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
          <div className={styles.imageWrap}>
            <img
              src={src}
              className={styles.image}
              alt={record.title || ''}
              draggable={false}
            />
            {typeLabel && <div className={styles.typeBadge}>{typeLabel}</div>}
          </div>
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
        {record.source_url ? (
          <>
            <dt>Source</dt>
            <dd className={styles.sourceCell}>
              <button
                type="button"
                className={styles.sourceLink}
                onClick={openSource}
                title={record.source_url}
              >
                <span className={styles.sourceName}>
                  {sourceName(record.source_url)}
                </span>
                <ExternalLinkIcon />
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={copySource}
                title={copied ? 'Copied!' : 'Copy URL'}
                aria-label="Copy URL"
              >
                {copied ? <CheckMarkIcon /> : <CopyIcon />}
              </button>
            </dd>
          </>
        ) : null}
      </dl>

      <div className={styles.actions}>
        <button
          className={`${styles.actionBtn} ${favorited ? styles.active : ''}`}
          onClick={() => onToggleFavorite(record.id, !favorited)}
        >
          <StarIcon filled={favorited} />
          <span>{favorited ? 'Favorited' : 'Favorite'}</span>
        </button>
        <button
          className={styles.actionBtn}
          onClick={() => onOpenInPreview(record.file_path)}
        >
          <PreviewIcon />
          <span>Open in Preview</span>
        </button>
        <button className={styles.actionBtn} onClick={handleExport}>
          <ExportIcon />
          <span>Export…</span>
        </button>
        <button
          className={`${styles.actionBtn} ${styles.danger}`}
          onClick={() => onDelete(record.id)}
        >
          <TrashIcon />
          <span>Delete</span>
        </button>
      </div>
    </aside>
  );
}
