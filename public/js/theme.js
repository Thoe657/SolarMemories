/* ============================================================
   THEME REGISTRY (Plan 4 Phase 1) — one place that decides which
   vocabulary, palette and sky family the app is wearing.

   Two themes, identical in hierarchy, structure and data; different in
   appearance and wording:
     - `solar`    (default) — the sun, planets, moons, warm cream cards
     - `universe` (skin)    — the centre, galaxies, nebulae, cool graphite

   Nothing here is a data concern. The internal vocabulary (`planet`,
   `moon`, `planetId`, `moonId`) is untouched in the code, in `data/` and
   in the API; this module only decides what a human sees. Plan 4 writes
   nothing to `data/` at any point.

   THE THEME IS FIXED AT LOAD, deliberately (Plan 4 decision 5).
   Re-theming live would mean regenerating every card texture, reloading
   the sky and rebuilding the portals mid-session, for a control someone
   touches twice a year. So `setTheme()` persists a *preference* and does
   not repaint: `currentTheme()` keeps returning the theme this page was
   built against for the whole life of the page. The entry-screen selector
   says so out loud, the same way the quality selector does for antialias.
   Useful consequence: a session's card-texture cache can never hold two
   themes' cards, so Plan 3 Phase 6's LRU key needs no theme component.

   Precedence, highest first (mirroring quality.js's chain):
     1. ?theme=solar|universe — a deliberate override, for verification.
        Unlike ?quality= this one *persists*, so a themed link is a way to
        switch, not just to peek.
     2. the stored preference from an earlier session.
     3. solar.

   NEVER import scene.js from here. quality.js documents the same hazard:
   scene.js imports this module, and a cycle would put the renderer's
   construction ahead of the theme resolution — which is the one thing
   resolving early exists to prevent.
============================================================ */

// Ordered default-first. The registry keys and this list must agree.
export const THEMES = ['solar', 'universe'];

export const DEFAULT_THEME = 'solar';

/* The registry. Everything a downstream phase needs to ask about the theme
   lives in one of these records rather than in a branch somewhere:

     chipLabel    — what the entry-screen selector calls it
     labels       — the themed-copy map. DELIBERATELY MINIMAL HERE: Phase 2
                    is the label layer and fills this out. `label(key)`
                    already falls back to the key itself, so a caller added
                    early degrades to today's wording instead of printing
                    "undefined".
     backgrounds  — the sky asset family, full paths relative to /public.
                    Phase 3 picks one at random per session (scene.js does
                    that today from its own BG_VARIANTS list).
     tokens       — the four colour tokens that styles.css also carries as
                    CSS custom properties. Duplicated on purpose: the DOM
                    reads the CSS block, and cards.js draws to a canvas
                    where custom properties don't reach, so Phase 5 has it
                    read these instead of the hexes it hardcodes today.
                    The two must be kept in step; styles.css says so too.
     nebulaNames  — the 28-name pool mirroring lib/moonNames.js, mapped
                    deterministically from a moon's `index`. Phase 2 fills
                    it; empty here so nothing depends on it yet.
     features     — the structural switches, all false for solar so the
                    default theme can never take a new code path. */
const REGISTRY = {
  solar: {
    id: 'solar',
    chipLabel: 'solar system',
    labels: {},
    backgrounds: [
      'assets/backgrounds/nebula-1.webp',
      'assets/backgrounds/nebula-2.webp',
      'assets/backgrounds/nebula-3.webp'
    ],
    tokens: {
      '--card-bg': '#fffaf0',
      '--card-text': '#4a3b2a',
      '--accent': '#f2a6b0',
      '--accent-deep': '#d6798a'
    },
    nebulaNames: [],
    features: {
      spiralPicker: false,
      blackHolePortals: false,
      darkSurfaces: false
    }
  },

  universe: {
    id: 'universe',
    chipLabel: 'universe',
    labels: {},
    // These three files do not exist yet — Phase 3 generates them, as a
    // second family from the same procedural script. The paths are declared
    // now so nothing downstream has to invent a naming scheme later.
    backgrounds: [
      'assets/backgrounds/universe-1.webp',
      'assets/backgrounds/universe-2.webp',
      'assets/backgrounds/universe-3.webp'
    ],
    // Byte-identical to solar's for now, on purpose: Phase 1's whole
    // acceptance test is "nothing looks different in either theme". Phase 5
    // gives these their real cool-graphite values, alongside the matching
    // CSS block in styles.css.
    tokens: {
      '--card-bg': '#fffaf0',
      '--card-text': '#4a3b2a',
      '--accent': '#f2a6b0',
      '--accent-deep': '#d6798a'
    },
    nebulaNames: [],
    features: {
      spiralPicker: true,
      blackHolePortals: true,
      darkSurfaces: true
    }
  }
};

