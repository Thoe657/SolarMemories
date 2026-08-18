/* ============================================================
   PLANET PICKER — solar system rendering, orbit math, new-planet
   form, hyperspace transition, edit-planet panel
============================================================ */
import { createPlanetRemote, deletePlanetRemote, loadTrashedMemories, restoreMemory, deleteMemoryForever } from './api.js';
import { showStorageWarning } from './util.js';
import { clearGalleryScene, loadPlanetMemories, showLoadingPlaceholders, setOnPortalClick, showMoon, pauseScene, resumeScene } from './scene.js';
import { currentPlanet, planetsCache, setCurrentPlanet, setPlanetsCache } from './state.js';
import { prefersReducedMotion } from './motionPreference.js';
import { currentTier, tierSettings, onTierChange } from './quality.js';
/* Imported as `themeLabel` rather than `label`, here and in scene.js: both
   files already use `label` for DOM/texture-caption locals, and a themed
   string silently shadowed by a <span> would be a very quiet bug. */
import { label as themeLabel, themeFlag, currentTheme, DEFAULT_THEME } from './theme.js';
/* One-directional: entryScreen.js imports quality.js and theme.js and nothing
   else, so there is no cycle to work around here — unlike scene.js, which this
   file reaches through setOnPortalClick callbacks for exactly that reason. */
import { showEntryScreen } from './entryScreen.js';

/* ============================================================
   PLANET PICKER — twinkling background stars

   THE COLOUR/DEPTH PASS (Plan 4 Phase 4) IS TIER-GATED, and it is the one
   piece of runtime work the whole of Plan 4 adds. Two levels, using
   quality.js's existing tier vocabulary rather than a second gating scheme
   of this file's own:

     high → 'full'   themed colour per star, a glow on the two nearest
                     layers, and one extra far layer for depth
     low  → 'off'    exactly what this did before the phase: no inline
                     colour, no glow, no extra layer, so the low tier's
                     DOM and paint cost are unchanged by construction
                     rather than by measurement

   prefers-reduced-motion forces the low tier (quality.js's precedence
   chain), so it lands on 'off' without this file testing for it.
============================================================ */

/* Colours as [r, g, b] triples rather than strings, because each one is
   composed twice — once at the layer's own alpha for the dot, once fainter
   for its glow — and two hand-written rgba() strings that must stay in step
   is exactly the kind of duplication that drifts.

   Back → front. Solar's dominant tone is styles.css's own
   rgba(255,245,225,.8), so 'off' and 'full' differ in richness rather
   than in hue; universe swaps the whole range cool. */
const STARFIELD_PALETTES = {
  solar: [
    [[255, 245, 225], [255, 232, 196], [255, 214, 190]],
    [[255, 245, 225], [255, 226, 180], [255, 205, 175]],
    [[255, 250, 240], [255, 232, 190], [242, 180, 186]]
  ],
  universe: [
    [[198, 214, 255], [168, 196, 255], [180, 230, 240]],
    [[214, 230, 255], [160, 190, 255], [186, 168, 255]],
    [[235, 244, 255], [150, 205, 255], [190, 170, 255]]
  ]
};

/* The depth half of the pass: the CSS gives every star a flat 0.8 alpha, so
   the layers only read as depth once the far ones are actually fainter.
   Index matches the layer list below; FAR_ALPHA is the extra 'full' layer. */
const STARFIELD_LAYER_ALPHA = [0.55, 0.8, 0.95];
const STARFIELD_FAR_ALPHA = 0.4;
// Glow radius in px, back → front. 0 means no glow on that layer.
const STARFIELD_GLOW_PX = [0, 3, 5];

function starfieldPalette() {
  return STARFIELD_PALETTES[currentTheme()] || STARFIELD_PALETTES[DEFAULT_THEME];
}

// 'full' | 'off'
function starfieldLevel(tier = currentTier()) {
  return tier === 'low' ? 'off' : 'full';
}

