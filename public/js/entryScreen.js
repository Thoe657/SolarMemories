/* ============================================================
   ENTRY SCREEN — nebula start screen shown once on first load
   -----------------------------------------------------------
   Lightweight standalone 2D canvas (not Three.js), reusing the
   layered radial-gradient "nebula glow" technique from scene.js,
   with a slow drift of a few cloud blobs. Purely a visual/
   interaction gate layered on top of the planet picker, which
   keeps initializing underneath exactly as it always has.
============================================================ */
import {
  TIER_SETTINGS,
  currentTier,
  loadTimeTier,
  setTier,
  tierSource,
  userChoice
} from './quality.js';
import {
  chosenTheme,
  currentTheme,
  setTheme,
  themeConfig,
  themeSource
} from './theme.js';

const entryScreen = document.getElementById('entryScreen');
const canvas = document.getElementById('entryScreenCanvas');
const ctx = canvas.getContext('2d');
const enterBtn = document.getElementById('entryEnterBtn');

/* Backing store is a quarter of the viewport in each axis and CSS stretches it
   back up (#entryScreenCanvas is inset:0 / 100%×100%, so the upscale is free).
   Everything drawn here is a soft radial gradient with no edge to lose, so
   sixteen times fewer pixel writes costs nothing visually — and this canvas
   used to fill the whole viewport with black plus three full-viewport
   gradients on every single frame, roughly 8M pixel writes at 1080p, as the
   app's first impression on the slowest machine it will ever run on. */
const RESOLUTION_SCALE = 0.25;

/* ~10 redraws a second. The blobs drift on a ~5-minute cycle (speeds of
   0.015–0.02 rad/s), so consecutive frames at display rate are visually
   identical — the motion being animated is far slower than the rate it was
   being animated at. Combined with the scale above this is ~100× less pixel
   work per second. */
const DRAW_INTERVAL_MS = 100;

let width = 0, height = 0;
// -Infinity, not 0: the first call comes in with now=0, and a real timestamp
// minus 0 must not be mistaken for "already drawn recently".
let lastDrawAt = -Infinity;

function resize() {
  width = canvas.width = Math.max(1, Math.round(window.innerWidth * RESOLUTION_SCALE));
  height = canvas.height = Math.max(1, Math.round(window.innerHeight * RESOLUTION_SCALE));
  lastDrawAt = -Infinity; // resizing a canvas clears it — redraw on the next frame, not in 100ms
}
resize();
window.addEventListener('resize', resize);

/* Nebula cloud blobs, reusing the layered radial-gradient technique from
   scene.js's paintGlow. Plan 4 Phase 4 gives each theme its own set — more
   of them, and coloured rather than three near-neutral violets.

   THE RICHNESS IS IN THE ARRANGEMENT, NOT IN THE MOTION, and that is a hard
   constraint rather than a preference: Plan 3 Phase 2 took this canvas to
   quarter resolution at ~10fps precisely because it was the app's first
   impression on the slowest machine it will ever run on. Neither
   RESOLUTION_SCALE nor DRAW_INTERVAL_MS moves here.

   So the three original blobs are kept exactly as they were, drift and all,
   and everything added is a SMALL ACCENT AT speed: 0 — a fixed composition
   element, not a fourth thing to animate. The added radii are 0.16–0.28
   against the originals' 0.5–0.6, so the extra fill area is a fraction of
   one canvas rather than a multiple of it; at 316×176 (a 1280-wide window)
   the four solar accents come to roughly one canvas's worth of pixels per
   frame, ten times a second.

   Solar gains warmth (amber, rose, a pale core) where universe goes cool and
   banded (deep blue, teal, violet, a bright cyan core) — the palette
   temperature lever from the plan's stranger test. Alphas stay at or below
   the originals' 0.5 over black, which is what keeps this screen under the
   plan-wide "the sky never out-shouts the cards" ceiling. */
