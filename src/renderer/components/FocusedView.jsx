import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  PanelLeft,
  ExternalLink,
  Download,
  Pipette,
  Trash2,
} from 'lucide-react';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { useEyedropper } from '../hooks/useEyedropper.js';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;

const FV_ICON = { strokeWidth: 1.6, 'aria-hidden': true };
const SidebarIcon = () => <PanelLeft {...FV_ICON} />;
const PreviewIcon = () => <ExternalLink {...FV_ICON} />;
const ExportIcon = () => <Download {...FV_ICON} />;
// Lucide's Pipette is the canonical eyedropper.
const EyedropperIcon = () => <Pipette {...FV_ICON} />;
const TrashIcon = () => <Trash2 {...FV_ICON} />;

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
  morphSource = false,
  onContextMenu,
}) {
  const [zoom, setZoom] = useState(1);
  // Capture once on mount: was this focused view opened via a morph
  // transition? If so, the .focused fadeIn keyframe is permanently
  // suppressed for this mount. Toggling it with the live morphSource
  // would re-trigger the animation when the morph ends and the class
  // gets removed, making the topBar flash from opacity 0 → 1.
  const [openedViaMorph] = useState(morphSource);
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
        // If the eyedropper is armed, Escape disarms it without
        // closing the focused view. Second Escape (when not picking)
        // is what actually backs out to the grid.
        if (picking) {
          togglePicking();
          return;
        }
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
  }, [onBack, onPrev, onNext, hasPrev, hasNext, picking, togglePicking]);

  const src = fileUrl(record.file_path);
  const zoomFillPct = ((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;

  const handleExport = () => {
    window.moodmark.image.export(record.file_path, defaultExportName(record));
  };

  return (
    <div
      className={[
        styles.focused,
        openedViaMorph && styles.focusedMorphing,
      ].filter(Boolean).join(' ')}
    >
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
        onContextMenu={onContextMenu}
        onClick={(e) => {
          // Click on the whitespace around the image dismisses the
          // focused view. Skip when:
          //   - the click landed on the image itself (the image owns
          //     its own click semantics — eyedropper, drag preview);
          //   - the eyedropper is armed (picker swallows clicks);
          //   - the user is dragging to pan a zoomed image (browser
          //     fires click only on a real click, not after a drag,
          //     so this is implicit).
          if (picking) return;
          if (e.target === imageRef.current) return;
          onBack?.();
        }}
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
              style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
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
