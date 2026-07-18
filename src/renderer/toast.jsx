import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
// Pull in the design tokens defined in variables.css — without this,
// every var(--surface-1) / var(--border) / var(--text-primary) inside
// Toast.module.css resolves to the empty fallback, which is why the
// pill looked transparent against busy desktop backgrounds.
import './styles/variables.css';
import Toast from './components/Toast.jsx';

// A touch longer than the old 2.5s — the toast now offers Undo, so it
// has to stay reachable long enough to actually hit it. Hovering the
// pill pauses the countdown (see below) so a deliberate user is never
// rushed.
const TOAST_TTL_MS = 4500;
// How many recent saves the cluster can show at once.
const MAX_CLUSTER = 3;

// Single-toast model: while one is on screen, additional saves are
// accumulated into the same pill — the cluster shows the most recent
// few and the label counts them all — instead of stacking another pill.
function ToastStack() {
  const [current, setCurrent] = useState(null); // { records:[...], count } | null
  const timerRef = useRef(null);
  const hoverRef = useRef(false);
  // Tracks whether we've shown at least one toast in this window's
  // lifetime. The initial mount has current=null but we MUST NOT call
  // empty() then — that would hide the window before the pending
  // first-save IPC ever reached us.
  const hasShownRef = useRef(false);

  function arm() {
    if (timerRef.current) clearTimeout(timerRef.current);
    // Don't start counting down while the user is hovering the pill.
    if (hoverRef.current) return;
    timerRef.current = setTimeout(() => setCurrent(null), TOAST_TTL_MS);
  }

  useEffect(() => {
    return window.toast.onShow((record) => {
      setCurrent((prev) => ({
        // Most-recent-first; keep a few extra beyond the cluster so the
        // count stays honest without retaining unbounded history.
        records: [record, ...(prev?.records || [])].slice(0, MAX_CLUSTER + 6),
        count: prev ? prev.count + 1 : 1,
      }));
      arm();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Forward mouse events only while there's something to interact with.
  // Defer the "no toast → hide window" path until we've actually shown
  // one toast at least once.
  useEffect(() => {
    if (current) {
      hasShownRef.current = true;
      window.toast.setInteractive(true);
    } else if (hasShownRef.current) {
      window.toast.setInteractive(false);
      window.toast.empty();
    }
  }, [current]);

  function clear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrent(null);
  }

  // Open the most recent save inside Gather (focused view), then dismiss.
  function handleOpen(record) {
    if (record?.id) window.toast.openInApp(record.id);
    clear();
  }

  // Undo soft-deletes everything saved in this toast session back to
  // Trash (files stay on disk), then dismisses.
  function handleUndo() {
    const ids = (current?.records || []).map((r) => r.id).filter(Boolean);
    if (ids.length) window.toast.undo(ids);
    clear();
  }

  // Pause the auto-dismiss while the cursor is over the pill so the user
  // can read it / reach Undo without it vanishing mid-reach.
  function handleEnter() {
    hoverRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }
  function handleLeave() {
    hoverRef.current = false;
    if (current) arm();
  }

  // The window is sized exactly to the card now (so macOS vibrancy on
  // the window only frosts the card area). Toast is always rendered —
  // when there's nothing to show it returns an empty dark shell, which
  // keeps the glass-material vocabulary intact through the gap between
  // window-show and state-update so we never see raw light-mode
  // vibrancy.
  return (
    <div
      style={{ width: '100%', height: '100%' }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <Toast
        records={current?.records || []}
        count={current?.count || 1}
        onUndo={handleUndo}
        onOpen={handleOpen}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ToastStack />);