(function setupPickerStars() {
  const starsContainer = document.getElementById('startStars');

  // Depth layers: more/smaller/slower-drifting stars toward the back, fewer/
  // larger/more-parallaxed ones up front.
  const layers = [
    { count: 60, size: [1, 1.8], duration: [2.5, 5], parallax: 6 },
    { count: 40, size: [1.5, 2.5], duration: [2.2, 4.2], parallax: 14 },
    { count: 20, size: [2, 3.5], duration: [2, 3.5], parallax: 26 },
  ];

  // The extra depth layer 'full' adds: further out than layer 0, so smaller,
  // dimmer, slower and barely parallaxed. Built lazily and destroyed again on
  // a downgrade — see applyStarfieldTier — so a machine that never reaches
  // high never pays for these 80 elements at all.
  const FAR_LAYER = { count: 80, size: [1, 1.4], duration: [3.5, 6], parallax: 2 };

  function makeStar(layer) {
    const star = document.createElement('span');
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    const size = layer.size[0] + Math.random() * (layer.size[1] - layer.size[0]);
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.animationDelay = `${Math.random() * 3}s`;
    star.style.animationDuration = `${layer.duration[0] + Math.random() * (layer.duration[1] - layer.duration[0])}s`;
    return star;
  }

  const layerEls = layers.map((layer, depth) => {
    const layerEl = document.createElement('div');
    layerEl.className = 'star-layer';
    for (let i = 0; i < layer.count; i++) layerEl.appendChild(makeStar(layer));
    starsContainer.appendChild(layerEl);
    return { el: layerEl, parallax: layer.parallax, depth };
  });

  /* Colour is written as an inline style so it overrides styles.css's flat
     rgba(255,245,225,.8) — and cleared back to '' at 'off', which hands the
     stylesheet's own value back rather than this file guessing at it. That is
     what makes the low tier byte-identical to the pre-phase behaviour instead
     of merely similar. */
  function paintLayer(entry, level) {
    const alpha = entry.far ? STARFIELD_FAR_ALPHA : STARFIELD_LAYER_ALPHA[entry.depth];
    const tones = entry.far ? starfieldPalette()[0] : starfieldPalette()[entry.depth];
    const glowPx = level === 'full' && !entry.far ? STARFIELD_GLOW_PX[entry.depth] : 0;

    Array.from(entry.el.children).forEach((star) => {
      if (level === 'off') {
        star.style.background = '';
        star.style.boxShadow = '';
        return;
      }
      const [r, g, b] = tones[Math.floor(Math.random() * tones.length)];
      star.style.background = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      // Recomputed rather than remembered: a downgrade only ever removes the
      // glow, and re-rolling the tone on a re-paint costs nothing visible on
      // a field of twinkling dots.
      star.style.boxShadow = glowPx ? `0 0 ${glowPx}px rgba(${r}, ${g}, ${b}, 0.55)` : '';
    });
  }

  let farEntry = null;

  function setFarLayer(on) {
    if (on === !!farEntry) return;
    if (!on) {
      const i = layerEls.indexOf(farEntry);
      if (i >= 0) layerEls.splice(i, 1);
      farEntry.el.remove();
      farEntry = null;
      return;
    }
    const layerEl = document.createElement('div');
    layerEl.className = 'star-layer';
    for (let i = 0; i < FAR_LAYER.count; i++) layerEl.appendChild(makeStar(FAR_LAYER));
    // Behind the other layers: siblings with no z-index paint in tree order,
    // and the furthest field belongs underneath the ones in front of it.
    starsContainer.insertBefore(layerEl, starsContainer.firstChild);
    farEntry = { el: layerEl, parallax: FAR_LAYER.parallax, depth: 0, far: true };
    layerEls.push(farEntry);
  }

  /* Re-resolves the level and rebuilds what it owns. Registered with
     quality.js so a mid-session tier move — the rolling frame-time average
     stepping down, or the entry screen's selector moving in either
     direction — is honoured here too. Without this, a machine that started
     high and was measured down to low would keep paying for 80 extra
     elements and 120 glows on the one screen the scene is paused behind. */
  function applyStarfieldTier() {
    const level = starfieldLevel();
    setFarLayer(level === 'full');
    layerEls.forEach((entry) => paintLayer(entry, level));
  }

  applyStarfieldTier();
  onTierChange(applyStarfieldTier);

  /* Subtle parallax tied to pointer position -- each layer drifts opposite
     the pointer by its own amount, and the CSS transition on .star-layer
     smooths/lags the movement instead of tracking it 1:1.

     The handler only records where the pointer is; the transforms are written
     once per frame from a rAF. pointermove fires far above frame rate on a
     high-polling mouse, and this writes three transforms per event -- each one
     invalidating the layers' composited position for a frame that hadn't been
     drawn yet, so all but the last were discarded. Reading clientX/clientY and
     writing style in the same handler is also a layout-thrash pattern; the rAF
     puts the writes in one place. Nothing here uses scene.js's frame registry
     on purpose: this is the picker, and since Phase 2 the scene's loop is
     paused whenever the picker is the screen you're looking at. */
  let parallaxX = 0;
  let parallaxY = 0;
  let parallaxQueued = false;

  function writeParallax() {
    parallaxQueued = false;
    layerEls.forEach(({ el, parallax }) => {
      el.style.transform = `translate(${-parallaxX * parallax}px, ${-parallaxY * parallax}px)`;
    });
  }

  window.addEventListener('pointermove', (e) => {
    parallaxX = e.clientX / window.innerWidth - 0.5;
    parallaxY = e.clientY / window.innerHeight - 0.5;
    if (parallaxQueued) return;
    parallaxQueued = true;
    requestAnimationFrame(writeParallax);
  });

  // Occasional shooting stars, every 8-15s (randomized so there's no
  // noticeable fixed rhythm), each removing itself once its animation ends.
  function spawnShootingStar() {
    const el = document.createElement('div');
    el.className = 'shooting-star';
    const startX = Math.random() * 70;
    const startY = Math.random() * 40;
    const angle = 25 + Math.random() * 20;
    const distance = 220 + Math.random() * 160;
    const duration = 900 + Math.random() * 500;
    el.style.left = `${startX}%`;
    el.style.top = `${startY}%`;
    el.style.setProperty('--angle', `${angle}deg`);
    el.style.setProperty('--distance', `${distance}px`);
    el.style.animationDuration = `${duration}ms`;
    starsContainer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function scheduleShootingStar() {
    const delay = 8000 + Math.random() * 7000;
    setTimeout(() => {
      spawnShootingStar();
      scheduleShootingStar();
    }, delay);
  }
  scheduleShootingStar();
})();

/* ============================================================
   HYPERSPACE TRANSITION
   -----------------------------------------------------------
   A full-screen canvas overlay drawing streaking starlines that
   radiate outward from the center, accelerating, then fading —
   used when entering or leaving a planet.
============================================================ */
const hyperspaceCanvas = document.getElementById('hyperspaceCanvas');
const hyCtx = hyperspaceCanvas.getContext('2d');

/* Backing store scale. The low tier draws this canvas at 70% in each axis and
   CSS stretches it back — half the pixels for streaks that are motion-blurred
   smears by design, on the machine least able to afford them. Moon travel is
   the app's showiest moment and it should not be its jerkiest. High draws
   1:1, so nothing changes there. */
function hyperspaceScale() {
  return currentTier() === 'low' ? 0.7 : 1;
}

function resizeHyperspaceCanvas() {
  const s = hyperspaceScale();
  hyperspaceCanvas.width = Math.max(1, Math.round(window.innerWidth * s));
  hyperspaceCanvas.height = Math.max(1, Math.round(window.innerHeight * s));
}
resizeHyperspaceCanvas();
window.addEventListener('resize', resizeHyperspaceCanvas);
// A tier change alters the backing-store scale, so the canvas has to be resized
// for it -- otherwise a downgrade mid-session keeps drawing at full resolution.
onTierChange(resizeHyperspaceCanvas);

/* Two intensities of the same effect. `planet` is the original, unchanged:
   crossing between planets. `moon` is the escalation used for hopping
   between moons *within* one planet — longer, denser, and drawn in a
   five-colour range instead of a single white, so the two trips don't feel
   interchangeable.

   COLOUR LIVES IN HYPERSPACE_PALETTES BELOW, NOT HERE (Plan 4 Phase 8).
   What's left in a preset is the effect's *shape* — how long, how dense, how
   fast, how hard it flashes — which is identical in both themes, because
   this phase is a retint and nothing else. */
const HYPERSPACE_PRESETS = {
  planet: {
    duration: 1100,
    starCount: 220,
    speedScale: 1,
    trailScale: 1,
    flashMax: 0.5
  },
  moon: {
    duration: 1750,
    starCount: 420,
    speedScale: 1.35,
    trailScale: 1.5,
    flashMax: 0.7
  }
};

/* THE COLOUR COUNT PER PRESET IS LOAD-BEARING AND MUST NOT CHANGE.
   Streak stars are batched into `${color}|${width}` buckets (see the note in
   playHyperspace), so a frame costs one stroke call per bucket. Widths run
   1–4px quantised to 0.5, i.e. 7 steps; the bucket ceiling is therefore
   colours x 7 — 1 x 7 = 7 for the planet trip and 5 x 7 = 35 for the moon
   trip, in BOTH themes. Adding a sixth colour to the moon list would push
   that to 42 and spend ~20% more stroke calls a frame at the app's most
   performance-sensitive moment, which is exactly what Plan 3 Phase 8 bought
   down and what this phase's "frame time unchanged" criterion protects. Retint
   by replacing entries, never by appending them.

   Solar's values are the literals that were sitting in the presets before
   this phase, so the default theme's hyperspace is byte-identical. Universe
   swaps the warm/rose/violet range for the cool blues the rest of the skin
   uses — the same move, and the same reasoning, as starfieldPalette() above. */
const HYPERSPACE_PALETTES = {
  solar: {
    planet: { colors: ['255, 245, 225'], flashColor: '255, 250, 240' },
    moon: {
      colors: ['255, 245, 225', '255, 217, 160', '242, 166, 176', '184, 166, 242', '166, 232, 242'],
      flashColor: '246, 236, 255'
    }
  },
  universe: {
    planet: { colors: ['214, 230, 255'], flashColor: '235, 244, 255' },
    moon: {
      colors: ['235, 244, 255', '198, 214, 255', '150, 205, 255', '168, 196, 255', '190, 170, 255'],
      flashColor: '226, 238, 255'
    }
  }
};

/* Selected by the feature flag rather than by the theme name alone, so a
   theme that hasn't opted in falls back to solar's palette even if someone
   later adds a block for it above. `kind` is 'planet' | 'moon'. */
function hyperspacePalette(kind) {
  const family = themeFlag('hyperspaceRetint') ? currentTheme() : DEFAULT_THEME;
  const set = HYPERSPACE_PALETTES[family] || HYPERSPACE_PALETTES[DEFAULT_THEME];
  return set[kind] || set.planet;
}

// Plays the hyperspace effect at the named intensity. Calls onMid halfway
// through (the moment of maximum streak/whiteout — good time to swap scene
// content underneath), and resolves once the effect has fully faded out.
function playHyperspace(onMid, kind = 'planet') {
  return new Promise((resolve) => {
    // A stated motion preference outranks the drama: fall back to the shorter,
    // sparser trip rather than escalating. Resolving the *key* first (rather
    // than the preset, then recovering the key by identity) is what lets the
    // palette be looked up by the same name.
    const kindKey = (!prefersReducedMotion() && HYPERSPACE_PRESETS[kind]) ? kind : 'planet';
    const preset = HYPERSPACE_PRESETS[kindKey];
    const palette = hyperspacePalette(kindKey);
    const DURATION = preset.duration;
    // Star count comes from the tier, not the preset: 420/220 at high,
    // 140/100 at low (quality.js's TIER_SETTINGS). The preset's own
    // starCount is the high-tier figure and stays as the reference for
    // what the effect was designed to look like.
    const STAR_COUNT = tierSettings().hyperspaceStars[kindKey];
    const cx = hyperspaceCanvas.width / 2;
    const cy = hyperspaceCanvas.height / 2;
    const maxR = Math.hypot(cx, cy);

    /* Stars are bucketed by (colour, width) so a frame is one path per bucket
       instead of one beginPath/stroke per star — 420 stroke calls a frame for
       the moon trip, at full window resolution, was the plan's finding 11.

       lineWidth is a per-stroke property, not a per-path one, so batching by
       colour alone would have flattened every streak to one thickness and
       changed the look. Instead each star's random width is *rounded to a
       0.5px step when it is created*, so the width it draws at is exactly its
       bucket's — nothing is approximated at draw time. Widths run 1–4px, which
       is 7 steps; times the moon palette's 5 colours that is at most 35
       buckets a frame rather than 420, and the planet palette's single colour
       collapses to 7. At these sizes, on streaks that are motion blur by
       design, a 0.5px quantisation of the *distribution* is not visible.

       Both counts are per-theme invariants, not per-theme numbers — see the
       warning over HYPERSPACE_PALETTES. */
    const WIDTH_STEP = 0.5;
    const buckets = new Map();
    for (let i = 0; i < STAR_COUNT; i++) {
      const rawWidth = Math.random() < 0.85 ? 1 + Math.random() * 1.5 : 2 + Math.random() * 2;
      const width = Math.round(rawWidth / WIDTH_STEP) * WIDTH_STEP;
      const color = palette.colors[Math.floor(Math.random() * palette.colors.length)];
      const key = `${color}|${width}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { color, width, stars: [] };
        buckets.set(key, bucket);
      }
      bucket.stars.push({
        angle: Math.random() * Math.PI * 2,
        start: Math.random() * 0.5, // normalized starting distance from center
        speed: (0.6 + Math.random() * 1.2) * preset.speedScale
      });
    }
    const bucketList = [...buckets.values()];

    hyperspaceCanvas.classList.add('active');
    let midFired = false;
    const startTime = performance.now();

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / DURATION, 1);

      // overall intensity: ramps up to a whiteout peak, then fades
      const intensity = t < 0.5
        ? t / 0.5            // 0 -> 1
        : 1 - (t - 0.5) / 0.5; // 1 -> 0

      hyCtx.fillStyle = `rgba(0, 0, 0, ${0.35 + 0.25 * (1 - intensity)})`;
      hyCtx.fillRect(0, 0, hyperspaceCanvas.width, hyperspaceCanvas.height);

      const travel = t; // 0 -> 1 progress for streak length/position
      // Alpha depends only on intensity, which is per-frame, so every star in a
      // bucket shares a strokeStyle as well as a lineWidth — one path each.
      const alpha = 0.25 + 0.65 * intensity;
      const widthScale = 0.5 + intensity;
      bucketList.forEach((bucket) => {
        hyCtx.strokeStyle = `rgba(${bucket.color}, ${alpha})`;
        hyCtx.lineWidth = bucket.width * widthScale;
        hyCtx.beginPath();
        bucket.stars.forEach((s) => {
          const dist = (s.start + travel * s.speed) * maxR;
          const prevDist = Math.max(0, dist - (8 + travel * 60) * s.speed * preset.trailScale);
          const cos = Math.cos(s.angle);
          const sin = Math.sin(s.angle);
          hyCtx.moveTo(cx + cos * prevDist, cy + sin * prevDist);
          hyCtx.lineTo(cx + cos * dist, cy + sin * dist);
        });
        hyCtx.stroke();
      });

      // whiteout flash at the peak
      if (intensity > 0.7) {
        const flash = (intensity - 0.7) / 0.3;
        hyCtx.fillStyle = `rgba(${palette.flashColor}, ${flash * preset.flashMax})`;
        hyCtx.fillRect(0, 0, hyperspaceCanvas.width, hyperspaceCanvas.height);
      }

      if (!midFired && t >= 0.5) {
        midFired = true;
        if (onMid) onMid();
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        hyCtx.clearRect(0, 0, hyperspaceCanvas.width, hyperspaceCanvas.height);
        hyperspaceCanvas.classList.remove('active');
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

/* ============================================================
   PLANET PICKER UI — solar system
============================================================ */
const planetPicker = document.getElementById('planetPicker');
const solarSystem = document.getElementById('solarSystem');
const orbitsContainer = document.getElementById('orbits');
const newPlanetForm = document.getElementById('newPlanetForm');
const newPlanetName = document.getElementById('newPlanetName');
const colorRow = document.getElementById('colorRow');
const cancelPlanetBtn = document.getElementById('cancelPlanetBtn');
const createPlanetBtn = document.getElementById('createPlanetBtn');
const planetTitleEl = document.getElementById('planetTitle');
const backToPlanetsBtn = document.getElementById('backToPlanetsBtn');
const topbar = document.getElementById('topbar');
const exitToMenuBtn = document.getElementById('exitToMenuBtn');

/* Back to the menu (Plan 5 Phase 1). This does not pause or resume anything:
   the WebGL scene is already asleep whenever the picker is on screen —
   showPlanetPicker() pauses it on the way out of a planet, and it starts
   paused — so covering the picker with the entry screen changes nothing the
   two pause booleans track. Guarded like the selectors in entryScreen.js: a
   stale cached index.html without the button must not throw here and take the
   picker down with it. */
if (exitToMenuBtn) {
  exitToMenuBtn.addEventListener('click', () => showEntryScreen());
}

const ringRow = document.getElementById('ringRow');

let selectedColor = '#ffd9a0';
let selectedRing = 1;

colorRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  [...colorRow.children].forEach(d => d.classList.toggle('active', d === dot));
  selectedColor = dot.dataset.color;
});

ringRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.ring-dot');
  if (!dot) return;
  [...ringRow.children].forEach(d => d.classList.toggle('active', d === dot));
  selectedRing = parseInt(dot.dataset.ring, 10);
});

function openNewPlanetForm() {
  newPlanetForm.classList.remove('hidden');
  newPlanetName.focus();
}

cancelPlanetBtn.addEventListener('click', () => {
  newPlanetForm.classList.add('hidden');
  newPlanetName.value = '';
  createPlanetBtn.disabled = true;
});

newPlanetName.addEventListener('input', () => {
  createPlanetBtn.disabled = newPlanetName.value.trim().length === 0;
});

createPlanetBtn.addEventListener('click', async () => {
  const name = newPlanetName.value.trim();
  if (!name) return;
  const planet = {
    id: `gal-${Date.now()}`,
    name,
    accentColor: selectedColor,
    ring: selectedRing
  };
  createPlanetBtn.disabled = true;
  try {
    await createPlanetRemote(planet);
    planetsCache.push(planet);
    renderSolarSystem();
    newPlanetForm.classList.add('hidden');
    newPlanetName.value = '';
    createPlanetBtn.disabled = true;
  } catch (e) {
    console.warn('Could not create planet', e);
    showStorageWarning(`couldn't create that ${themeLabel('planet')} — check the gallery server and try again.`);
    createPlanetBtn.disabled = false;
  }
});

// Four fixed orbital radii (px), always drawn, centered on the sun.
// Ring index 0 is reserved for the "+ new planet" icon. Planets
// choose from rings 1-3 (displayed as options "1", "2", "3" — the ring
// just outside the new-planet ring, and so on outward).
const RING_RADII = [90, 165, 240, 320];
const PLANET_SIZES = [38, 32, 36, 30, 40, 34, 32, 38]; // px, cycling per planet
const NEW_PLANET_RING = 0;

/* The universe add control stays fixed straight down from the core, now inside
   its lower half so it sits clearly below Maddi's name without joining the
   rotating galaxy icons. */
const NEW_PLANET_SPIRAL_RADIUS = 42;
const NEW_PLANET_SPIRAL_THETA = 90; // straight down; .orbit-spin rotates clockwise from +X

// Caps how many moon-satellite dots get drawn per planet (Phase 12) — a
// planet with many moons still only shows a handful, so a very full one
// reads as "lots" rather than smearing into a solid ring.
const MAX_MOON_SATELLITES = 6;

/* ============================================================
   THE SPIRAL (Plan 4 Phase 6, decision 7)

   `universe` keeps the polar layout and adds one term:

     θ = (idx / count) * 360 + ring * 23 + ARM_WINDING * radius

   The evenly-spread term and the per-ring offset are untouched, so a whole
   ring rotates together and no new collisions can appear. Everything below
   is gated on themeFlag('spiralPicker') — false in solar, where every line
   of this section is dead.

   ARM_WINDING IS THE ONE CONSTANT, read by the placement above *and* by
   armPath() below. That is the plan's load-bearing rule: bake the arms into
   an image and the planets drift off them. (This install's placement turns
   out to be viewport-invariant fixed pixels, so drift was never the live
   risk here — but the shared constant is still the construction that makes
   drift impossible rather than merely unobserved.)

   WHY THE ARMS ARE BROAD. Put a planet at base angle β on ring radius r and
   an arm centre at base angle α, and both pick up the same ARM_WINDING * r:
   the winding term cancels exactly and the planet's angular distance from
   the arm is |β − α|, at every radius. So "is every planet on an arm" is a
   question about the *base* angles alone — and those are (idx/count)*360 +
   ring*23, with a different count and a different offset per ring. Ring 3
   with four planets alone puts base angles 90° apart, which mod a two-arm
   180° period forces an occupied span of 90°. A thin arm therefore *cannot*
   contain every planet, and the plan explicitly forbids retuning the spread
   to make one fit. Real arms are tens of degrees wide, so the arms are drawn
   broad instead, and armGeometry() derives the phase from the angles that
   actually got rendered rather than guessing one.
============================================================ */

// Degrees of sweep per pixel of radius. ~0.35 gives ~80° across RING_RADII
// (90 → 320), which reads as an arm. Real spirals are logarithmic; over
// three rings linear is indistinguishable.
const ARM_WINDING = 0.35;
const GALAXY_SPIN_SECONDS = 480;
orbitsContainer.style.setProperty('--gal-spin', `${GALAXY_SPIN_SECONDS}s`);
// Four arms, not two (Plan 6). Two arms left big black inter-arm voids; four
// broad bands cover ~84% of the circle and the voids shrink to thin dust lanes.
// Counter-intuitively this also makes planet-fitting EASIER: the period is now
// 90° (was 180°), so the canonical worst case — ring 3's four planets 90° apart
// — folds to a SINGLE angle mod 90 instead of two 90° apart. Against the real
// planet set (rings 1/2/3 fold to 23/46/69°, worst planet needs halfWidth ≥29°)
// the 38° base below clears it with margin.
const ARM_COUNT = 4;
// Nominal half-width of the drawn band. Widened only if the rendered planets
// need it, and never past ARM_HALF_WIDTH_MAX_DEG — past period/2 (45° for four
// arms) the bands merge into a disc and "on an arm" stops meaning anything, so
// the right answer is to report it, not to keep widening.
const ARM_HALF_WIDTH_DEG = 38;
const ARM_FIT_MARGIN_DEG = 6;
const ARM_HALF_WIDTH_MAX_DEG = 44;
// Fixed-pixel, exactly like RING_RADII: nothing in the orbit chain scales
// with the viewport, so the arm layer must not either.
const ARM_INNER_R = 26;
const ARM_OUTER_R = 396;
const ARM_BOX = 800;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---- Plan 5 Phase 7: structure inside the band ----
   CLAUDE.md's constraint stands: the arms cannot narrow (ring 3 forces a
   ~90° occupied span). This phase reaches the reference photo not by
   narrowing the band but by putting a lit centre, star knots and dust into
   it. Colours are local constants, same pattern as STARFIELD_PALETTES
   above — this is a decorative picker-only layer, not a themed content
   surface, so it does not belong in theme.js's tokens/cardPalette. */
const SPIRAL_ARM_GRADIENT_ID = 'spiralArmGrad';
// Stops as [offsetFraction, r, g, b, alpha]. Peaks at 50% of ARM_OUTER_R —
// close to the ring's own midpoint (ARM_INNER_R..ARM_OUTER_R center is
// ~53%) — at roughly double the old flat 0.16, per decision 14.
const SPIRAL_ARM_GRADIENT_STOPS = [
  [0.00, 170, 195, 255, 0.05],
  [0.06, 175, 200, 255, 0.10],
  [0.50, 200, 222, 255, 0.38],
  [0.80, 180, 202, 255, 0.16],
  [1.00, 150, 175, 255, 0.02],
];
const SPINE_WIDTH_FRACTION = 0.45; // of the arm's own halfWidth
const SPINE_FILL = 'rgba(210, 228, 255, 0.5)';
const KNOT_BLUE = '#e8f0ff';
const KNOT_PINK = '#ff9ec4';
const KNOT_PINK_SHARE = 0.22;
// A constant, not a function of planet count — the same galaxy is the same
// galaxy every time you come back to it (armGeometry's phase/halfWidth do
// still track the current planet set, same as the arms themselves).
const STAR_KNOT_COUNT = 56;
const STAR_KNOT_SEED = 20260814;

/* ---- Plan 6: cloudy internal texture + nebula colour ----
   The arms were a flat blue-grey gradient (the "previous attempt" the brief
   calls out). This adds (a) an feTurbulence cloud filter that knocks patchy
   holes in a copy of each arm so the band is grainy, not smooth; and (b) large
   soft-blurred HII/cluster blobs in warm + cool colours. Same rationale as the
   KNOT_* constants above: a decorative picker-only layer, so the colours are
   local constants — not theme.js tokens, and not bound by the #707688
   content-surface contrast window. */
const CLOUD_FILTER_ID = 'spiralClouds';
// id → 'r,g,b', referenced from the nebula layer as url(#<id>).
const NEBULA_COLORS = {
  nebPink: '255,95,165', nebMag: '245,70,215', nebViolet: '170,90,255',
  nebBlue: '110,165,255', nebTeal: '90,225,240',
};
const NEBULA_WARM = ['nebPink', 'nebMag', 'nebViolet'];
const NEBULA_COOL = ['nebBlue', 'nebTeal'];
const NEBULA_PER_ARM = 14;
const NEBULA_SEED = 777;
// Dust threads: [halfWidthFraction, centreOffsetFraction, fill]. Several thin
// rust / near-black filaments per arm read as interwoven dust, not one band.
const DUST_LANES = [
  [0.15, 0.55, 'rgba(66, 28, 20, 0.55)'],
  [0.09, 0.30, 'rgba(80, 36, 26, 0.42)'],
  [0.07, 0.02, 'rgba(50, 22, 18, 0.40)'],
  [0.10, -0.35, 'rgba(20, 12, 24, 0.48)'],
  [0.06, -0.62, 'rgba(12, 8, 20, 0.45)'],
];

// Same generator build-backgrounds.js uses for the deterministic sky, so a
// knot layout reproduces byte-for-byte across renders rather than reshuffling
// like a stray Math.random() would.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Last resolved arm geometry, kept for armLayout() at the bottom of this
// section. Null until the first spiral render, and forever in solar.
let lastArmGeometry = null;

/* Where the arms sit, given the base angles of everything rendered.

   With ARM_COUNT arms the pattern repeats every `spacing` degrees, so fold
   the base angles into one period, find the widest empty gap, and centre the
   arm on the arc opposite it. That is the phase minimising the worst
   planet's distance from an arm, and it falls out of one pass. */
function armGeometry(baseAngles) {
  const spacing = 360 / ARM_COUNT;
  const wrap = (a) => ((a % spacing) + spacing) % spacing;
  const vals = baseAngles.map(wrap).sort((a, b) => a - b);

  let gapStart = 0;
  let gap = spacing; // nothing rendered: any phase is as good as any other
  if (vals.length) {
    gap = -1;
    for (let i = 0; i < vals.length; i++) {
      const next = i + 1 < vals.length ? vals[i + 1] : vals[0] + spacing;
      if (next - vals[i] > gap) { gap = next - vals[i]; gapStart = vals[i]; }
    }
  }
  const phase = wrap(gapStart + gap / 2 + spacing / 2);
  const required = (spacing - gap) / 2; // half-width the worst planet needs
  const halfWidth = Math.min(
    ARM_HALF_WIDTH_MAX_DEG,
    Math.max(ARM_HALF_WIDTH_DEG, required + ARM_FIT_MARGIN_DEG)
  );
  return { phase, required, halfWidth, contained: required + ARM_FIT_MARGIN_DEG <= halfWidth };
}

/* One filled band, traced as a closed loop: out along its trailing edge,
   round the outer rim, back along its leading edge, round the inner rim.

   THE RIM CAPS ARE NOT DECORATION. The band sweeps ~130° of angle and is
   ~104° wide, so closing the loop with the implicit straight chord between
   the two edge ends cuts a line right back across the band's own middle —
   a self-intersecting polygon, which reads as a slice taken out of the arm
   and makes any point-in-polygon test on it meaningless. Following the
   constant radius instead keeps the boundary simple, and gives the arm a
   rounded end rather than a guillotined one.

   Same ARM_WINDING as the placement formula, by construction.

   `bandOffsetDeg` shifts the whole band off the arm centreline before the
   ± halfWidth is applied — 0 for the arm itself, non-zero for the dust
   lane that sits toward one edge rather than straddling the centre. */
function armPath(centreBase, halfWidth, bandOffsetDeg = 0) {
  const STEPS = 48;
  const CAP_STEPS = 10;
  const pt = (r, deg) => {
    const rad = (deg * Math.PI) / 180;
    // CSS rotate() is clockwise on a y-down screen, and SVG's y is down too,
    // so this is the same (cos, sin) the .orbit-spin/.orbit-offset pair traces.
    return `${(r * Math.cos(rad)).toFixed(2)} ${(r * Math.sin(rad)).toFixed(2)}`;
  };
  const centre = (r) => centreBase + ARM_WINDING * r + bandOffsetDeg;
  const points = [];
  // trailing edge, inner radius → outer
  for (let i = 0; i <= STEPS; i++) {
    const r = ARM_INNER_R + (ARM_OUTER_R - ARM_INNER_R) * (i / STEPS);
    points.push(pt(r, centre(r) - halfWidth));
  }
  // outer rim cap
  for (let i = 1; i <= CAP_STEPS; i++) {
    points.push(pt(ARM_OUTER_R, centre(ARM_OUTER_R) - halfWidth + (2 * halfWidth * i) / CAP_STEPS));
  }
  // leading edge, outer radius → inner
  for (let i = 0; i <= STEPS; i++) {
    const r = ARM_OUTER_R - (ARM_OUTER_R - ARM_INNER_R) * (i / STEPS);
    points.push(pt(r, centre(r) + halfWidth));
  }
  // inner rim cap, back to the start
  for (let i = 1; i < CAP_STEPS; i++) {
    points.push(pt(ARM_INNER_R, centre(ARM_INNER_R) + halfWidth - (2 * halfWidth * i) / CAP_STEPS));
  }
  return `M${points.join('L')}Z`;
}

/* Star knots and HII regions (layer 2): points scattered along each arm's
   centreline, radius sampled uniformly across the band, angular offset drawn
   from the sum of two uniforms (a cheap triangular distribution) so they
   cluster toward the spine rather than the edges — the same shape the spine
   itself traces. Seeded, so the pattern is identical every render for the
   same geom (same planet set), never reshuffling like Math.random() would. */
function buildStarKnots(geom) {
  const rng = mulberry32(STAR_KNOT_SEED);
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'spiral-knots');
  const perArm = Math.round(STAR_KNOT_COUNT / ARM_COUNT);
  for (let a = 0; a < ARM_COUNT; a++) {
    const centreBase = geom.phase + a * (360 / ARM_COUNT);
    for (let i = 0; i < perArm; i++) {
      const r = ARM_INNER_R + rng() * (ARM_OUTER_R - ARM_INNER_R);
      const deg = centreBase + ARM_WINDING * r + ((rng() + rng()) - 1) * geom.halfWidth * 0.85;
      const rad = (deg * Math.PI) / 180;
      const pink = rng() < KNOT_PINK_SHARE;
      const radius = pink ? 1.2 + rng() * 1.0 : 1.8 + rng() * 2.2;
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', (r * Math.cos(rad)).toFixed(2));
      circle.setAttribute('cy', (r * Math.sin(rad)).toFixed(2));
      circle.setAttribute('r', radius.toFixed(2));
      circle.setAttribute('fill', pink ? KNOT_PINK : KNOT_BLUE);
      g.appendChild(circle);
    }
  }
  return g;
}

