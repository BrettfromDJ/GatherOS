import React from 'react';
import styles from './Toast.module.css';

function toUrl(absolutePath) {
  if (!absolutePath) return null;
  // Custom protocol registered in the main process; encodes per-segment
  // so spaces in "Application Support" survive.
  const segments = absolutePath.split('/').map((s) => encodeURIComponent(s));
  return `moodmark-file://${segments.join('/')}`;
}

export default function Toast({ record, onDismiss }) {
  const src = toUrl(record.thumb_path);
  return (
    <div className={styles.toast} onClick={onDismiss} role="status">
      {src && <img src={src} className={styles.thumb} alt="" />}
      <span className={styles.label}>Saved to library</span>
    </div>
  );
}
