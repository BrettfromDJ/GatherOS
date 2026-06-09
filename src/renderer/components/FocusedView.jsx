import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  PanelLeft,
  ChevronLeft,
  ExternalLink,
  Download,
  Pipette,
  Trash2,
  X as LucideX,
} from 'lucide-react';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { useEyedropper } from '../hooks/useEyedropper.js';
import TweetCard from './TweetCard.jsx';

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
const CloseIcon = () => <LucideX {...FV_ICON} strokeWidth={1.8} />;

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
  // X-bookmark multi-image support. App owns the index; DetailPanel's
  // tweet thumbnail strip writes to it. 0 = the locally saved primary
  // image (rendered from record.file_path), >0 = the corresponding
  // entry in record.tweet_meta.imageUrls, rendered straight from
  // pbs.twimg.com so we don't have to download every image on the
  // tweet at save time.
  altImageIdx = 0,
}) {
  const [zoom, setZoom] = useState(1);
  // Tracks whether the cursor is over the focused-view video so the
  // ← / → nav hint below can hide while the native HTML5 controls
  // strip is visible — the two pieces of chrome were stacking on top
  // of each other and reading as one floating slab.
  const [videoHovered, setVideoHovered] = useState(false);
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

  // For multi-image X-bookmark saves, the user can click any of the
  // tweet's images in the DetailPanel's tweet card to bring it into
  // the focused view. idx 0 always renders the locally saved file
  // (faster, offline-safe) — alt indices render straight from twimg.
  let tweetImageUrls = null;
  let tweetMeta = null;
  if (record.tweet_meta) {
    try {
      const parsed = JSON.parse(record.tweet_meta);
      tweetMeta = parsed || null;
      if (Array.isArray(parsed?.imageUrls) && parsed.imageUrls.length > 1) {
        tweetImageUrls = parsed.imageUrls;
      }
    } catch { /* malformed tweet_meta — fall through to single image */ }
  }
  // Text-tweet save: the stage renders a live tweet card from tweet_meta
  // instead of the captured PNG.
  const isTweet = record.kind === 'tweet' && !!tweetMeta;
  // Upscale the captured timeline thumbnail to twimg's 'large'
  // variant for the focused view. The captured URL is whatever size
  // X was rendering in the timeline grid (often 360x360), which is
  // too small for the focused canvas. We only rewrite name= and
  // leave format= alone — the previous format=jpg synthesis was
  // what broke loads for non-JPEG tweets.
  function twimgLarge(url) {
    try {
      const u = new URL(url);
      u.searchParams.set('name', 'large');
      return u.toString();
    } catch { return url; }
  }
  const src = (tweetImageUrls && altImageIdx > 0 && altImageIdx < tweetImageUrls.length)
    ? twimgLarge(tweetImageUrls[altImageIdx])
    : fileUrl(record.file_path);
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
      /* Atmospheric backdrop — heavy blur + dark overlay layer
         painted via .focused::before. Lives on the root so it
         covers the topBar too (the divider stays via topBar's
         border-bottom). For video saves we use the poster image
         (thumb_path) instead of file_path — file_path is the MP4
         and CSS background-image can't render video. */
      style={(() => {
        const bg = record.kind === 'video' && record.thumb_path
          ? fileUrl(record.thumb_path)
          : src;
        return bg ? { '--stage-bg': `url(${JSON.stringify(bg)})` } : undefined;
      })()}
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
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to grid"
          title="Back to grid (Esc)"
        >
          <ChevronLeft size={18} strokeWidth={1.6} aria-hidden="true" />
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

          {record.kind !== 'url' && !isTweet && (
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
          )}

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

          <span className={styles.divider} aria-hidden="true" />

          <button
            type="button"
            className={styles.iconBtn}
            title="Close (Esc)"
            aria-label="Close focused view"
            onClick={onBack}
            data-onboarding="detail-close"
          >
            <CloseIcon />
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
          // focused view. Skip when the eyedropper is armed (picker
          // swallows clicks). When the click lands on the <img>
          // element, it might still be in the object-fit:contain
          // letterbox bands rather than on the actual image content;
          // map the click to the rendered image rect and only spare
          // hits that fall inside it.
          if (picking) return;
          if (e.target === imageRef.current) {
            const img = imageRef.current;
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            if (nw && nh) {
              const rect = img.getBoundingClientRect();
              const elAspect = rect.width / rect.height;
              const imgAspect = nw / nh;
              let renderedW, renderedH;
              if (elAspect > imgAspect) {
                renderedH = rect.height;
                renderedW = rect.height * imgAspect;
              } else {
                renderedW = rect.width;
                renderedH = rect.width / imgAspect;
              }
              const offsetX = (rect.width - renderedW) / 2;
              const offsetY = (rect.height - renderedH) / 2;
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const onContent =
                x >= offsetX && x <= offsetX + renderedW &&
                y >= offsetY && y <= offsetY + renderedH;
              if (onContent) return;
            } else {
              // Image hasn't loaded yet; play it safe and don't dismiss.
              return;
            }
          }
          onBack?.();
        }}
      >
        {isTweet ? (
          // Text-tweet save: render a live, theme-aware tweet card from
          // tweet_meta — real selectable text, not the captured PNG.
          <div className={styles.tweetStage}>
            {/* Stop clicks/selection inside the card from bubbling to the
                stage's click-to-dismiss so the user can highlight + copy. */}
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <TweetCard
                meta={tweetMeta}
                variant="focus"
                onOpenX={record.source_url
                  ? () => window.moodmark?.shell?.openUrl?.(record.source_url)
                  : undefined}
              />
            </div>
          </div>
        ) : record.kind === 'url' && record.source_url ? (
          // URL-kind save: render the live page in a <webview>. The
          // header-strip on the persist:url-view session (set in
          // src/main/index.js) removes X-Frame-Options +
          // frame-ancestors so even iframing-hostile sites load.
          <div
            className={styles.imageWrap}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <webview
              src={record.source_url}
              partition="persist:url-view"
              allowpopups="true"
              className={styles.webview}
            />
          </div>
        ) : record.kind === 'video' ? (
          // Video-kind save (currently only created by the X
          // bookmark watcher for video-only tweets). HTML5 <video>
          // — works natively in Electron with no extra deps. We
          // mount with autoPlay loop muted so the focused view
          // feels closer to viewing a GIF on a moodboard than to
          // a YouTube player. controls let the user pause / unmute
          // when they actually want to watch with audio.
          <div
            className={styles.imageWrap}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <video
              src={fileUrl(record.file_path)}
              className={styles.image}
              controls
              autoPlay
              loop
              muted
              playsInline
              // No picture-in-picture button or right-click "Enter
              // Picture-in-Picture" — PiP carries the video out of
              // the app into a floating system overlay, which breaks
              // the moodboard-style "everything in one window" model.
              disablePictureInPicture
              controlsList="nodownload noplaybackrate"
              poster={record.thumb_path ? fileUrl(record.thumb_path) : undefined}
              onMouseEnter={() => setVideoHovered(true)}
              onMouseLeave={() => setVideoHovered(false)}
              style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
            />
          </div>
        ) : src && (
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
              /* Required for the eyedropper's getImageData call
                 on the canvas built from this img to succeed —
                 without an explicit CORS fetch the canvas gets
                 tainted and reads throw SecurityError. The
                 moodmark-file:// scheme is registered with
                 corsEnabled and responds with Access-Control-
                 Allow-Origin: * for exactly this case. */
              crossOrigin="anonymous"
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

        {(hasPrev || hasNext) && zoom <= 1 && !picking && !(record.kind === 'video' && videoHovered) && (
          <div className={styles.navHint}>
            <kbd className={styles.kbd}>←</kbd>
            <kbd className={styles.kbd}>→</kbd>
            <span>to navigate</span>
          </div>
        )}
      </div>

      {picking && (hoverHex || justCopied) && ReactDOM.createPortal(
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
          ) : (
            <>
              <span
                className={styles.cursorTooltipSwatch}
                style={{ background: hoverHex }}
              />
              <span>{hoverHex}</span>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