/* Nebula blobs (Plan 6): large soft-blurred colour patches — warm HII regions
   (pink/magenta/violet) and cool star clusters (blue/teal) — scattered along
   each arm's centreline. Same seeded-PRNG discipline as buildStarKnots so the
   layout reproduces byte-for-byte across renders. Gated off at the low tier. */
function buildNebulae(geom) {
  const rng = mulberry32(NEBULA_SEED);
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'spiral-nebulae');
  for (let a = 0; a < ARM_COUNT; a++) {
    const centreBase = geom.phase + a * (360 / ARM_COUNT);
    for (let i = 0; i < NEBULA_PER_ARM; i++) {
      const r = ARM_INNER_R + 40 + rng() * (ARM_OUTER_R - ARM_INNER_R - 70);
      const deg = centreBase + ARM_WINDING * r + ((rng() + rng()) - 1) * geom.halfWidth * 0.75;
      const rad = (deg * Math.PI) / 180;
      const warm = rng() < 0.6;
      const pool = warm ? NEBULA_WARM : NEBULA_COOL;
      const id = pool[Math.floor(rng() * pool.length)];
      const radius = (warm ? 15 : 22) + rng() * 26;
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', (r * Math.cos(rad)).toFixed(2));
      circle.setAttribute('cy', (r * Math.sin(rad)).toFixed(2));
      circle.setAttribute('r', radius.toFixed(2));
      circle.setAttribute('fill', `url(#${id})`);
      circle.setAttribute('opacity', (0.82 + rng() * 0.18).toFixed(2));
      g.appendChild(circle);
    }
  }
  return g;
}

