// Web Audio "save" + "trash" sounds — synthesized in-browser so we ship
// no audio assets. A single shared AudioContext + master gain at a fixed
// volume. The save sound is the default two-blip "collect"; trash actions
// get a short whoosh. No user-facing configuration.

let ac = null;
let masterGain = null;
const VOLUME = 0.6;
function ctx() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ac = new Ctx();
    masterGain = ac.createGain();
    masterGain.gain.value = VOLUME;
    masterGain.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

// ── synthesis helpers ──────────────────────────────────────────────
function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + Math.max(a, 0.001));
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(o) {
  const c = ctx(); if (!c) return;
  const t = o.t0 ?? c.currentTime;
  const osc = c.createOscillator(); osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1 != null) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  let node = osc;
  if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
  const g = c.createGain(); node.connect(g); g.connect(masterGain);
  env(g, t, o.a ?? 0.004, o.dur - (o.a ?? 0.004), o.peak ?? 0.3);
  osc.start(t); osc.stop(t + o.dur + 0.03);
}
function noise(o) {
  const c = ctx(); if (!c) return;
  const t = o.t0 ?? c.currentTime;
  const len = Math.ceil(c.sampleRate * Math.max(o.dur, 0.05));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const n = c.createBufferSource(); n.buffer = buf;
  const filt = c.createBiquadFilter(); filt.type = o.type || 'bandpass';
  filt.frequency.setValueAtTime(o.f || 1500, t); filt.Q.value = o.q || 1;
  if (o.f1) filt.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = c.createGain(); n.connect(filt); filt.connect(g); g.connect(masterGain);
  env(g, t, o.a ?? 0.002, o.dur - (o.a ?? 0.002), o.peak ?? 0.3);
  n.start(t); n.stop(t + o.dur + 0.03);
}
const at = (off) => (ac ? ac.currentTime + off : 0);

// The save sound — two quick rising blips.
function playCollect() {
  tone({ type: 'triangle', f0: 660, dur: 0.07, peak: 0.22, lp: 3200 });
  tone({ t0: at(0.075), type: 'triangle', f0: 990, dur: 0.13, peak: 0.22, lp: 3200 });
}

let lastAt = 0;
const THROTTLE_MS = 80;

// Plays the save sound when an image lands (throttled so a rapid batch is
// one blip rather than a machine-gun).
export function playSaveSound() {
  const now = Date.now();
  if (now - lastAt < THROTTLE_MS) return;
  lastAt = now;
  try { playCollect(); } catch { /* audio unavailable — skip */ }
}

// ── trash sounds (whoosh-away) ──────────────────────────────────────
// Move-to-trash is a short downward swoosh; empty-trash is a longer sweep
// into a low thud.
let lastTrashAt = 0;
export function playTrashSound() {
  const now = Date.now();
  if (now - lastTrashAt < THROTTLE_MS) return;
  lastTrashAt = now;
  try { noise({ type: 'lowpass', f: 1700, f1: 200, dur: 0.20, a: 0.005, peak: 0.30 }); }
  catch { /* audio unavailable — skip */ }
}
export function playEmptyTrashSound() {
  try {
    noise({ type: 'lowpass', f: 2300, f1: 130, dur: 0.46, a: 0.02, peak: 0.32 });
    tone({ type: 'sine', f0: 150, f1: 60, dur: 0.18, t0: at(0.4), peak: 0.34, lp: 400 });
  } catch { /* audio unavailable — skip */ }
}

// Back-compat: useLibrary imports playPop; route it to the save sound.
export const playPop = playSaveSound;
