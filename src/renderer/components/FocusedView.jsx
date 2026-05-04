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
      viewBox="-0.75 -0.75 30 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M25.27542857142857 3.223716428571428c-0.6607928571428571 -0.6667982142857143 -1.447392857142857 -1.1960879999999998 -2.3139964285714285 -1.5572949642857141 -0.8666035714285715 -0.36120492857142855 -1.7961107142857142 -0.5471755714285714 -2.7350025 -0.5471755714285714 -0.9388510714285714 0 -1.8684192857142856 0.18597064285714285 -2.735022857142857 0.5471755714285714 -0.8666035714285715 0.3612069642857143 -1.6530814285714284 0.89049675 -2.3140167857142857 1.5572949642857141L5.9073375 12.493768928571429c-0.9184532142857142 0.9169875 -1.518195 2.1046435714285714 -1.7108957142857142 3.388100357142857 -0.19270071428571425 1.2834771428571428 0.03181821428571429 2.5948842857142855 0.6404967857142857 3.7411542857142854L1.7065352142857142 22.75338214285714c-0.37615521428571425 0.3784392857142857 -0.5872893214285714 0.8904214285714286 -0.5872893214285714 1.4239821428571429 0 0.5333571428571429 0.21113410714285713 1.0453392857142856 0.5872893214285714 1.4237785714285713l1.191568714285714 1.1915035714285716c0.37839857142857136 0.3762 0.8902789285714285 0.5873035714285714 1.4238396428571427 0.5873035714285714s1.0454207142857141 -0.21110357142857142 1.4238192857142857 -0.5873035714285714l3.1304196428571425 -3.130317857142857c1.14627 0.6086785714285714 2.4576771428571424 0.8332178571428571 3.7411542857142854 0.6404357142857142 1.2834567857142856 -0.19278214285714285 2.4711128571428573 -0.7925035714285713 3.388100357142857 -1.7108142857142856L25.27542857142857 13.321816071428572c0.6668999999999999 -0.6609353571428571 1.1961857142857142 -1.4474132142857143 1.5573214285714285 -2.3140167857142857 0.3611357142857143 -0.8666035714285715 0.5471999999999999 -1.7961717857142856 0.5471999999999999 -2.735022857142857 0 -0.9388714285714285 -0.18606428571428568 -1.8684396428571428 -0.5471999999999999 -2.7350432142857137 -0.3611357142857143 -0.8666035714285715 -0.8904214285714286 -1.6530814285714284 -1.5573214285714285 -2.3140167857142857v0Z" />
      <path d="m9.199474285714286 3.1430410714285713 16.156975714285714 16.156935" />
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
