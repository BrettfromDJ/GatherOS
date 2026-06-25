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
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { tweetMediaItems } from '../lib/tweetMedia.js';
import { useEyedropper } from '../hooks/useEyedropper.js';
import TweetCard from './TweetCard.jsx';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;

// Magnifier loupe rendered at the cursor while the eyedropper is
// active. Paints the hook's N×N pixel block onto a small canvas and
// lets CSS scale it up with pixelated rendering, so each source pixel
// reads as a crisp cell. The sampled pixel sits dead-center under the
// reticle; the live hex (or "Copied" flash) shows in the label below.
function EyedropperLoupe({ loupe, hex, copied, pos }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !loupe) return;
    if (cv.width !== loupe.n) cv.width = loupe.n;
    if (cv.height !== loupe.n) cv.height = loupe.n;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, loupe.n, loupe.n);
    ctx.putImageData(loupe.block, 0, 0);
  }, [loupe]);
  return (
    <div
      className={[styles.loupe, copied && styles.loupeCopied].filter(Boolean).join(' ')}
      style={{
        left: pos.x || window.innerWidth / 2,
        top: pos.y || window.innerHeight / 2,
        '--loupe-color': hex || '#ffffff',
      }}
      aria-hidden="true"
    >
      <div className={styles.loupeDisc}>
        <canvas ref={canvasRef} className={styles.loupeCanvas} />
        <span className={styles.loupeReticle} />
      </div>
      <div className={styles.loupeLabel}>
        {copied ? (
          <span className={styles.loupeCopiedText}>Copied</span>
        ) : (
          <>
            <span className={styles.loupeSwatch} style={{ background: hex }} />
            <span>{hex}</span>
          </>
        )}
      </div>
    </div>
  );
}

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
  // Mute state lives in App (persisted in prefs) so unmuting one video
  // carries to the next one you open and survives a restart. Defaults
  // to muted.
  videoMuted = true,
  onVideoMutedChange,
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
  // Custom video controls (replaces the native control bar + its blocky
  // gradient). Driven by <video> events; reset per save.
  const videoRef = useRef(null);
  // Mute is no longer per-save state — it's driven by the videoMuted
  // prop so it persists across videos and restarts.
  const [vid, setVid] = useState({ playing: true, current: 0, duration: 0 });
  useEffect(() => { setVid({ playing: true, current: 0, duration: 0 }); }, [record.id]);
  // Push the shared mute choice onto the current element whenever it
  // changes. Clip swaps (keyed remount → fresh <video>) re-assert it
  // in onLoadedMetadata below.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = videoMuted;
  }, [videoMuted]);
  const fmtTime = (s) => {
    const t = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const toggleVideoPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const toggleVideoMute = () => {
    const next = !videoMuted;
    const v = videoRef.current;
    if (v) v.muted = next;
    // Lift the choice to App so it persists to the next video and across
    // restarts; the videoMuted prop comes back down as the source of truth.
    onVideoMutedChange?.(next);
  };
  const seekVideo = (e) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = (Number(e.target.value) / 1000) * v.duration;
  };
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
    loupe,
  } = useEyedropper(imageRef, record.id);

  // Reset zoom whenever the user moves to a different image.
  useEffect(() => {
    setZoom(1);
  }, [record.id]);

  // Warm the browser cache for a tweet's *other* images. The primary
  // (altImageIdx 0) is a local file, but the rest are remote twimg URLs
  // fetched on click — without this, clicking a thumbnail in the strip
  // has a visible load delay. Preloading the 'large' variants up front
  // makes the swap instant.
  useEffect(() => {
    let meta = null;
    try { meta = JSON.parse(record.tweet_meta || 'null'); } catch { /* ignore */ }
    // Only the remote images need warming — the primary is local.
    const remote = tweetMediaItems(record, meta)
      .filter((m) => m.type === 'image' && !m.primary)
      .map((m) => m.url);
    if (remote.length === 0) return undefined;
    const large = (u) => {
      try { const x = new URL(u); x.searchParams.set('name', 'large'); return x.toString(); }
      catch { return u; }
    };
    const imgs = remote.map((u) => {
      const im = new Image();
      im.decoding = 'async';
      im.src = large(u);
      return im;
    });
    return () => { imgs.forEach((im) => { im.src = ''; }); };
  }, [record.id, record.tweet_meta]);

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
        // A fullscreen video swallows Escape to exit fullscreen — don't
        // ALSO back out of the focused view (that was dumping the user
        // all the way to the grid). Let the browser exit fullscreen and
        // stop here; the next Escape backs out as usual.
        if (document.fullscreenElement) return;
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
  let tweetMeta = null;
  if (record.tweet_meta) {
    try {
      tweetMeta = JSON.parse(record.tweet_meta) || null;
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
      // twimg only — leave Instagram CDN + local moodmark-file URLs alone.
      if (!/(^|\.)twimg\.com$/i.test(u.hostname)) return url;
      u.searchParams.set('name', 'large');
      return u.toString();
    } catch { return url; }
  }
  // Unified media list (shared with the detail-panel thumbnail strip).
  // For video tweets this prepends the video so altImageIdx lines up and
  // you can switch off the video to its images.
  const media = tweetMediaItems(record, tweetMeta);
  const activeMedia = media.length > 0
    ? media[Math.min(Math.max(altImageIdx, 0), media.length - 1)]
    : null;
  // Show the <video> whenever the active selection is a video — the
  // local primary OR a secondary video (e.g. another reel in an
  // Instagram carousel), which streams from its remote url so it plays
  // instead of showing a frozen poster.
  const showVideo = activeMedia ? activeMedia.type === 'video' : record.kind === 'video';
  const localVideo = !activeMedia || activeMedia.primaryLocal || !activeMedia.url;
  const videoSrc = localVideo ? fileUrl(record.file_path) : activeMedia.url;

  // If the active media is a video while the eyedropper is armed (e.g.
  // paging a media tweet from a photo to its clip), disarm it — there's
  // no image to sample and the button is hidden. Defined here, after
  // showVideo, so the dependency isn't read in its temporal dead zone.
  useEffect(() => {
    if (showVideo && picking) togglePicking();
  }, [showVideo, picking, togglePicking]);
  const videoPoster = (showVideo && !localVideo && activeMedia.poster)
    ? activeMedia.poster
    : (record.thumb_path ? fileUrl(record.thumb_path) : undefined);
  const src = (activeMedia && activeMedia.type === 'image')
    ? (activeMedia.primary ? fileUrl(record.file_path) : twimgLarge(activeMedia.url))
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

          {/* No eyedropper on videos — there's no <img> to sample, and the
              focused view shows a <video> instead. Image frames of a media
              tweet (showVideo false) still get it. */}
          {record.kind !== 'url' && !isTweet && !showVideo && (
            <button
              type="button"
              className={[styles.iconBtn, picking && styles.iconBtnActive]
                .filter(Boolean)
                .join(' ')}
              data-tooltip={picking ? 'Click image to sample' : 'Pick a color'}
              data-tooltip-pos="below"
              aria-label={picking ? 'Click image to sample (Esc to cancel)' : 'Pick a color from the image'}
              onClick={togglePicking}
              aria-pressed={picking}
            >
              <EyedropperIcon />
            </button>
          )}

          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip="Open in Preview"
            data-tooltip-pos="below"
            aria-label="Open in Preview"
            onClick={() => onOpenInPreview(record.file_path)}
          >
            <PreviewIcon />
          </button>

          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip="Export"
            data-tooltip-pos="below"
            aria-label="Export"
            onClick={handleExport}
          >
            <ExportIcon />
          </button>

          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            data-tooltip="Delete"
            data-tooltip-pos="below"
            aria-label="Delete"
            onClick={() => onDelete(record.id)}
          >
            <TrashIcon />
          </button>

          <span className={styles.divider} aria-hidden="true" />

          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip="Close"
            data-tooltip-pos="below"
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
          // The floating video controls never dismiss.
          if (e.target.closest && e.target.closest(`.${styles.vControls}`)) return;
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
          // Video: clicking the picture toggles play; clicking the
          // letterbox / surrounding whitespace dismisses, mirroring the
          // image's content-vs-whitespace hit test.
          if (e.target === videoRef.current) {
            const v = videoRef.current;
            const vw = v.videoWidth;
            const vh = v.videoHeight;
            if (vw && vh) {
              const rect = v.getBoundingClientRect();
              const elAspect = rect.width / rect.height;
              const mediaAspect = vw / vh;
              let renderedW, renderedH;
              if (elAspect > mediaAspect) {
                renderedH = rect.height;
                renderedW = rect.height * mediaAspect;
              } else {
                renderedW = rect.width;
                renderedH = rect.width / mediaAspect;
              }
              const offsetX = (rect.width - renderedW) / 2;
              const offsetY = (rect.height - renderedH) / 2;
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const onContent =
                x >= offsetX && x <= offsetX + renderedW &&
                y >= offsetY && y <= offsetY + renderedH;
              if (onContent) { toggleVideoPlay(); return; }
            } else {
              // Metadata not loaded yet — toggle play, don't dismiss.
              toggleVideoPlay();
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
                source={record.source}
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
        ) : showVideo ? (
          // Video-kind save. Shown when the active selection is the
          // video itself; a video tweet's images fall through to the
          // <img> branch below so the thumbnail strip can switch to
          // them. HTML5 <video>
          // — works natively in Electron with no extra deps. We
          // mount with autoPlay loop muted so the focused view
          // feels closer to viewing a GIF on a moodboard than to
          // a YouTube player. controls let the user pause / unmute
          // when they actually want to watch with audio.
          <div
            className={`${styles.imageWrap} ${styles.videoStage}`}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            onMouseEnter={() => setVideoHovered(true)}
            onMouseLeave={() => setVideoHovered(false)}
            /* Stop mousedown so dragging the scrubber doesn't start a
               text selection on the stage. Clicks are allowed to bubble:
               the stage's handler hit-tests the video so clicking the
               picture toggles play, clicking the surrounding letterbox
               dismisses, and control clicks are spared. */
            onMouseDown={(e) => e.stopPropagation()}
          >
            <video
              // Remount on source change so paging between videos loads
              // and plays the new clip (changing src in place doesn't
              // reliably restart playback).
              key={videoSrc}
              ref={videoRef}
              src={videoSrc}
              className={styles.image}
              autoPlay
              loop
              // Mount muted so Chromium's autoplay policy lets the clip
              // start — onLoadedMetadata + toggleVideoMute then apply the
              // saved mute preference (unmuting while it's already playing
              // needs no user gesture). Without this the video never
              // autoplays and shows a blank frame.
              muted
              playsInline
              // No native control bar (its gradient scrim reads blocky);
              // we render our own glass controls below. No PiP — it pulls
              // the video out into a floating system overlay, breaking the
              // "everything in one window" model.
              disablePictureInPicture
              poster={videoPoster}
              onPlay={() => setVid((s) => ({ ...s, playing: true }))}
              onPause={() => setVid((s) => ({ ...s, playing: false }))}
              onTimeUpdate={() => { const v = videoRef.current; if (v) setVid((s) => ({ ...s, current: v.currentTime })); }}
              onLoadedMetadata={() => { const v = videoRef.current; if (v) { v.muted = videoMuted; setVid((s) => ({ ...s, duration: v.duration || 0 })); } }}
              style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
            />
            <div className={styles.vControls} data-paused={!vid.playing}>
              <button type="button" className={styles.vBtn} onClick={toggleVideoPlay} aria-label={vid.playing ? 'Pause' : 'Play'}>
                {vid.playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
              </button>
              <span className={styles.vTime}>{fmtTime(vid.current)} / {fmtTime(vid.duration)}</span>
              <input
                type="range"
                className={styles.vScrub}
                min={0}
                max={1000}
                value={vid.duration ? Math.round((vid.current / vid.duration) * 1000) : 0}
                onChange={seekVideo}
                aria-label="Seek"
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.92) ${vid.duration ? (vid.current / vid.duration) * 100 : 0}%, rgba(255,255,255,0.22) ${vid.duration ? (vid.current / vid.duration) * 100 : 0}%)`,
                }}
              />
              <button type="button" className={styles.vBtn} onClick={toggleVideoMute} aria-label={videoMuted ? 'Unmute' : 'Mute'}>
                {videoMuted ? <VolumeX size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
              </button>
            </div>
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
              /* Sync decode so switching to a (preloaded, cached) image
                 paints immediately instead of flashing blank while it
                 decodes — the swap feels instant. */
              decoding="sync"
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

      {picking && (loupe || justCopied) && ReactDOM.createPortal(
        <EyedropperLoupe
          loupe={loupe}
          hex={hoverHex}
          copied={justCopied}
          pos={hoverPos}
        />,
        document.body,
      )}
    </div>
  );
}
