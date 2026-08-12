/* ============================================================
   QUALITY TIERS (Plan 3 Phase 4) — one place that decides how much
   this machine should be asked to draw.

   Why this is its own module and not a section of scene.js: the tier
   has to be known *before* the WebGLRenderer is constructed. `antialias`
   is baked into the WebGL context at construction and cannot be changed
   afterwards, so the low tier's `antialias: false` is only reachable if
   the answer already exists when that line runs. scene.js imports this
   module, so the resolution below has finished before scene.js's body
   starts — including the localStorage read, which is why a machine that
   settled on a tier last session starts there this session instead of
   re-learning it.

   Precedence, highest first:
     1. prefers-reduced-motion — forces low, over everything. A stated
        accessibility preference, not a capability signal, so no
        measurement and no explicit choice outranks it.
     2. ?quality=high|medium|low — a deliberate override for testing the
        low path on a machine fast enough never to earn it.
     3. an explicit choice made in the entry screen's selector, persisted.
     4. a verdict this machine reached in an earlier session, persisted.
     5. high, and let the rolling frame-time average in scene.js step it
        down if the machine can't hold it.
   3 and 2 also *pin* the tier: the rolling average never moves a tier the
   user asked for by name. It only ever moves one that was assumed (5) or
   measured (4).
============================================================ */
import { prefersReducedMotion } from './motionPreference.js';

// Ordered best → worst. Stepping "down" means moving one place right,
// which is the only direction the runtime measurement is allowed to move.
export const TIERS = ['high', 'medium', 'low'];

/* The tier table from docs/PLAN.md, as data. Two of these columns are not
   read by anything yet, on purpose:
     - cardTexture is Phase 6's (a card's texture is baked when the card is
       built, in cards.js),
     - hyperspaceStars is Phase 8's (that canvas belongs to planetPicker.js;
       `moon` and `planet` are its two HYPERSPACE_PRESETS).
   They live here now so the table stays one table rather than three
   half-tables in three modules. */
export const TIER_SETTINGS = {
  high: {
    pixelRatioCap: 2,
    antialias: true,
    targetFps: 60,
    distantStars: 900,
    fairyLights: 120,
    cardTexture: { width: 512, height: 600 },
    hyperspaceStars: { moon: 420, planet: 220 }
  },
  medium: {
    pixelRatioCap: 1.5,
    antialias: true,
    targetFps: 60,
    distantStars: 600,
    fairyLights: 60,
    cardTexture: { width: 512, height: 600 },
    hyperspaceStars: { moon: 260, planet: 160 }
  },
  low: {
    pixelRatioCap: 1,
    antialias: false,
    // 60 like the others, deliberately. The low tier's job is to reach the
    // same frame rate by drawing *less*, not to settle for a slower one —
    // it already gives up antialias, half the pixel ratio, two thirds of the
    // fairy lights and a smaller card texture to pay for it. It targeted 30
    // until 2026-08-12, which had the perverse result of making low the
    // slowest tier by design on top of the throttle bug it interacted with
    // (see scene.js's animate()).
    targetFps: 60,
    distantStars: 400,
    fairyLights: 24,
    cardTexture: { width: 384, height: 450 },
    hyperspaceStars: { moon: 140, planet: 100 }
  }
};

/* ============================================================
   PERSISTENCE

   One key holding one JSON record: the user's explicit choice (or
   'auto') and the last measured verdict, alongside the schema version.

   The version guards the *table*, not just the record's shape: a stored
   verdict of "medium" means "medium as it was tuned when this was
   written". Retune the table and that sentence stops being true, so a
   mismatch throws the whole record away rather than trying to rescue
   half of it — a stale verdict is worse than no verdict, because it
   skips the learning it claims to have already done. Bump this whenever
   TIER_SETTINGS changes meaningfully.

   v2 (2026-08-12): every tier targets 60fps, and scene.js's throttle no
   longer loses frames to vsync aliasing. Every v1 verdict was measured
   against a loop that couldn't hit its own target, so all of them are
   discarded rather than trusted.

   Every access is wrapped: localStorage is absent in some embeddings,
   throws SecurityError outright when site data is disabled, and throws
   QuotaExceededError on write in private mode. None of that is allowed
   to stop the app from starting — it just means the tier doesn't persist.
============================================================ */
export const QUALITY_SCHEMA_VERSION = 2;
const STORAGE_KEY = 'solarMemories.quality';

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== QUALITY_SCHEMA_VERSION) return null;
    return {
      choice: parsed.choice === 'auto' || TIERS.includes(parsed.choice) ? parsed.choice : 'auto',
      verdict: TIERS.includes(parsed.verdict) ? parsed.verdict : null
    };
  } catch (e) {
    return null;
  }
}

