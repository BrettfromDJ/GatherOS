import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { useEyedropper } from '../hooks/useEyedropper.js';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;

function SidebarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <line x1="6" y1="3" x2="6" y2="13" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.75 2.5h4v4" />
      <path d="M13.75 2.5L8 8.25" />
      <path d="M13 9.5v3.5a0.5 0.5 0 0 1 -0.5 0.5H3.5a0.5 0.5 0 0 1 -0.5 -0.5V4a0.5 0.5 0 0 1 0.5 -0.5H6.5" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5v8.5" />
      <path d="M4.5 5L8 1.5 11.5 5" />
      <path d="M2.75 10v3a0.5 0.5 0 0 0 0.5 0.5h9.5a0.5 0.5 0 0 0 0.5 -0.5v-3" />
    </svg>
  );
}

function EyedropperIcon() {
  return (
    <svg
      viewBox="-1 -1 30 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M24.832 3.16716c-0.6492 -0.6551 -1.422 -1.175104 -2.2734 -1.529974 -0.8514 -0.354868 -1.7646 -0.537576 -2.68702 -0.537576 -0.92238 0 -1.83564 0.182708 -2.68704 0.537576 -0.8514 0.35487 -1.62408 0.874874 -2.27342 1.529974L5.8037 12.27458c-0.90234 0.9009 -1.49156 2.06772 -1.68088 3.32866 -0.18932 1.26096 0.03126 2.54936 0.62926 3.67552L1.676596 22.3542c-0.369556 0.3718 -0.576986 0.8748 -0.576986 1.399 0 0.524 0.20743 1.027 0.576986 1.3988l1.170664 1.1706c0.37176 0.3696 0.87466 0.577 1.39886 0.577s1.02708 -0.2074 1.39884 -0.577l3.0755 -3.0754c1.12616 0.598 2.41456 0.8186 3.67552 0.6292 1.26094 -0.1894 2.42776 -0.7786 3.32866 -1.6808L24.832 13.0881c0.6552 -0.64934 1.1752 -1.42202 1.53 -2.27342 0.3548 -0.8514 0.5376 -1.76466 0.5376 -2.68704 0 -0.9224 -0.1828 -1.83566 -0.5376 -2.68706 -0.3548 -0.8514 -0.8748 -1.62408 -1.53 -2.27342v0Z" />
      <path d="m9.03808 3.0879 15.87352 15.87348" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11" />
      <path d="M5.5 4V2.5a0.75 0.75 0 0 1 0.75 -0.75h3.5a0.75 0.75 0 0 1 0.75 0.75V4" />
      <path d="M3.75 4v9a0.75 0.75 0 0 0 0.75 0.75h7a0.75 0.75 0 0 0 0.75 -0.75V4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}

function defaultExportName(record) {
  const ext = (record.file_path.split('.').pop() || 'png').toLowerCase();
  if (record.title) return `${record.title}.${ext}`;
  return `moodmark-${record.id.slice(0, 8)}.${ext}`;
}

export default function FocusedView({
  record,
  index,
  total,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onOpenInPreview,
  onDelete,
  onToggleSidebar,
}) {
  const [zoom, setZoom] = useState(1);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const {
    picking,
    togglePicking,
    handleImageClick: handlePickerClick,
    handleImageMouseMove,
    hoverHex,
    hoverPos,
    justCopied,
  } = useEyedropper(imageRef, record.id);

  // Reset zoom whenever the user moves to a different image.
  useEffect(() => {
    setZoom(1);
  }, [record.id]);

  // Re-center the scroll position whenever the wrapper size changes,
  // so zooming feels like it pivots around the middle of the image.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
    stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
  }, [zoom, record.id]);

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
  const zoomFillPct = ((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;

  const handleExport = () => {
    window.moodmark.image.export(record.file_path, defaultExportName(record));
  };

  return (
    <div className={styles.focused}>
      <div className={styles.topBar}>
        {onToggleSidebar && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleSidebar}
            title="Toggle sidebar"
          >
            <SidebarIcon />
          </button>
        )}
        <button
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to grid"
          title="Back to grid (Esc)"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.5 3 L4.5 8 L9.5 13" />
          </svg>
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
              style={{ '--zoom-fill': `${zoomFillPct}%` }}
              aria-label="Zoom"
            />
          </div>

          <span className={styles.divider} aria-hidden="true" />

          <button
            type="button"
            className={[styles.iconBtn, picking && styles.iconBtnActive]
              .filter(Boolean)
              .join(' ')}
            title={picking ? 'Click image to sample (Esc to cancel)' : 'Pick a color from the image'}
            onClick={togglePicking}
            aria-pressed={picking}
          >
            <EyedropperIcon />
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            title="Open in Preview"
            onClick={() => onOpenInPreview(record.file_path)}
          >
            <PreviewIcon />
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            title="Export…"
            onClick={handleExport}
          >
            <ExportIcon />
          </button>

          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            title="Delete"
            onClick={() => onDelete(record.id)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={[
          styles.stage,
          zoom > 1 && styles.stageScroll,
          picking && styles.stagePicking,
        ].filter(Boolean).join(' ')}
      >
        {src && (
          <div
            className={styles.imageWrap}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <img
              ref={imageRef}
              src={src}
              className={styles.image}
              alt={record.title || ''}
              draggable={!picking}
              onClick={handlePickerClick}
              onMouseMove={handleImageMouseMove}
              onDragStart={(e) => {
                if (picking) {
                  e.preventDefault();
                  return;
                }
                // Hand the OS the file path via Electron's webContents.startDrag
                // (same path masonry cards use). preventDefault stops the
                // browser's default image-drag ghost so only the native
                // drag preview is shown.
                e.preventDefault();
                window.moodmark.drag.start({
                  files: [record.file_path],
                  thumbPath: record.thumb_path || record.file_path,
                });
              }}
            />
          </div>
        )}

        {(hasPrev || hasNext) && zoom <= 1 && !picking && (
          <div className={styles.navHint}>
            <kbd className={styles.kbd}>←</kbd>
            <kbd className={styles.kbd}>→</kbd>
            <span>to navigate</span>
          </div>
        )}
      </div>

      {picking && ReactDOM.createPortal(
        <div
          className={[
            styles.cursorTooltip,
            justCopied && styles.cursorTooltipCopied,
          ].filter(Boolean).join(' ')}
          style={{
            left: hoverPos.x || window.innerWidth / 2,
            top: hoverPos.y || window.innerHeight / 2,
          }}
          aria-hidden="true"
        >
          {justCopied ? (
            <span>Copied</span>
          ) : hoverHex ? (
            <>
              <span
                className={styles.cursorTooltipSwatch}
                style={{ background: hoverHex }}
              />
              <span>{hoverHex}</span>
            </>
          ) : (
            <span>Hover image…</span>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
