import React, { useEffect } from 'react';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';

export default function FocusedView({
  record,
  index,
  total,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onPrev, onNext, hasPrev, hasNext]);

  const src = fileUrl(record.file_path);

  return (
    <div className={styles.focused}>
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onBack} title="Back to grid (Esc)">
          <span className={styles.chevron}>‹</span>
          <span>Back</span>
        </button>

        {total > 1 && (
          <div className={styles.counter}>
            {index + 1} / {total}
          </div>
        )}

        <div className={styles.actions} />
      </div>

      <div className={styles.stage}>
        {src && (
          <img
            src={src}
            className={styles.image}
            alt={record.title || ''}
            draggable={false}
          />
        )}

        {hasPrev && (
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navPrev}`}
            onClick={onPrev}
            title="Previous (←)"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navNext}`}
            onClick={onNext}
            title="Next (→)"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