function buildSpiralArms(geom) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spiral-arms');
  svg.setAttribute('viewBox', `${-ARM_BOX / 2} ${-ARM_BOX / 2} ${ARM_BOX} ${ARM_BOX}`);
  svg.setAttribute('width', String(ARM_BOX));
  svg.setAttribute('height', String(ARM_BOX));
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(SVG_NS, 'defs');
  const grad = document.createElementNS(SVG_NS, 'radialGradient');
  grad.setAttribute('id', SPIRAL_ARM_GRADIENT_ID);
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');
  grad.setAttribute('cx', '0');
  grad.setAttribute('cy', '0');
  grad.setAttribute('r', String(ARM_OUTER_R));
  SPIRAL_ARM_GRADIENT_STOPS.forEach(([offset, r, g, b, a]) => {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', `${offset * 100}%`);
    stop.setAttribute('stop-color', `rgba(${r}, ${g}, ${b}, ${a})`);
    grad.appendChild(stop);
  });
  defs.appendChild(grad);

  // Cloud texture filter (Plan 6): fractal noise → its alpha reshaped by a
  // component transfer → composited "in" a solid arm fill, so the arm becomes
  // a patchy cloud of itself instead of a smooth gradient. feTurbulence is not
  // cheap, so the layer that uses this is gated off at the low tier (see
  // .spiral-arm-clouds in CSS). ponytail: rasterised once per renderSolarSystem
  // (each create/delete/return), not per frame — the CSS galaxy-motion is a
  // compositor-only transform and does not re-run the filter. Fine at this
  // cadence; revisit only if renderSolarSystem is ever called in a hot loop.
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', CLOUD_FILTER_ID);
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '140%');
  const turb = document.createElementNS(SVG_NS, 'feTurbulence');
  turb.setAttribute('type', 'fractalNoise');
  turb.setAttribute('baseFrequency', '0.018');
  turb.setAttribute('numOctaves', '5');
  turb.setAttribute('seed', '8');
  turb.setAttribute('stitchTiles', 'stitch');
  turb.setAttribute('result', 't');
  const ct = document.createElementNS(SVG_NS, 'feComponentTransfer');
  ct.setAttribute('in', 't');
  ct.setAttribute('result', 'tt');
  const fa = document.createElementNS(SVG_NS, 'feFuncA');
  fa.setAttribute('type', 'linear');
  fa.setAttribute('slope', '1.6');
  fa.setAttribute('intercept', '-0.45');
  ct.appendChild(fa);
  const comp = document.createElementNS(SVG_NS, 'feComposite');
  comp.setAttribute('in', 'SourceGraphic');
  comp.setAttribute('in2', 'tt');
  comp.setAttribute('operator', 'in');
  filter.appendChild(turb);
  filter.appendChild(ct);
  filter.appendChild(comp);
  defs.appendChild(filter);

  // Nebula blob gradients: bright core → transparent edge, one per colour.
  Object.entries(NEBULA_COLORS).forEach(([id, rgb]) => {
    const ng = document.createElementNS(SVG_NS, 'radialGradient');
    ng.setAttribute('id', id);
    [[0, 1], [40, 0.5], [100, 0]].forEach(([off, a]) => {
      const s = document.createElementNS(SVG_NS, 'stop');
      s.setAttribute('offset', `${off}%`);
      s.setAttribute('stop-color', `rgba(${rgb}, ${a})`);
      ng.appendChild(s);
    });
    defs.appendChild(ng);
  });

  svg.appendChild(defs);

  // Layer 1a: the gradient-filled band, brighter at mid-radius. Survives
  // every tier — same paint cost as the old flat fill it replaces.
  const glow = document.createElementNS(SVG_NS, 'g');
  glow.setAttribute('class', 'spiral-arm-glow');
  for (let i = 0; i < ARM_COUNT; i++) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'spiral-arm');
    path.setAttribute('d', armPath(geom.phase + i * (360 / ARM_COUNT), geom.halfWidth));
    path.setAttribute('fill', `url(#${SPIRAL_ARM_GRADIENT_ID})`);
    glow.appendChild(path);
  }
  svg.appendChild(glow);

  // Layer 1b: cloud texture — a copy of each arm filled solid, then the cloud
  // filter knocks patchy holes in it, so the band reads grainy rather than as
  // a smooth gradient. Gated off at the low tier (feTurbulence is expensive).
  const clouds = document.createElementNS(SVG_NS, 'g');
  clouds.setAttribute('class', 'spiral-arm-clouds');
  for (let i = 0; i < ARM_COUNT; i++) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'spiral-arm');
    path.setAttribute('d', armPath(geom.phase + i * (360 / ARM_COUNT), geom.halfWidth * 0.95));
    path.setAttribute('fill', '#aebbe0');
    path.setAttribute('filter', `url(#${CLOUD_FILTER_ID})`);
    clouds.appendChild(path);
  }
  svg.appendChild(clouds);

  // Layer 1c: nebulae — big soft colour blobs (HII regions + star clusters),
  // over the cloud so the colour reads. Gated off at the low tier.
  svg.appendChild(buildNebulae(geom));

  // Layer 2: dust lanes — several thin rust / near-black threads per arm at
  // varied offsets, so the dust reads as interwoven filaments across the glow
  // rather than one band. Visibility is gated at the low tier (.galaxy-detail).
  const dust = document.createElementNS(SVG_NS, 'g');
  dust.setAttribute('class', 'spiral-arm-dust');
  for (let i = 0; i < ARM_COUNT; i++) {
    const centreBase = geom.phase + i * (360 / ARM_COUNT);
    DUST_LANES.forEach(([w, off, fill]) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'spiral-dust');
      path.setAttribute('d', armPath(centreBase, geom.halfWidth * w, geom.halfWidth * off));
      path.setAttribute('fill', fill);
      dust.appendChild(path);
    });
  }
  svg.appendChild(dust);

  // Layer 1b: the spine, narrower and brighter, on top of the dust.
  const spine = document.createElementNS(SVG_NS, 'g');
  spine.setAttribute('class', 'spiral-arm-spine');
  for (let i = 0; i < ARM_COUNT; i++) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'spiral-spine');
    path.setAttribute('d', armPath(geom.phase + i * (360 / ARM_COUNT), geom.halfWidth * SPINE_WIDTH_FRACTION));
    path.setAttribute('fill', SPINE_FILL);
    spine.appendChild(path);
  }
  svg.appendChild(spine);

  // Layer 2: star knots, on top of everything so they stay points.
  svg.appendChild(buildStarKnots(geom));

  return svg;
}

