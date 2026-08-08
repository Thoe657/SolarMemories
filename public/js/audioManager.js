/* ============================================================
   AUDIO MANAGER — looping ambient pad + short UI blips, gated by
   a persisted quiet-mode toggle. Quiet mode also drives motion
   dampening (fairy-light drift/twinkle, card bob) read by
   scene.js via shouldDampenMotion(). OS-level prefers-reduced-motion
   forces motion dampening regardless of the stored toggle, since
   that's a stated accessibility preference, not just a "vibe" setting.
============================================================ */
const QUIET_KEY = 'solarmemories:quietMode';

let quiet = localStorage.getItem(QUIET_KEY) === '1';
const listeners = [];

const reducedMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export function isQuietMode() {
  return quiet;
}

export function prefersReducedMotion() {
  return !!(reducedMotionQuery && reducedMotionQuery.matches);
}

export function shouldDampenMotion() {
  return quiet || prefersReducedMotion();
}

export function setQuietMode(value) {
  quiet = !!value;
  localStorage.setItem(QUIET_KEY, quiet ? '1' : '0');
  if (quiet) stopAmbient();
  else if (audioStarted) startAmbient();
  listeners.forEach((fn) => fn(quiet));
}

export function onQuietModeChange(fn) {
  listeners.push(fn);
}

/* ----- Web Audio setup ----- */
let ctx = null;
let masterGain = null;
let ambientNodes = null;
let audioStarted = false;

function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

// Call from a real user-gesture handler (e.g. the entry screen's Enter
// button) — browsers block audio autoplay before any interaction, and
// starting here means it's ready the moment the ring view appears.
export function initAudio() {
  if (audioStarted) return;
  audioStarted = true;
  ensureContext();
  if (ctx.state === 'suspended') ctx.resume();
  if (!quiet) startAmbient();
}

// One soft looping pad: two gently detuned sines through a lowpass filter,
// with a slow LFO "breathing" the volume so it doesn't sit static.
function startAmbient() {
  if (!ctx || ambientNodes) return;
  const now = ctx.currentTime;

  const padGain = ctx.createGain();
  padGain.gain.value = 0;
  padGain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.connect(padGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 110; // A2

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 110 * Math.pow(2, 7 / 12); // fifth above
  osc2.detune.value = 6;

  osc1.connect(filter);
  osc2.connect(filter);

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.035;
  lfo.connect(lfoGain);
  lfoGain.connect(padGain.gain);

  osc1.start(now);
  osc2.start(now);
  lfo.start(now);

  const target = 0.063; // ~-24dB
  padGain.gain.linearRampToValueAtTime(target, now + 2.5);

  ambientNodes = { padGain, osc1, osc2, lfo };
}

function stopAmbient() {
  if (!ambientNodes || !ctx) return;
  const { padGain, osc1, osc2, lfo } = ambientNodes;
  const now = ctx.currentTime;
  padGain.gain.cancelScheduledValues(now);
  padGain.gain.linearRampToValueAtTime(0, now + 0.6);
  setTimeout(() => {
    [osc1, osc2, lfo].forEach((o) => {
      try { o.stop(); } catch (e) { /* already stopped */ }
    });
  }, 700);
  ambientNodes = null;
}

// Short, low-volume, skippable UI blip — `kind` just picks a pitch so
// different actions feel slightly distinct without needing sample assets.
const UI_FREQUENCIES = { select: 660, flip: 520, locked: 220 };

export function playUiSound(kind = 'select') {
  if (quiet || !ctx) return;
  const freq = UI_FREQUENCIES[kind] || 600;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.05, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.26);
}