/* ============================================================
   PERSISTENCE

   Key naming follows quality.js's `solarMemories.<thing>` convention.
   The *value* is a bare theme name rather than quality.js's versioned
   JSON record, and that is a considered difference: the pre-paint inline
   bootstrap in index.html has to read this same key before any module
   exists, and a bare string keeps that three lines of parse-free code.
   There is also nothing here for a schema version to protect — a stored
   theme is a stated preference, not a measurement of this machine that
   could go stale when a table is retuned.

   Every access is wrapped, for the same reasons quality.js wraps its own:
   localStorage is absent in some embeddings, throws SecurityError when
   site data is disabled, and throws QuotaExceededError in private mode.
   None of that may stop the app from starting — it just means the theme
   doesn't persist.
============================================================ */
const STORAGE_KEY = 'solarMemories.theme';

function isTheme(name) {
  return THEMES.includes(name);
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch (e) {
    return null;
  }
}

function writeStored(name) {
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch (e) {
    // Nothing worth warning about on every save: the session simply runs
    // without remembering its theme.
  }
}

const rawThemeParam = new URLSearchParams(location.search).get('theme');
const queryTheme = isTheme(rawThemeParam) ? rawThemeParam : null;

/* Resolves the precedence chain into a theme and *why* it is that theme.
   The source is what the entry-screen note reads, so "universe because
   you asked in the address bar" and "universe because you chose it last
   time" are never confused for each other. */
function resolve() {
  if (queryTheme) return { theme: queryTheme, source: 'forced' };
  const stored = readStored();
  if (stored) return { theme: stored, source: 'chosen' };
  return { theme: DEFAULT_THEME, source: 'default' };
}

const resolved = resolve();

/* The theme this page was actually built against. Const, not let: see the
   "fixed at load" note at the top — everything from the sky texture to the
   baked card textures was decided against this value, so it must not move
   while the page lives. */
const LOAD_THEME = resolved.theme;

// The preference on record, which *can* move within the session (the entry
// selector writes it) and is what the next load will resolve from.
let choice = LOAD_THEME;

/* A ?theme= override persists, unlike ?quality=. It is the documented way
   to switch as well as to peek, so the next plain load stays where the link
   put you. Writing it here rather than in the inline bootstrap keeps the
   bootstrap to a read. */
if (resolved.source === 'forced') writeStored(LOAD_THEME);

/* Re-assert the attribute the inline <head> bootstrap already set. Normally
   a no-op; it matters when the bootstrap was skipped (a stale cached
   index.html, a CSP that blocks inline script) or when ?theme= disagreed
   with what was stored. Cheap insurance against the DOM and this module
   ever describing different themes. */
try {
  document.documentElement.dataset.theme = LOAD_THEME;
} catch (e) {
  /* no document (tests, workers) — nothing to paint */
}

/* ============================================================
   PUBLIC API
============================================================ */

// The theme in force for this page. Stable for the life of the page.
export function currentTheme() {
  return LOAD_THEME;
}

// How it got there: 'forced' | 'chosen' | 'default'.
export function themeSource() {
  return resolved.source;
}

// The stored preference, which the entry selector may have moved past the
// active theme. Compare with currentTheme() to tell the user honestly that
// their choice completes on the next load.
export function chosenTheme() {
  return choice;
}

// The whole registry record, for callers that want the feature flags or the
// background family. Falls back to solar rather than returning undefined:
// a bad theme name should degrade to the default, not throw mid-render.
export function themeConfig(name = LOAD_THEME) {
  return REGISTRY[name] || REGISTRY[DEFAULT_THEME];
}

// The four colour tokens, for the canvas renderers that CSS can't reach.
export function tokens(name = LOAD_THEME) {
  return themeConfig(name).tokens;
}

// One themed string. Unknown keys return the key itself, so copy that
// hasn't been added to the map yet reads as itself rather than "undefined";
// Phase 2 populates the maps.
export function label(key, name = LOAD_THEME) {
  const map = themeConfig(name).labels;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
}

// A feature flag. Unknown flags are false — a flag nobody has defined yet
// must never turn a code path on.
export function themeFlag(flag, name = LOAD_THEME) {
  return themeConfig(name).features[flag] === true;
}

/* The user-facing setter — the entry screen's selector. Persists and
   returns the stored preference. It deliberately does NOT repaint or
   change `data-theme`: see the "fixed at load" note at the top. The caller
   is expected to tell the user the change lands on the next load, which is
   what chosenTheme() vs currentTheme() is for. */
export function setTheme(next) {
  if (!isTheme(next)) return choice;
  choice = next;
  writeStored(next);
  return choice;
}