/* The in-place rotation that replaces the orbital motion. Tier-gated the way
   the starfield is: prefers-reduced-motion forces the low tier through
   quality.js's precedence chain, so gating on the tier covers it for free.
   Re-applied on every tier change so a mid-session downgrade actually stops
   the animation instead of leaving N compositing layers spinning. */
function applyGalaxyMotion() {
  orbitsContainer.classList.toggle(
    'galaxy-motion',
    themeFlag('spiralPicker') && currentTier() !== 'low'
  );
}
applyGalaxyMotion();
onTierChange(applyGalaxyMotion);

/* Decision 15: star knots and dust lanes (the two compositing-heavy layers
   this phase adds) are gated off at the low tier — Plan 3 exists entirely
   for low-end PCs, and the picker was, until this phase, the one screen
   rendering with zero WebGL draw calls. The arm gradient and spine are NOT
   gated: they replace a fill of identical cost, so every tier keeps them.
   Same condition as applyGalaxyMotion, same re-registration requirement —
   a mid-session downgrade must hide these without a full SVG rebuild, which
   is why this is a CSS class toggle rather than conditional construction. */
function applySpiralDetail() {
  orbitsContainer.classList.toggle(
    'galaxy-detail',
    themeFlag('spiralPicker') && currentTier() !== 'low'
  );
}
applySpiralDetail();
onTierChange(applySpiralDetail);

