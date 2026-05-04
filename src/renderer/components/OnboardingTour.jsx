import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './OnboardingTour.module.css';

const FLAG_KEY = 'moodmark.onboardingTooltipsShown';

// Each step targets a `[data-onboarding="..."]` selector or null
// (centered tip). Padding inflates the spotlight halo around the
// matched rect so it doesn't hug the button too tightly. Placement
// hints whether the tooltip should sit to the right / below / etc.
const STEPS = [
  {
    target: '[data-onboarding="library-switcher"]',
    placement: 'right',
    pad: 8,
    title: 'Your libraries live here',
    body: (
      <>Switch between libraries, create new ones, and rename or delete them from the sidebar.</>
    ),
  },
  {
    target: '[data-onboarding="buckets"]',
    placement: 'right',
    pad: 6,
    title: 'Organize with buckets',
    body: (
      <>
        Buckets are how you group references — moodboards, color studies,
        type explorations, anything. Drop saves into one with the +
        button, drag them between buckets, or right-click any image to
        sort it from the grid.
      </>
    ),
  },
  {
    target: null,
    placement: 'center',
    title: 'Drag images in from anywhere',
    body: (
      <>
        Drop image files, screenshots, or links straight onto the window
        — Finder, browser, Slack, anywhere. Hold <span className={styles.kbd}>⌥</span>
        {' '}while dragging a card out to send the actual file to another app.
      </>
    ),
  },
  {
    target: '[data-onboarding="search"]',
    placement: 'bottom',
    pad: 6,
    title: 'Search anything',
    body: (
      <>Type to filter by title, tags, or notes. Hit <span className={styles.kbd}>⌘</span><span className={styles.kbd}>K</span> to jump anywhere fast.</>
    ),
  },
  {
    target: null,
    placement: 'center',
    title: 'Capture without opening the app',
    body: (
      <>
        Press <span className={styles.kbd}>⌘</span><span className={styles.kbd}>⇧</span><span className={styles.kbd}>S</span>
        {' '}from anywhere to drag-select a region — or use the menu bar
        icon for full-screen and window captures.
      </>
    ),
  },
  {
    target: '[data-onboarding="settings"]',
    placement: 'right',
    pad: 6,
    title: 'Add your OpenAI key in Settings',
    body: (
      <>
        Drop a ChatGPT API key into Settings to unlock auto-titles,
        smart tags, and semantic search. Everything stays local — the
        key only leaves your machine when you opt in to a feature.
      </>
    ),
  },
];

const TIP_W = 280;
const TIP_GAP = 14;

function place(rect, placement, tipH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (placement === 'center' || !rect) {
    return {
      tipLeft: Math.max(16, (vw - TIP_W) / 2),
      tipTop: Math.max(16, vh / 2 - tipH / 2),
    };
  }

  let tipLeft;
  let tipTop;
  if (placement === 'right') {
    tipLeft = rect.right + TIP_GAP;
    tipTop = rect.top + rect.height / 2 - tipH / 2;
  } else if (placement === 'left') {
    tipLeft = rect.left - TIP_W - TIP_GAP;
    tipTop = rect.top + rect.height / 2 - tipH / 2;
  } else if (placement === 'bottom') {
    tipLeft = rect.left + rect.width / 2 - TIP_W / 2;
    tipTop = rect.bottom + TIP_GAP;
  } else {
    // 'top'
    tipLeft = rect.left + rect.width / 2 - TIP_W / 2;
    tipTop = rect.top - tipH - TIP_GAP;
  }

  // Clamp inside the viewport with a small margin so the tooltip
  // never gets clipped by a window resize.
  tipLeft = Math.max(12, Math.min(vw - TIP_W - 12, tipLeft));
  tipTop = Math.max(12, Math.min(vh - tipH - 12, tipTop));
  return { tipLeft, tipTop };
}

export default function OnboardingTour({ active, onDone }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [anchor, setAnchor] = useState({ rect: null, ready: false });
  // Real tooltip height, measured from the DOM after each render so
  // long-body steps (e.g. the Settings step) reposition tight against
  // the anchor instead of clipping at the viewport edge.
  const [tipH, setTipH] = useState(150);
  const tipRef = useRef(null);
  const rafRef = useRef(null);

  // Recompute the anchor rect whenever the step changes or the
  // window resizes. We retry briefly if the target hasn't mounted
  // yet (sidebar, search slot etc.) so the tour doesn't sit
  // un-positioned on first load.
  useLayoutEffect(() => {
    if (!active) return;
    let attempts = 0;
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      const step = STEPS[stepIdx];
      const target = step.target ? document.querySelector(step.target) : null;
      if (!target && step.target) {
        if (attempts < 20) {
          attempts += 1;
          rafRef.current = requestAnimationFrame(measure);
          return;
        }
        // Fall back to centered if the element never showed up.
        setAnchor({ rect: null, ready: true });
        return;
      }
      const rect = target ? target.getBoundingClientRect() : null;
      setAnchor({ rect, ready: true });
    };

    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [active, stepIdx]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // Sync the measured tooltip height after every render. The first
  // pass uses the seed (150px) so the initial position is roughly
  // right; the second pass kicks in once the DOM resolves the real
  // height and reposition catches up — fast enough that the user
  // doesn't see a flash on a normal-speed machine.
  useLayoutEffect(() => {
    if (!active || !tipRef.current) return;
    const next = tipRef.current.offsetHeight;
    if (next && Math.abs(next - tipH) > 1) {
      setTipH(next);
    }
  });

  if (!active || !anchor.ready) return null;

  function finish() {
    try { localStorage.setItem(FLAG_KEY, '1'); } catch {}
    onDone?.();
  }

  function next() {
    if (stepIdx >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIdx((i) => i + 1);
  }

  const step = STEPS[stepIdx];
  const { rect } = anchor;
  const { tipLeft, tipTop } = place(rect, step.placement, tipH);

  const spotlight = rect
    ? {
        left: rect.left - (step.pad ?? 6),
        top: rect.top - (step.pad ?? 6),
        width: rect.width + (step.pad ?? 6) * 2,
        height: rect.height + (step.pad ?? 6) * 2,
      }
    : null;

  const isLast = stepIdx >= STEPS.length - 1;

  return createPortal(
    <div className={styles.layer} aria-live="polite">
      {spotlight && (
        <div
          className={styles.spotlight}
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}
      <div
        ref={tipRef}
        className={styles.tooltip}
        style={{ left: tipLeft, top: tipTop, width: TIP_W }}
      >
        <h3 className={styles.title}>{step.title}</h3>
        <p className={styles.body}>{step.body}</p>
        <div className={styles.row}>
          <span className={styles.progress}>{stepIdx + 1} / {STEPS.length}</span>
          <span className={styles.actions}>
            {!isLast && (
              <button type="button" className={styles.skipBtn} onClick={finish}>
                Skip
              </button>
            )}
            <button type="button" className={styles.nextBtn} onClick={next}>
              {isLast ? 'Got it' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

OnboardingTour.shouldShow = function shouldShow() {
  try { return localStorage.getItem(FLAG_KEY) !== '1'; }
  catch { return false; }
};
