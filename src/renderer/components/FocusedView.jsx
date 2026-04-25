import React, { useEffect, useState } from 'react';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;

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
  const [zoom, setZoom] = useState(1);

  // Reset zoom whenever the user moves to a different image.
  useEffect(() => {
    setZoom(1);
  }, [record.id]);

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
  const isZoomed = Math.abs(zoom - 1) > 0.001;

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

        <div className={styles.actions}>
          <div className={styles.zoom} title="Zoom">
            <button
              type="button"
              className={styles.zoomLabel}
              onClick={() => setZoom(1)}
              title="Reset to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className={styles.slider}
              aria-label="Zoom"
            />
          </div>
        </div>
      </div>

      <div className={`${styles.stage} ${isZoomed ? styles.stageScroll : ''}`}>
        {src && (
          <img
            src={src}
            className={`${styles.image} ${isZoomed ? styles.imageZoomed : ''}`}
            style={isZoomed ? { transform: `scale(${zoom})` } : undefined}
            alt={record.title || ''}
            draggable={false}
          />
        )}

        {!isZoomed && hasPrev && (
          <button
            type="button"
            className={`${styles.navBtn} ${styles.navPrev}`}
            onClick={onPrev}
            title="Previous (←)"
          >
            ‹
          </button>
        )}
        {!isZoomed && hasNext && (
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