function writeStored() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: QUALITY_SCHEMA_VERSION,
      choice,
      verdict
    }));
  } catch (e) {
    // Nothing to do and nothing worth warning about on every save: the
    // session simply runs without remembering its tier.
  }
}

const stored = readStored();
let choice = stored ? stored.choice : 'auto';   // 'auto' | tier name
let verdict = stored ? stored.verdict : null;   // tier name | null
let measuredThisSession = false;

const rawQualityParam = new URLSearchParams(location.search).get('quality');
const queryTier = TIERS.includes(rawQualityParam) ? rawQualityParam : null;

/* Resolves the precedence chain above into a tier and *why* it is that
   tier — the source is what the perf HUD prints and what verification
   reads, so "low because you asked" and "low because this machine
   couldn't hold high" are never confused for each other. */
function resolve() {
  if (prefersReducedMotion()) return { tier: 'low', source: 'reduced-motion' };
  if (queryTier) return { tier: queryTier, source: 'forced' };
  if (choice !== 'auto') return { tier: choice, source: 'chosen' };
  if (verdict) return { tier: verdict, source: measuredThisSession ? 'measured' : 'remembered' };
  return { tier: 'high', source: 'default' };
}

let current = resolve();

/* The tier the renderer was actually constructed against. It cannot be
   changed for the life of the page where antialias is concerned, so the
   entry screen compares against this to tell the user honestly when a
   choice only completes on the next load. */
const LOAD_TIER = current.tier;

export function currentTier() {
  return current.tier;
}

export function tierSource() {
  return current.source;
}

export function loadTimeTier() {
  return LOAD_TIER;
}

export function userChoice() {
  return choice;
}

export function tierSettings(tier = current.tier) {
  return TIER_SETTINGS[tier] || TIER_SETTINGS.high;
}

// The next tier down, or null at the bottom. The runtime measurement
// steps one place at a time and never the other way.
export function nextTierDown(tier = current.tier) {
  const i = TIERS.indexOf(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

// Whether the rolling frame-time average may move the tier. False for a
// tier the user named (selector or ?quality=) and for reduced-motion.
export function autoTierAllowed() {
  return current.source !== 'chosen' && current.source !== 'forced' && current.source !== 'reduced-motion';
}

/* A string for the perf HUD, replacing scene.js's old currentTierName().
   The bare tier name means "high, because nothing said otherwise";
   anything else is suffixed with how it got there. "(forced)" keeps its
   pre-Phase-4 meaning of a ?quality= override specifically. */
export function tierLabel() {
  return current.source === 'default' ? current.tier : `${current.tier} (${current.source})`;
}

/* Subscribers are notified only when the effective tier actually changes,
   so a listener can be a plain "rebuild what this tier affects" and never
   has to guard against being called with what it already has. scene.js
   registers applyQualityTier here rather than being imported by this
   module — quality.js has to stay free of scene imports, since scene.js
   imports it and a cycle would put the renderer's construction ahead of
   the tier resolution, which is the one thing this module exists to
   prevent. */
const listeners = new Set();

export function onTierChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function refresh() {
  const before = current.tier;
  current = resolve();
  if (current.tier !== before) listeners.forEach((fn) => fn(current.tier));
}

/* The user-facing setter — the entry screen's selector. 'auto' means
   "clear my override", falling back to the persisted verdict and the
   rolling measurement; it deliberately does *not* wipe the verdict,
   since that is a measurement of this machine and is still true.
   The choice is persisted either way, so the next load can act on it
   early enough for antialias. */
export function setTier(next) {
  if (next !== 'auto' && !TIERS.includes(next)) return current.tier;
  choice = next;
  writeStored();
  refresh();
  return current.tier;
}

/* The measurement's setter, called by scene.js's rolling average when it
   gives up on the current tier. Persisted so a weak machine pays the
   learning cost once, ever, rather than once per session. */
export function recordMeasuredTier(next) {
  if (!TIERS.includes(next)) return current.tier;
  verdict = next;
  measuredThisSession = true;
  writeStored();
  refresh();
  return current.tier;
}