export function renderSolarSystem() {
  orbitsContainer.innerHTML = '';
  solarSystem.querySelector('.static-new-planet')?.remove();
  const spiral = themeFlag('spiralPicker');

  // group planets by their assigned ring (default ring index 1, the
  // innermost selectable ring) so multiple planets on the same ring
  // spread out evenly around it
  const ringGroups = new Map();
  planetsCache.forEach((g) => {
    const ring = Number.isInteger(g.ring) && g.ring >= 1 && g.ring < RING_RADII.length ? g.ring : 1;
    if (!ringGroups.has(ring)) ringGroups.set(ring, []);
    ringGroups.get(ring).push(g);
  });

  if (spiral) {
    // The arms go where the ring guides go — first, so tree order alone puts
    // them behind every planet and no z-index is needed, same as the rings.
    // Plan 5 Phase 8: no longer seeded with the "+ new planet" icon's angle —
    // it's a UI affordance fixed straight down from the core (see
    // NEW_PLANET_SPIRAL_THETA), not a planet that needs an arm under it.
    const baseAngles = [];
    ringGroups.forEach((planetsOnRing, ring) => {
      planetsOnRing.forEach((_, idx) => baseAngles.push((idx / planetsOnRing.length) * 360 + ring * 23));
    });
    lastArmGeometry = armGeometry(baseAngles);
    const haze = document.createElement('div');
    haze.className = 'galaxy-haze';
    orbitsContainer.appendChild(haze);
    orbitsContainer.appendChild(buildSpiralArms(lastArmGeometry));
    // Plan 6: pulses of light that travel out through the arms from maddi. Two
    // soft rings (staggered half a cycle apart via the `.b` class) expand from
    // the core, screen-blended so they brighten each arm as they pass. Motion
    // + gating live entirely in CSS (.spiral-pulse, gated on
    // .galaxy-motion), so these are just two empty divs — appended before the
    // planets so the planets stay on top as the pulse fades into the outer arms.
    const pulseA = document.createElement('div');
    pulseA.className = 'spiral-pulse';
    const pulseB = document.createElement('div');
    pulseB.className = 'spiral-pulse b';
    orbitsContainer.appendChild(pulseA);
    orbitsContainer.appendChild(pulseB);
  } else {
    // always draw all ring guides, regardless of whether anything
    // currently orbits them
    RING_RADII.forEach((radius) => {
      const ring = document.createElement('div');
      ring.className = 'orbit-ring';
      ring.style.width = `${radius * 2}px`;
      ring.style.height = `${radius * 2}px`;
      orbitsContainer.appendChild(ring);
    });
  }

  let sizeIndex = 0;
  ringGroups.forEach((planetsOnRing, ring) => {
    const radius = RING_RADII[ring];
    const duration = 26 + ring * 16;
    const direction = ring % 2 === 0 ? 'normal' : 'reverse';
    const count = planetsOnRing.length;

    planetsOnRing.forEach((g, idx) => {
      const startAngle = (idx / count) * 360 + ring * 23; // spread + per-ring offset
      addPlanet(g, radius, duration, direction, startAngle, PLANET_SIZES[sizeIndex % PLANET_SIZES.length]);
      sizeIndex++;
    });
  });

  // "+ new planet" icon: orbits the innermost ring in solar, sits fixed
  // straight down from the core in the spiral (Plan 5 Phase 8).
  if (spiral) {
    addPlanet({ __isNew: true }, NEW_PLANET_SPIRAL_RADIUS, 0, 'normal', NEW_PLANET_SPIRAL_THETA, 30);
  } else {
    addPlanet({ __isNew: true }, RING_RADII[NEW_PLANET_RING], 26 + NEW_PLANET_RING * 16, 'normal', 180, 34);
  }

  // A rebuild creates fresh counter-animations; restart the moving parent at
  // the same instant so its rotation cannot leave the new labels tilted.
  if (spiral && orbitsContainer.classList.contains('galaxy-motion')) {
    orbitsContainer.classList.remove('galaxy-motion');
    void orbitsContainer.offsetWidth;
    orbitsContainer.classList.add('galaxy-motion');
  }
}

