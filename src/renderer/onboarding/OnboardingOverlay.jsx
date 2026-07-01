import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X as XIcon,
  SquareLibrary as LibraryIcon,
  Folder as FolderIcon,
  Eclipse as LayersIcon,
  PanelRight as DetailIcon,
  Gift as GiftIcon,
  Chrome as ChromeIcon,
  Camera as CameraIcon,
  Check as CheckIcon,
} from 'lucide-react';
import { useOnboarding } from './OnboardingContext.jsx';
import { resolveAsset } from '../lib/asset.js';
import styles from './OnboardingOverlay.module.css';

// Map the step's `icon` string to a lucide glyph. The first three
// match the toolbar's mode pill (Library/Collections/Spaces) so
// the walkthrough's visual vocabulary stays aligned with the live
// UI; 'detail' nods to the right-side panel that step opens, and
// 'starter' fronts the keep/fresh decision.
const STEP_ICONS = {
  library: LibraryIcon,
  collections: FolderIcon,
  spaces: LayersIcon,
  detail: DetailIcon,
  starter: GiftIcon,
  extension: ChromeIcon,
  capture: CameraIcon,
};

// Visual padding around the spotlight ring, in CSS px.
const PAD = 6;

export default function OnboardingOverlay() {
  const {
    active, step, stepIndex, totalSteps, advance, back, exit,
  } = useOnboarding();
  const [targetRect, setTargetRect] = useState(null);

  // Live-capture step state. While the step is active we listen for
  // save:created — the moment the user's screenshot lands, the step
  // flips to a success state showing THEIR pixel. permStatus lets us
  // frame the macOS Screen Recording ask before the shortcut is
  // pressed instead of the dialog ambushing the first capture.
  const isCaptureStep = active && step?.advance?.type === 'capture';
  const [capturedSave, setCapturedSave] = useState(null);
  const [permStatus, setPermStatus] = useState(null);
  useEffect(() => {
    if (!isCaptureStep) {
      setCapturedSave(null);
      return undefined;
    }
    let cancelled = false;
    window.moodmark?.capture?.permissionStatus?.()
      .then((s) => { if (!cancelled) setPermStatus(s); })
      .catch(() => { /* hint is best-effort */ });
    const off = window.moodmark?.on?.('save:created', (record) => {
      if (!cancelled && record) setCapturedSave(record);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [isCaptureStep, step?.id]);

  // Resolve + watch the target's bbox. If the target isn't in the
  // DOM yet (e.g. we're waiting for a route transition to finish),
  // poll for up to ~1s before giving up and centering the tooltip.
  useLayoutEffect(() => {
    if (!active || !step?.target) {
      setTargetRect(null);
      return undefined;
    }
    let cancelled = false;
    let raf = 0;
    let tries = 0;
    const measure = () => {
      const el = document.querySelector(step.target);
      if (!el) {
        if (tries++ < 60 && !cancelled) raf = requestAnimationFrame(measure);
        else if (!cancelled) setTargetRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setTargetRect({
        x: r.left, y: r.top, width: r.width, height: r.height,
      });
    };
    measure();
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    const ro = new ResizeObserver(measure);
    if (document.body) ro.observe(document.body);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      ro.disconnect();
    };
  }, [active, step?.id, step?.target]);

  // (No click gating — the user is free to interact with the app
  // while the walkthrough runs. Each step advances via its own
  // tooltip button, so locking the rest of the UI is overkill.)

  // Steps can declare an `onEnter` action — either a single
  // selector or an array of selectors — that the overlay clicks
  // for the user on entry from any direction. Used to normalize
  // app state so backward navigation lands in the UI forward
  // navigation set up. Array items run one per animation frame so
  // the DOM settles between clicks (switching modes before
  // clicking something that only exists in the new mode).
  useEffect(() => {
    if (!active) return undefined;
    const enter = step?.onEnter;
    if (!enter) return undefined;
    const list = Array.isArray(enter) ? enter : [enter];
    let cancelled = false;
    let raf = 0;
    let i = 0;
    const tick = () => {
      if (cancelled || i >= list.length) return;
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const sel = list[i++];
        const el = sel ? document.querySelector(sel) : null;
        if (el && typeof el.click === 'function') el.click();
        tick();
      });
    };
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, step?.id, step?.onEnter]);

  // Listen for the theme attribute flipping when a step is waiting
  // on the dark-mode toggle.
  useEffect(() => {
    if (!active) return undefined;
    if (step?.advance?.type !== 'theme') return undefined;
    const expected = step.advance.value;
    const check = () => {
      if (document.documentElement.getAttribute('data-theme') === expected) {
        advance();
      }
    };
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => mo.disconnect();
  }, [active, step?.advance?.type, step?.advance?.value, advance]);

  // Watch for a step that advances when a selector appears in the
  // DOM. No active step uses this today (kept for the case where a
  // future step wants to react to a panel / mode opening on its
  // own rather than from a Next click).
  useEffect(() => {
    if (!active) return undefined;
    if (step?.advance?.type !== 'appears') return undefined;
    const sel = step.advance.selector;
    if (!sel) return undefined;
    if (document.querySelector(sel)) { advance(); return undefined; }
    const mo = new MutationObserver(() => {
      if (document.querySelector(sel)) advance();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [active, step?.advance?.type, step?.advance?.selector, advance]);

  if (!active || !step) return null;

  return createPortal(
    <div className={styles.overlay} aria-live="polite">
      {targetRect && (
        <div
          className={styles.spotlight}
          style={{
            left: targetRect.x - PAD,
            top: targetRect.y - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
          }}
        />
      )}
      <div className={styles.tooltip}>
        <div className={styles.tooltipHeader}>
          <span className={styles.stepCount}>{stepIndex + 1}/{totalSteps}</span>
          <button
            type="button"
            className={styles.exitBtn}
            onClick={exit}
            aria-label="Exit walkthrough"
            title="Exit walkthrough"
          >
            <XIcon size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {step.title && (
          <div className={styles.title}>
            {step.icon && STEP_ICONS[step.icon] && (
              React.createElement(STEP_ICONS[step.icon], {
                size: 14,
                strokeWidth: 2,
                'aria-hidden': true,
                className: styles.titleIcon,
              })
            )}
            <span>{step.title}</span>
          </div>
        )}
        {step.body && <div className={styles.body}>{step.body}</div>}
        {isCaptureStep && !capturedSave && (
          <div className={styles.captureBlock}>
            {/* aria-hidden scopes to the decorative keycaps only — the
                row also holds a real button that must stay reachable. */}
            <div className={styles.kbdRow}>
              <span className={styles.kbdGroup} aria-hidden="true">
                <kbd className={styles.kbd}>⌘</kbd>
                <kbd className={styles.kbd}>⇧</kbd>
                <kbd className={styles.kbd}>S</kbd>
              </span>
              <span className={styles.kbdOr} aria-hidden="true">or</span>
              <button
                type="button"
                className={styles.ctaBtn}
                style={{ margin: 0 }}
                onClick={() => {
                  try { window.moodmark?.capture?.screenshot?.(); }
                  catch { /* capture is best-effort */ }
                }}
              >
                <CameraIcon size={13} strokeWidth={2} aria-hidden="true" />
                Capture now
              </button>
            </div>
            {permStatus && permStatus !== 'granted' && (
              <div className={styles.permHint}>
                macOS will ask for Screen Recording first — that's GatherOS
                doing the capturing. If it needs a relaunch, this tour will
                be here when you're back.
              </div>
            )}
          </div>
        )}
        {isCaptureStep && capturedSave && (
          <div className={styles.captureDone}>
            {resolveAsset(capturedSave, 'thumb') && (
              <img
                className={styles.captureDoneImg}
                src={resolveAsset(capturedSave, 'thumb')}
                alt=""
                draggable={false}
              />
            )}
            <span className={styles.captureDoneText}>
              <CheckIcon size={13} strokeWidth={2.4} aria-hidden="true" />
              Saved — that one's yours.
            </span>
          </div>
        )}
        {step.cta && (
          // Subtle, left-aligned install affordance directly under the
          // copy — separate from the Previous/Next navigation. Opens the
          // store listing without advancing the tour.
          <button
            type="button"
            className={styles.ctaBtn}
            onClick={() => {
              try { window.moodmark?.shell?.openUrl?.(step.cta.url); }
              catch { /* opening the store link is best-effort */ }
            }}
          >
            <ChromeIcon size={13} strokeWidth={2} aria-hidden="true" />
            {step.cta.label}
          </button>
        )}
        <div className={styles.footer}>
          {stepIndex > 0 && !step.noBack && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={back}
            >
              Previous
            </button>
          )}
          {step.advance?.type === 'next' && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                // Some steps need to nudge the app state before
                // advancing (e.g. opening a save's detail panel or
                // closing it). clickBefore can be a single
                // selector or an array — we try each in order and
                // fire on the first match.
                const sels = step.advance?.clickBefore;
                if (sels) {
                  const list = Array.isArray(sels) ? sels : [sels];
                  for (const sel of list) {
                    const el = document.querySelector(sel);
                    if (el && typeof el.click === 'function') {
                      el.click();
                      break;
                    }
                  }
                }
                advance();
              }}
            >
              {step.advance.label || 'Next'}
            </button>
          )}
          {step.advance?.type === 'capture' && (
            capturedSave ? (
              <button type="button" className={styles.primaryBtn} onClick={advance}>
                Next
              </button>
            ) : (
              <button type="button" className={styles.ghostBtn} onClick={advance}>
                {step.advance.skipLabel || 'Skip for now'}
              </button>
            )
          )}
          {step.advance?.type === 'choice' && step.advance.options.map((opt, i, arr) => (
            <button
              key={opt.value}
              type="button"
              // Last option in the array renders as the primary
              // CTA (filled pill on the right); everything before
              // it is a ghost button to its left.
              className={i === arr.length - 1 ? styles.primaryBtn : styles.ghostBtn}
              onClick={async () => {
                if (opt.action === 'remove-starter-pack') {
                  try {
                    await window.moodmark?.onboarding?.removeStarterPack?.();
                  } catch { /* non-fatal — overlay still closes */ }
                }
                advance();
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
