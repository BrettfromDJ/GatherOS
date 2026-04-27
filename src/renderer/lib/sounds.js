// Tiny Web Audio "pop" — synthesized so we don't ship an audio
// asset. A brief high-to-low pitch sweep with a fast attack/decay
// envelope; reads as a satisfying drop confirmation.

let lastPopAt = 0;
const POP_THROTTLE_MS = 80;

export function playPop() {
  const now = Date.now();
  if (now - lastPopAt < POP_THROTTLE_MS) return;
  lastPopAt = now;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Pitch slides 900 → 180Hz over 80ms — that descending glide is
    // most of what makes it sound like a "drop."
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.32, t0 + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.15);

    setTimeout(() => { try { ctx.close(); } catch {} }, 220);
  } catch {
    // Audio unavailable (no user gesture yet, denied permissions,
    // etc.) — silently skip.
  }
}
