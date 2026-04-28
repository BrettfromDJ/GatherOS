import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './LoadingScreen.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { playLoading, stopLoading } from '../lib/sounds.js';

// Target a roomy 36-tile sphere — dense enough to read as a globe of
// images, sparse enough that any individual tile is legible.
const SPHERE_COUNT = 36;
// ~3.0s total. The count uses an ease-out curve so it sprints out of
// the gate and crawls the last 10% — that's where the suspense lives.
const COUNT_DURATION_MS = 3000;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
// Time the exit animation needs to finish before the overlay unmounts.
const EXIT_DURATION_MS = 800;

// Fibonacci-spiral sphere distribution — gives an even spread that
// doesn't have the obvious latitude/longitude banding of naive
// (theta, phi) grids. Each point ends up on the unit sphere.
function fibonacciSphere(n) {
  const points = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    points.push({ x, y, z });
  }
  return points;
}

export default function LoadingScreen({ onDone }) {
  const [percent, setPercent] = useState(0);
  const [images, setImages] = useState([]);
  const [exiting, setExiting] = useState(false);
  const startedAt = useRef(performance.now());

  // Stable per-launch sphere geometry. Generated once so the per-tile
  // jitter we add below stays consistent for the duration of the
  // splash (re-rolling it every render would make the sphere shimmer).
  const points = useMemo(() => fibonacciSphere(SPHERE_COUNT), []);
  const jitter = useMemo(
    () => points.map(() => ({
      // Slight per-tile speed/phase variation so the sphere doesn't
      // read as a perfectly rigid solid — adds the gentle drift you
      // get on real reference walls.
      speed: 0.85 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      // 4 fixed tilt buckets (-6, -3, +3, +6) feel curated; pure
      // random rotates can produce ugly outliers.
      tilt: [-6, -3, 3, 6][Math.floor(Math.random() * 4)],
    })),
    [points],
  );

  // Pull a randomized pool of saves for the sphere. Cycle through
  // them so even a brand-new library with 6 starter cards fills all
  // 36 slots without showing obvious dups side-by-side. We jumble
  // the cycle order so the same image doesn't always appear at the
  // same sphere position across launches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await window.moodmark.saves.getAll({ sort: 'newest', view: 'all' });
        if (cancelled) return;
        const pool = (data || []).slice(0, 100);
        // Fisher–Yates shuffle the pool itself.
        const arr = pool.slice();
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        setImages(arr);
      } catch {
        if (!cancelled) setImages([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Splash sound — start on mount, fade out on unmount.
  useEffect(() => {
    playLoading();
    return () => stopLoading();
  }, []);

  // 0 → 100 percent counter, rAF-driven for smooth eased timing.
  useEffect(() => {
    let raf = 0;
    const tick = (now) => {
      const elapsed = now - startedAt.current;
      const t = Math.min(1, elapsed / COUNT_DURATION_MS);
      const pct = Math.round(easeOut(t) * 100);
      setPercent(pct);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setExiting(true);
        setTimeout(() => onDone?.(), EXIT_DURATION_MS);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  // ── Sphere rotation loop ──────────────────────────────────────────
  // We bypass React state for the per-frame transforms — every tile
  // gets its inline transform rewritten ~60 times/sec. Pushing that
  // through React would be a full re-render every frame.
  const tileRefs = useRef([]);
  const sphereRafRef = useRef(0);
  const sphereStartedAt = useRef(0);
  useEffect(() => {
    sphereStartedAt.current = performance.now();
    // Sphere visual radius — anchored at the center of the overlay.
    // Tilt the camera slightly down so we see the top of the globe.
    const RADIUS = 320;
    const CAMERA_TILT = (12 * Math.PI) / 180; // 12° down-tilt
    const cosTilt = Math.cos(CAMERA_TILT);
    const sinTilt = Math.sin(CAMERA_TILT);

    const tick = (now) => {
      const t = (now - sphereStartedAt.current) / 1000; // seconds
      // Slow rotation around Y — full revolution every ~24s.
      const baseAngle = (t * Math.PI * 2) / 24;
      for (let i = 0; i < points.length; i++) {
        const tile = tileRefs.current[i];
        if (!tile) continue;
        const p = points[i];
        const j = jitter[i];
        // Per-tile angle = base rotation + small wobble around it.
        const angle = baseAngle * j.speed + j.phase;
        // Rotate point around Y axis by `angle`.
        const rx = p.x * Math.cos(angle) + p.z * Math.sin(angle);
        const ry = p.y;
        const rz = -p.x * Math.sin(angle) + p.z * Math.cos(angle);
        // Tilt camera down on X axis.
        const ty = ry * cosTilt - rz * sinTilt;
        const tz = ry * sinTilt + rz * cosTilt;
        // Project onto screen.
        const screenX = rx * RADIUS;
        const screenY = ty * RADIUS;
        // Depth: tz ranges -1..1. Map to 0.55–1.0 scale and 0.18–1.0
        // opacity so back-of-sphere tiles fade rather than visually
        // overlap front-of-sphere ones.
        const depth = (tz + 1) / 2; // 0..1
        const scale = 0.55 + depth * 0.55;
        const opacity = 0.18 + depth * 0.82;
        const z = Math.round(depth * 1000); // for paint-order stacking
        tile.style.transform =
          `translate3d(${screenX.toFixed(2)}px, ${screenY.toFixed(2)}px, 0) ` +
          `rotate(${j.tilt}deg) scale(${scale.toFixed(3)})`;
        tile.style.opacity = opacity.toFixed(3);
        tile.style.zIndex = String(z);
      }
      sphereRafRef.current = requestAnimationFrame(tick);
    };
    sphereRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(sphereRafRef.current);
  }, [points, jitter]);

  // Cycle through the loaded saves to fill all SPHERE_COUNT slots.
  // If saves haven't loaded yet, render placeholder slots so the
  // sphere has its silhouette while we wait for the IPC.
  const tiles = images.length > 0
    ? Array.from({ length: SPHERE_COUNT }, (_, i) => images[i % images.length])
    : Array.from({ length: SPHERE_COUNT }, () => null);

  return (
    <div className={[styles.overlay, exiting && styles.exiting].filter(Boolean).join(' ')}>
      <div className={styles.sphere} aria-hidden="true">
        {tiles.map((s, i) => (
          <div
            key={i}
            ref={(el) => { tileRefs.current[i] = el; }}
            className={styles.tile}
          >
            {s ? (
              <img
                className={styles.tileImg}
                src={fileUrl(s.file_path || s.thumb_path)}
                alt=""
                draggable={false}
              />
            ) : (
              <div className={styles.tileEmpty} />
            )}
          </div>
        ))}
      </div>

      <div className={styles.counter}>
        <div className={styles.percent}>
          {percent}<span className={styles.sign}>%</span>
        </div>
        <div className={styles.bar}>
          <div className={styles.barFill} style={{ width: `${percent}%` }} />
        </div>
        <div className={styles.label}>Loading your library</div>
      </div>
    </div>
  );
}