const BLOB_THEMES = {
  solar: [
    { baseX: 0.3, baseY: 0.35, r: 0.55, color: 'rgba(80,60,120,ALPHA)', alpha: 0.5, speed: 0.02, phase: 0 },
    { baseX: 0.72, baseY: 0.4, r: 0.5, color: 'rgba(110,70,90,ALPHA)', alpha: 0.4, speed: 0.015, phase: 2 },
    { baseX: 0.5, baseY: 0.7, r: 0.6, color: 'rgba(60,50,100,ALPHA)', alpha: 0.45, speed: 0.018, phase: 4 },
    { baseX: 0.18, baseY: 0.72, r: 0.26, color: 'rgba(190,120,80,ALPHA)', alpha: 0.22, speed: 0, phase: 1 },
    { baseX: 0.62, baseY: 0.18, r: 0.22, color: 'rgba(210,140,150,ALPHA)', alpha: 0.2, speed: 0, phase: 3 },
    { baseX: 0.86, baseY: 0.68, r: 0.28, color: 'rgba(120,80,150,ALPHA)', alpha: 0.24, speed: 0, phase: 5 },
    { baseX: 0.42, baseY: 0.46, r: 0.16, color: 'rgba(255,214,170,ALPHA)', alpha: 0.14, speed: 0, phase: 6 },
  ],
  universe: [
    { baseX: 0.34, baseY: 0.32, r: 0.58, color: 'rgba(38,58,120,ALPHA)', alpha: 0.5, speed: 0.02, phase: 0 },
    { baseX: 0.7, baseY: 0.44, r: 0.52, color: 'rgba(30,86,110,ALPHA)', alpha: 0.42, speed: 0.015, phase: 2 },
    { baseX: 0.5, baseY: 0.74, r: 0.6, color: 'rgba(52,44,110,ALPHA)', alpha: 0.46, speed: 0.018, phase: 4 },
    { baseX: 0.2, baseY: 0.66, r: 0.26, color: 'rgba(40,120,140,ALPHA)', alpha: 0.22, speed: 0, phase: 1 },
    { baseX: 0.66, baseY: 0.2, r: 0.24, color: 'rgba(90,70,170,ALPHA)', alpha: 0.22, speed: 0, phase: 3 },
    { baseX: 0.88, baseY: 0.7, r: 0.28, color: 'rgba(24,70,130,ALPHA)', alpha: 0.24, speed: 0, phase: 5 },
    { baseX: 0.46, baseY: 0.5, r: 0.16, color: 'rgba(150,210,255,ALPHA)', alpha: 0.12, speed: 0, phase: 6 },
  ]
};

// Falls back rather than rendering an empty black screen if a registry entry
// ever ships without a blob set — the same posture theme.js's own accessors
// take for a theme it doesn't recognise.
const blobs = BLOB_THEMES[currentTheme()] || BLOB_THEMES.solar;

function paintGlow(x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('ALPHA', alpha));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

let animId = null;
let running = true;

function draw(now = 0) {
  // The rAF chain is kept at display rate and the *work* is what's throttled,
  // so a resize still repaints on the very next frame rather than whenever the
  // accumulator next comes round.
  if (running) animId = requestAnimationFrame(draw);
  if (now - lastDrawAt < DRAW_INTERVAL_MS) return;
  lastDrawAt = now;

  const t = now / 1000;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  const maxDim = Math.max(width, height);
  blobs.forEach((b) => {
    const x = (b.baseX + Math.sin(t * b.speed + b.phase) * 0.04) * width;
    const y = (b.baseY + Math.cos(t * b.speed * 0.8 + b.phase) * 0.04) * height;
    paintGlow(x, y, b.r * maxDim, b.color, b.alpha);
  });
}
draw();

// Deliberately does not wake the Three.js scene: what this reveals is the
// planet picker, which is DOM, and the picker sits between here and any
// planet. scene.js stays asleep until planetPicker.js's selectPlanet resumes
// it mid-whiteout.
function enter() {
  if (!running) return;
  running = false;
  if (animId) cancelAnimationFrame(animId);
  window.removeEventListener('resize', resize);

  entryScreen.classList.add('fading');
  // matches the .overlay fade timing (~500-700ms) elsewhere in the app
  setTimeout(() => {
    entryScreen.classList.add('hidden');
  }, 700);
}

enterBtn.addEventListener('click', enter);

