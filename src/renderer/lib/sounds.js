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

// Swoosh — band-pass-filtered noise burst with a frequency sweep.
// Used when a save is added to a bucket; feels like the image is
// being whisked into place.
let lastSwooshAt = 0;
const SWOOSH_THROTTLE_MS = 120;

export function playSwoosh() {
  const now = Date.now();
  if (now - lastSwooshAt < SWOOSH_THROTTLE_MS) return;
  lastSwooshAt = now;

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    const duration = 0.22;

    // Generate a short white-noise buffer and play it back.
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    // Band-pass filter sweeps high → low. The descending sweep is
    // what gives the "settling into a container" feel.
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(2400, t0);
    filter.frequency.exponentialRampToValueAtTime(700, t0 + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + duration);

    setTimeout(() => { try { ctx.close(); } catch {} }, 320);
  } catch {
    /* silent fail */
  }
}