/* Exposed for verification only (the phase's acceptance is "every planet's
   centre falls inside a drawn band", which is a number, not a look). Null in
   solar, where no arms are drawn. */
export function armLayout() {
  return lastArmGeometry && { ...lastArmGeometry, winding: ARM_WINDING, arms: ARM_COUNT };
}

function addPlanet(g, radius, duration, direction, startAngle, size) {
  const spiral = themeFlag('spiralPicker');

  // rotating container
  const spin = document.createElement('div');
  spin.className = 'orbit-spin';

  // static radius offset (not animated)
  const offset = document.createElement('div');
  offset.className = 'orbit-offset';
  offset.style.transform = `translateX(${radius}px)`;

  // counter-rotating planet icon, keeps its label upright
  const planet = document.createElement('div');
  planet.className = 'planet';

  if (spiral) {
    /* Static, not paused: `animation-play-state: paused` would hold a
       compositing layer per planet for motion that never happens. The same
       two-layer trick still runs — the outer layer carries the angle, the
       inner one cancels it so the label stays upright — it is just written
       as a transform instead of animated through. `.planet`'s
       translate(-50%,-50%) has to be restated here: dropping it moves the
       click target off the circle you can see. */
    // Plan 5 Phase 8: the "+ new planet" icon isn't on an arm, so it skips
    // the winding term — startAngle (NEW_PLANET_SPIRAL_THETA) is its final
    // angle as-is. Every other planet still winds with radius, unchanged.
    const theta = g.__isNew ? startAngle : startAngle + ARM_WINDING * radius;
    spin.style.animation = 'none';
    spin.style.transform = `rotate(${theta}deg)`;
    planet.style.transform = `translate(-50%, -50%) rotate(${-theta}deg)`;
    planet.style.animationDelay = `${-(theta / 360) * GALAXY_SPIN_SECONDS}s`;
  } else {
    spin.style.animationDuration = `${duration}s`;
    spin.style.animationDirection = direction;
    // negative delay offsets the starting angle without fighting the
    // animation's own transform
    const delay = `${-(startAngle / 360) * duration}s`;
    spin.style.animationDelay = delay;

    planet.style.animationDuration = `${duration}s`;
    planet.style.animationDirection = direction;
    planet.style.animationDelay = delay;
  }

  const body = document.createElement('div');
  body.className = 'planet-body';
  body.style.width = `${size}px`;
  body.style.height = `${size}px`;
  body.style.position = 'absolute';
  body.style.left = '50%';
  body.style.top = '50%';
  body.style.transform = 'translate(-50%, -50%)';

  const label = document.createElement('span');
  label.className = 'planet-label';

  if (g.__isNew) {
    planet.classList.add('new-planet');
    body.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
    body.style.display = 'flex';
    body.style.alignItems = 'center';
    body.style.justifyContent = 'center';
    label.textContent = themeLabel('newPlanet');

    planet.appendChild(body);
    planet.appendChild(label);
    planet.addEventListener('click', () => openNewPlanetForm());
  } else {
    const color = g.accentColor || '#ffd9a0';
    if (spiral) {
      /* Criterion 1's third lever: a shaded sphere and a flat spiral disc are
         different silhouettes, and the silhouette is what survives cropping
         the text out. The disc lives on a ::before rather than on the body
         itself so the moon dots (real children of .planet-body) neither
         inherit the rotation nor get masked by it, and so :hover's scale on
         the body still works untouched. --planet-accent is how the per-planet
         colour reaches a pseudo-element. */
      body.classList.add('galaxy-body');
      body.style.setProperty('--planet-accent', color);
      body.style.setProperty('--planet-accent-glow', `${color}80`);
      // Deterministic, index-free spread: same planet, same spin, every render.
      body.style.setProperty('--galaxy-spin-duration', `${70 + (size % 5) * 11}s`);
      body.style.setProperty('--galaxy-spin-direction', size % 2 === 0 ? 'normal' : 'reverse');
      // A tight bulge, not a ball: the core has to stay small enough that the
      // arms on the ::before are what the eye reads first.
      body.style.background = `radial-gradient(circle at 50% 50%, #fff 0%, ${color} 12%, ${color}00 42%)`;
      /* Keep the core glow broad and soft; the rotating ::before owns the
         brighter shape-aware glow so no hard circular rim appears. */
      body.style.boxShadow = `0 0 28px 10px ${color}32`;
    } else {
      body.style.background = `radial-gradient(circle at 35% 35%, #fff, ${color} 55%, ${color} 100%)`;
      body.style.boxShadow = `0 0 18px 6px ${color}66, 0 0 36px 14px ${color}33`;
    }
    label.textContent = g.name;
    addMoonSatellites(body, size, g.moonCount || 0);

    planet.appendChild(body);
    planet.appendChild(label);
    planet.addEventListener('click', () => selectPlanet(g));
  }

  offset.appendChild(planet);
  spin.appendChild(offset);
  if (spiral && g.__isNew) {
    spin.classList.add('static-new-planet');
    solarSystem.appendChild(spin);
  } else {
    orbitsContainer.appendChild(spin);
  }
}

// One small dot per unlocked moon (capped at MAX_MOON_SATELLITES), each in
// its own orbit container with its own radius/duration/starting phase.
// Appended inside .planet-body rather than as a sibling: .planet-body's
// parent (.planet) is already counter-rotating to cancel the outer
// .orbit-spin's rotation and stay upright, so a satellite mounted here
// orbits purely around the icon itself, unaffected by the icon's own
// motion around the sun. Reuses the .orbit-spin/.orbit-rotate technique
// (zero-size rotating pivot + a translateX offset) at a smaller scale,
// collapsed into one element per dot since a plain circle needs no
// separate "stay upright" counter-rotation layer the way the planet
// icon + label do.
function addMoonSatellites(body, planetSize, moonCount) {
  const spiral = themeFlag('spiralPicker');
  const count = Math.min(moonCount, MAX_MOON_SATELLITES);
  for (let i = 0; i < count; i++) {
    let orbitRadius = planetSize / 2 + 4 + i * 3; // just outside the icon, growing per satellite

    const orbit = document.createElement('div');
    orbit.className = 'planet-moon-orbit';

    if (spiral) {
      /* Orbiting dots inside an otherwise-static spiral is the one place the
         two themes' logic would visibly contradict, so in universe these are
         a still halo instead.

         THE ANGLE HAS TO BE DERIVED, NOT ROLLED. Solar's start phase is
         Math.random(), which is invisible there because the dots are moving
         anyway — but renderSolarSystem() runs again on every create, delete
         and return from a planet, so a *static* scatter built on it would
         silently reshuffle each time. The golden angle spreads i points as
         evenly as any sequence can without knowing how many there will be,
         which is exactly the case here (the count is capped, not fixed). */
      const GOLDEN_ANGLE = 137.508;
      orbitRadius = planetSize / 2 + 6 + i * 2.6;
      orbit.style.animation = 'none';
      orbit.style.transform = `rotate(${(i * GOLDEN_ANGLE) % 360}deg)`;
    } else {
      const orbitDuration = 4 + Math.random() * 5; // seconds -- fast enough to read as motion, not a sweep
      const orbitDirection = i % 2 === 0 ? 'normal' : 'reverse';
      const startPhase = Math.random() * 360;
      orbit.style.animationDuration = `${orbitDuration}s`;
      orbit.style.animationDirection = orbitDirection;
      orbit.style.animationDelay = `${-(startPhase / 360) * orbitDuration}s`;
    }

    const moon = document.createElement('div');
    moon.className = spiral ? 'planet-moon halo' : 'planet-moon';
    const moonSize = Math.max(2, planetSize * 0.1);
    moon.style.width = `${moonSize}px`;
    moon.style.height = `${moonSize}px`;
    moon.style.transform = `translate(-50%, -50%) translateX(${orbitRadius}px)`;

    orbit.appendChild(moon);
    body.appendChild(orbit);
  }
}