/* ============================================================
   THEME SELECTOR (Plan 4 Phase 1)

   Sits above the quality selector, deliberately: the theme is the choice
   someone actually wants to make, and picture quality is a fallback for
   when the app runs badly.

   Unlike the quality selector, *nothing* here applies on the spot. The
   theme is fixed at load by design (Plan 4 decision 5) — the sky texture,
   the card textures and the portal geometry were all decided against it
   before this screen was interactive. So the chip shows what you have
   chosen, theme.js persists it, and the note says plainly that it lands
   next time. That is the same honesty the quality note owes for antialias,
   just for the whole theme rather than one setting.
============================================================ */
const themeOptions = document.getElementById('entryThemeOptions');
const themeNote = document.getElementById('entryThemeNote');

function themeNoteText() {
  // ?theme= outranks the stored preference (see theme.js's precedence
  // chain), and it wins again on every reload of that same URL — so it is
  // reported whether or not a chip has since been clicked. Silently
  // ignoring a click is worse than explaining it.
  if (themeSource() === 'forced') {
    return `held at ${themeConfig().chipLabel} by ?theme= in the address bar`;
  }
  if (chosenTheme() !== currentTheme()) return 'opens in this theme next time';
  return '';  // the chip already says which theme; nothing to add
}

function renderThemeSelector() {
  const chosen = chosenTheme();
  themeOptions.querySelectorAll('.theme-chip').forEach((chip) => {
    chip.setAttribute('aria-checked', String(chip.dataset.theme === chosen));
  });
  themeNote.textContent = themeNoteText();
}

// Guarded for the same reason the quality selector below is: this module's
// body runs during startup, and a stale cached index.html without the
// markup must not take the app's start down with it.
if (themeOptions && themeNote) {
  themeOptions.addEventListener('click', (e) => {
    const chip = e.target.closest('.theme-chip');
    if (!chip) return;
    setTheme(chip.dataset.theme);
    renderThemeSelector();
  });

  renderThemeSelector();
}

/* ============================================================
   QUALITY TIER SELECTOR (Plan 3 Phase 4)

   Lives here because the entry screen is the app's "before you go in"
   surface — the one place a setting can be changed before any of it is
   on screen, and where Plan 4's theme toggle landed too (above).

   The choice goes to quality.js, which persists it and notifies scene.js;
   everything the tier controls except one thing is applied on the spot.
   That one thing is antialias, which is fixed when the WebGLRenderer is
   constructed at module load and can't be re-decided — so when a choice
   crosses that line the note below says so rather than quietly lying
   about what the user just got.
============================================================ */
const qualityOptions = document.getElementById('entryQualityOptions');
const qualityNote = document.getElementById('entryQualityNote');

// Why the effective tier isn't simply the chosen one. prefers-reduced-motion
// and ?quality= both outrank the selector (see quality.js's precedence
// chain), and silently ignoring a click is worse than explaining it.
function noteText() {
  const tier = currentTier();
  const source = tierSource();

  if (source === 'reduced-motion') return 'held at low — your system asks for reduced motion';
  if (source === 'forced') return `held at ${tier} by ?quality= in the address bar`;
  if (source === 'chosen') {
    return TIER_SETTINGS[tier].antialias === TIER_SETTINGS[loadTimeTier()].antialias
      ? ''  // the chip already says which tier; nothing to add
      : 'edge smoothing changes next time you open this';
  }
  if (source === 'remembered' || source === 'measured') return `auto — ${tier} on this computer`;
  return 'auto — high unless this computer struggles';
}

function renderQualitySelector() {
  const choice = userChoice();
  qualityOptions.querySelectorAll('.quality-chip').forEach((chip) => {
    chip.setAttribute('aria-checked', String(chip.dataset.quality === choice));
  });
  qualityNote.textContent = noteText();
}

// Guarded because this module's body runs during startup: a stale cached
// index.html without the selector markup would otherwise throw here and take
// the entry screen — and with it the whole app's start — down with it. The
// tier still resolves and applies without any of this; the selector is the
// only part that goes missing.
if (qualityOptions && qualityNote) {
  qualityOptions.addEventListener('click', (e) => {
    const chip = e.target.closest('.quality-chip');
    if (!chip) return;
    // 'auto' is a real value here, not a tier: it clears the override and hands
    // the decision back to the remembered verdict and the rolling measurement.
    setTier(chip.dataset.quality);
    renderQualitySelector();
  });

  renderQualitySelector();
}
