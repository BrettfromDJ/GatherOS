import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './DropExperience.module.css';
import { extractDropImageUrls } from '../lib/dropUrls.js';

// Sample 5 pixels (center + 4 corners) from a loaded <img> element
// and average them into one rgb() string. Saturated tints get
// pulled toward neutral so the room "tints" rather than "paints."
function sampleTint(img) {
  try {
    const canvas = document.createElement('canvas');
    const W = 32, H = 32;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const points = [
      [W / 2, H / 2], [4, 4], [W - 5, 4], [4, H - 5], [W - 5, H - 5],
    ];
    let r = 0, g = 0, b = 0;
    for (const [x, y] of points) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      r += d[0]; g += d[1]; b += d[2];
    }
    const n = points.length;
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  } catch {
    return { r: 200, g: 200, b: 200 };
  }
}

const TILT_MAX = 9;
const TILT_VELOCITY_GAIN = 30;
const SMOOTHING = 0.18;

// Coordinates: phase ∈ idle | dragging | landing.
// During 'dragging', a generic card silhouette tracks the cursor with
// perspective tilt driven by smoothed pointer velocity. Browsers do
// not expose dropped-file bytes during dragenter/dragover for security
// reasons, so the silhouette is the right amount of "image-shaped"
// without attempting to fake the actual artwork.
//
// On drop, the renderer creates an object URL for the file, samples a
// tint color, and plays a 'landing' animation: the real image appears
// at the cursor and slides + scales to the configured landing target
// (the top-left of the grid where new saves arrive). Background color
// wash bloom-fades through both phases and exhales out as the landing
// completes. Persistence runs in parallel via the supplied callbacks.
export default function DropExperience({ onSaveFile, onSaveUrl, getLandingTarget }) {
  const [phase, setPhase] = useState('idle');
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [tint, setTint] = useState(null);
  const [landing, setLanding] = useState(null);

  // Drag enter/leave fire repeatedly as the cursor crosses child
  // boundaries. Counter pattern is the reliable way to know when
  // we've truly left the window (counter goes back to 0).
  const enterCountRef = useRef(0);
  const lastPtRef = useRef({ x: 0, y: 0, t: 0 });
  const tiltRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    function isFileDrag(dt) {
      const types = dt?.types ? Array.from(dt.types) : [];
      return types.includes('Files')
        || types.includes('text/uri-list')
        || types.includes('text/html');
    }

    function onEnter(e) {
      if (!isFileDrag(e.dataTransfer)) return;
      enterCountRef.current += 1;
      if (enterCountRef.current === 1) {
        setPhase('dragging');
        lastPtRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
        setPointer({ x: e.clientX, y: e.clientY });
      }
      e.preventDefault();
    }

    function onOver(e) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      const now = performance.now();
      const last = lastPtRef.current;
      const dt = Math.max(8, now - last.t);
      const vx = (e.clientX - last.x) / dt;
      const vy = (e.clientY - last.y) / dt;
      lastPtRef.current = { x: e.clientX, y: e.clientY, t: now };

      // Smooth the velocity into a target tilt and lerp to it so
      // jitter doesn't snap the silhouette back and forth.
      const targetX = Math.max(-TILT_MAX, Math.min(TILT_MAX, vy * TILT_VELOCITY_GAIN));
      const targetY = Math.max(-TILT_MAX, Math.min(TILT_MAX, -vx * TILT_VELOCITY_GAIN));
      tiltRef.current = {
        x: tiltRef.current.x + (targetX - tiltRef.current.x) * SMOOTHING,
        y: tiltRef.current.y + (targetY - tiltRef.current.y) * SMOOTHING,
      };
      setTilt(tiltRef.current);
      setPointer({ x: e.clientX, y: e.clientY });
    }

    function onLeave(e) {
      if (!isFileDrag(e.dataTransfer)) return;
      enterCountRef.current = Math.max(0, enterCountRef.current - 1);
      if (enterCountRef.current === 0) {
        setPhase('idle');
        tiltRef.current = { x: 0, y: 0 };
      }
    }

    function onDrop(e) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      enterCountRef.current = 0;

      const dropPt = { x: e.clientX, y: e.clientY };
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));

      if (files.length > 0) {
        playLandingForFile(files[0], dropPt);
        // Fire the save in parallel so it overlaps the animation.
        for (const f of files) onSaveFile?.(f);
        return;
      }

      // URL drag — no file bytes to preview, but kick off persistence.
      const urls = extractDropImageUrls(e.dataTransfer);
      if (urls.length > 0) {
        playSilentExhale(dropPt);
        onSaveUrl?.(urls);
        return;
      }

      setPhase('idle');
    }

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onSaveFile, onSaveUrl]);

  function playLandingForFile(file, dropPt) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sampled = sampleTint(img);
      setTint(sampled);
      const target = getLandingTarget?.() ?? {
        x: window.innerWidth * 0.25,
        y: 220,
        w: 200,
        h: 160,
      };
      // Initial preview rect — anchored at cursor with the dragged
      // card's natural aspect ratio scaled to ~220px wide.
      const startW = 220;
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      const startH = startW / aspect;
      setLanding({
        url,
        startX: dropPt.x - startW / 2,
        startY: dropPt.y - startH / 2,
        startW,
        startH,
        endX: target.x,
        endY: target.y,
        endW: target.w || startW * 0.8,
        endH: (target.w || startW * 0.8) / aspect,
      });
      setPhase('landing');
      // Cleanup after the keyframe sequence completes (matches
      // landingFly + landingFade timing in the CSS module).
      setTimeout(() => {
        URL.revokeObjectURL(url);
        setPhase('idle');
        setLanding(null);
        setTint(null);
        tiltRef.current = { x: 0, y: 0 };
      }, 720);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setPhase('idle');
    };
    img.src = url;
  }

  function playSilentExhale() {
    setPhase('landing');
    setTimeout(() => {
      setPhase('idle');
      setLanding(null);
      setTint(null);
    }, 320);
  }

  if (phase === 'idle') return null;

  const tintRgba = tint ? `${tint.r}, ${tint.g}, ${tint.b}` : '120, 120, 120';
  const showSilhouette = phase === 'dragging';
  const showLanding = phase === 'landing' && landing?.url;

  return createPortal(
    <div className={styles.layer} aria-hidden="true">
      {/* Background color wash — anchored at the pointer (or the
          drop point during landing) so the room tints from the
          right place. */}
      <div
        className={styles.colorWash}
        style={{
          background: `radial-gradient(900px 700px at ${pointer.x}px ${pointer.y}px, rgba(${tintRgba}, 0.22) 0%, rgba(${tintRgba}, 0.07) 35%, rgba(0, 0, 0, 0) 70%)`,
          opacity: phase === 'landing' ? 0 : 1,
        }}
      />

      {showSilhouette && (
        <div
          className={styles.silhouette}
          style={{
            transform:
              `translate3d(${pointer.x - 110}px, ${pointer.y - 88}px, 0) ` +
              `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(0.96)`,
          }}
        >
          <span className={styles.silhouetteHint}>Drop to save</span>
        </div>
      )}

      {showLanding && (
        <img
          src={landing.url}
          alt=""
          className={styles.landingImg}
          style={{
            // CSS custom properties drive the keyframe; the renderer
            // computes them from the drop point + landing target.
            '--start-x': `${landing.startX}px`,
            '--start-y': `${landing.startY}px`,
            '--start-w': `${landing.startW}px`,
            '--start-h': `${landing.startH}px`,
            '--end-x': `${landing.endX}px`,
            '--end-y': `${landing.endY}px`,
            '--end-w': `${landing.endW}px`,
            '--end-h': `${landing.endH}px`,
          }}
        />
      )}
    </div>,
    document.body,
  );
}