// Enter a planet: hyperspace transition, then swap content underneath.
async function selectPlanet(planet) {
  setCurrentPlanet(planet);

  await playHyperspace(() => {
    // mid-transition: swap content while the screen is at peak whiteout
    planetTitleEl.textContent = `${planet.name.toLowerCase()}'s memories`;
    planetPicker.classList.add('fading');
    topbar.style.display = '';
    clearGalleryScene();
    showLoadingPlaceholders();
    // The 3D scene sleeps while the entry screen and picker are up; wake it
    // here, at the whiteout's peak, and after the placeholders exist so the
    // single catch-up frame resumeScene() draws already has them in it.
    resumeScene();
  });

  planetPicker.classList.add('hidden');
  await loadPlanetMemories(planet.id);
}

// Travel to another of the open planet's moons — the same "swap the scene
// while the screen is whited out" pattern as entering a planet, one moon's
// stars in place of one planet's memories. The hyperspace canvas doesn't take
// pointer events, so a second portal click during the trip would otherwise
// land on whatever is underneath.
// Note it shares playHyperspace with selectPlanet/showPlanetPicker but must
// NOT pause or resume: this trip starts and ends inside the planet view, and
// pausing here would stop the ring rendering with nothing to switch it back on.
let travelling = false;
setOnPortalClick(async (moonIndex) => {
  if (travelling || moonIndex === null) return;
  travelling = true;
  try {
    await playHyperspace(() => showMoon(moonIndex), 'moon');
  } finally {
    travelling = false;
  }
});

// Return to the planet picker.
async function showPlanetPicker() {
  await playHyperspace(() => {
    clearGalleryScene();
    topbar.style.display = 'none';
    planetPicker.classList.remove('hidden');
    planetPicker.classList.remove('fading');
    setCurrentPlanet(null);
    // Back to a screen the 3D scene isn't part of. Pausing at the midpoint,
    // not at the start or the end, means the last thing drawn before the
    // scene stops is already hidden behind the whiteout.
    pauseScene();
  });
  renderSolarSystem();
}

backToPlanetsBtn.addEventListener('click', () => {
  showPlanetPicker();
});

/* ============================================================
   EDIT PLANET PANEL
============================================================ */
const editPlanetOverlay = document.getElementById('editPlanetOverlay');
const editPlanetBtn = document.getElementById('editPlanetBtn');
const editPlanetName = document.getElementById('editPlanetName');
const editColorRow = document.getElementById('editColorRow');
const editRingRow = document.getElementById('editRingRow');
const cancelEditPlanetBtn = document.getElementById('cancelEditPlanetBtn');
const saveEditPlanetBtn = document.getElementById('saveEditPlanetBtn');
const deletePlanetBtn = document.getElementById('deletePlanetBtn');
const deletePlanetConfirmRow = document.getElementById('deletePlanetConfirmRow');
const cancelDeletePlanetBtn = document.getElementById('cancelDeletePlanetBtn');
const confirmDeletePlanetBtn = document.getElementById('confirmDeletePlanetBtn');
const trashList = document.getElementById('trashList');

let editSelectedColor = '#ffd9a0';
let editSelectedRing = 1;

// Loads and renders the currently-open planet's trashed memories, with
// "restore" / "delete forever" actions on each.
async function renderTrash() {
  if (!currentPlanet) return;
  trashList.innerHTML = '<div class="trash-empty">loading…</div>';
  try {
    const trashed = await loadTrashedMemories(currentPlanet.id);
    if (trashed.length === 0) {
      trashList.innerHTML = '<div class="trash-empty">nothing in the trash</div>';
      return;
    }
    trashList.innerHTML = '';
    trashed.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'trash-item';

      const title = document.createElement('span');
      title.className = 'trash-item-title';
      title.textContent = m.title || 'untitled memory';

      const actions = document.createElement('div');
      actions.className = 'trash-item-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'trash-restore-btn';
      restoreBtn.textContent = 'restore';
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        try {
          await restoreMemory(m.id);
          await renderTrash();
        } catch (e) {
          console.warn('Could not restore memory', e);
          showStorageWarning('couldn\'t restore that memory — check the gallery server and try again.');
          restoreBtn.disabled = false;
        }
      });

      const foreverBtn = document.createElement('button');
      foreverBtn.className = 'trash-forever-btn';
      foreverBtn.textContent = 'delete forever';
      foreverBtn.addEventListener('click', async () => {
        foreverBtn.disabled = true;
        try {
          await deleteMemoryForever(m.id);
          await renderTrash();
        } catch (e) {
          console.warn('Could not permanently delete memory', e);
          showStorageWarning('couldn\'t delete that memory — check the gallery server and try again.');
          foreverBtn.disabled = false;
        }
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(foreverBtn);
      row.appendChild(title);
      row.appendChild(actions);
      trashList.appendChild(row);
    });
  } catch (e) {
    console.warn('Could not load trash', e);
    trashList.innerHTML = '<div class="trash-empty">couldn\'t load trash</div>';
  }
}

editPlanetBtn.addEventListener('click', () => {
  if (!currentPlanet) return;
  editPlanetName.value = currentPlanet.name || '';
  editSelectedColor = currentPlanet.accentColor || '#ffd9a0';
  editSelectedRing = (Number.isInteger(currentPlanet.ring) && currentPlanet.ring >= 1 && currentPlanet.ring <= 3) ? currentPlanet.ring : 1;

  [...editColorRow.children].forEach(d => d.classList.toggle('active', d.dataset.color === editSelectedColor));
  [...editRingRow.children].forEach(d => d.classList.toggle('active', parseInt(d.dataset.ring, 10) === editSelectedRing));
  deletePlanetBtn.style.display = '';
  deletePlanetConfirmRow.style.display = 'none';
  confirmDeletePlanetBtn.disabled = false;
  cancelDeletePlanetBtn.disabled = false;
  editPlanetOverlay.classList.add('visible');
  renderTrash();
});

editColorRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  [...editColorRow.children].forEach(d => d.classList.toggle('active', d === dot));
  editSelectedColor = dot.dataset.color;
});

editRingRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.ring-dot');
  if (!dot) return;
  [...editRingRow.children].forEach(d => d.classList.toggle('active', d === dot));
  editSelectedRing = parseInt(dot.dataset.ring, 10);
});

function closeEditPlanet() {
  editPlanetOverlay.classList.remove('visible');
}

cancelEditPlanetBtn.addEventListener('click', closeEditPlanet);
editPlanetOverlay.addEventListener('click', (e) => {
  if (e.target === editPlanetOverlay) closeEditPlanet();
});

saveEditPlanetBtn.addEventListener('click', async () => {
  const name = editPlanetName.value.trim();
  if (!name || !currentPlanet) return;

  const updated = {
    id: currentPlanet.id,
    name,
    accentColor: editSelectedColor,
    ring: editSelectedRing
  };
  saveEditPlanetBtn.disabled = true;
  try {
    await createPlanetRemote(updated); // upserts by id
    setCurrentPlanet(updated);
    setPlanetsCache(planetsCache.map(g => g.id === updated.id ? updated : g));
    planetTitleEl.textContent = `${name.toLowerCase()}'s memories`;
    closeEditPlanet();
  } catch (e) {
    console.warn('Could not update planet', e);
    showStorageWarning('couldn\'t save those changes — check the gallery server and try again.');
  } finally {
    saveEditPlanetBtn.disabled = false;
  }
});

deletePlanetBtn.addEventListener('click', () => {
  deletePlanetBtn.style.display = 'none';
  deletePlanetConfirmRow.style.display = 'flex';
});

cancelDeletePlanetBtn.addEventListener('click', () => {
  deletePlanetConfirmRow.style.display = 'none';
  deletePlanetBtn.style.display = '';
});

confirmDeletePlanetBtn.addEventListener('click', async () => {
  if (!currentPlanet) return;
  confirmDeletePlanetBtn.disabled = true;
  cancelDeletePlanetBtn.disabled = true;
  try {
    await deletePlanetRemote(currentPlanet.id);
    setPlanetsCache(planetsCache.filter(g => g.id !== currentPlanet.id));
    closeEditPlanet();
    await showPlanetPicker();
    confirmDeletePlanetBtn.disabled = false;
    cancelDeletePlanetBtn.disabled = false;

    deletePlanetConfirmRow.style.display = 'none';
    deletePlanetBtn.style.display = '';
  } catch (e) {
    console.warn('Could not delete planet', e);
    showStorageWarning(`couldn't delete that ${themeLabel('planet')} — check the gallery server and try again.`);
    confirmDeletePlanetBtn.disabled = false;
    cancelDeletePlanetBtn.disabled = false;
  }
});
