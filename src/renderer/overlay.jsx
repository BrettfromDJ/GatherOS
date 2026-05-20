import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function CaptureOverlay() {
  const [drag, setDrag] = useState(null);
  const [cursor, setCursor] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') window.captureOverlay.cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onMouseDown = useCallback((e) => {
    const pt = { x: e.clientX, y: e.clientY };
    setDrag({ start: pt, end: pt });
  }, []);

  const onMouseMove = useCallback((e) => {
    const pt = { x: e.clientX, y: e.clientY };
    setCursor(pt);
    setDrag((d) => (d ? { ...d, end: pt } : null));
  }, []);

  const onMouseUp = useCallback((e) => {
    if (!drag) return;
    const rect = normalizeRect(drag.start, { x: e.clientX, y: e.clientY });
    setDrag(null);
    if (rect.w < 10 || rect.h < 10) {
      window.captureOverlay.cancel();
      return;
    }
    // Send rect in CSS pixels — main process now picks the target
    // display by the rect's centre and applies that display's
    // scaleFactor when capturing. The overlay spans the union of all
    // displays so devicePixelRatio here doesn't represent any single
    // monitor reliably.
    window.captureOverlay.complete({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
    });
  }, [drag]);

  const sel = drag ? normalizeRect(drag.start, drag.end) : null;

  // Anchor the size readout to the cursor — bottom-right by default,
  // flip to top-left when the cursor is near the screen edges so the
  // chip never gets clipped.
  const READOUT_OFFSET = 12;
  const READOUT_W = 70;
  const READOUT_H = 20;
  let readoutPos = null;
  if (sel && cursor) {
    const flipX = cursor.x + READOUT_OFFSET + READOUT_W > window.innerWidth;
    const flipY = cursor.y + READOUT_OFFSET + READOUT_H > window.innerHeight;
    readoutPos = {
      left: flipX ? cursor.x - READOUT_OFFSET - READOUT_W : cursor.x + READOUT_OFFSET,
      top: flipY ? cursor.y - READOUT_OFFSET - READOUT_H : cursor.y + READOUT_OFFSET,
    };
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        background: 'transparent',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* Selection: a dimmed rectangle with a 2px white stroke. The
          rest of the screen stays at full opacity so the user can
          still see what they're framing around. */}
      {sel && (
        <div style={{
          position: 'absolute',
          left: sel.x,
          top: sel.y,
          width: sel.w,
          height: sel.h,
          background: 'rgba(0, 0, 0, 0.15)',
          border: '1px solid rgba(255, 255, 255, 0.95)',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }} />
      )}

      {/* Live W×H readout — small dark chip pinned next to the cursor. */}
      {sel && readoutPos && (
        <div style={{
          position: 'absolute',
          left: readoutPos.left,
          top: readoutPos.top,
          width: READOUT_W,
          height: READOUT_H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.78)',
          color: '#fff',
          borderRadius: 4,
          fontSize: 'var(--text-xs)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0,
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.25)',
          pointerEvents: 'none',
          fontFeatureSettings: '"tnum"',
        }}>
          {Math.round(sel.w)}×{Math.round(sel.h)}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<CaptureOverlay />);
