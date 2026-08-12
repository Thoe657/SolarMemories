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
     labels       — the themed-copy map, filled by Phase 2. `label(key)`
                    falls back to the key itself, so a caller reaching for
                    copy nobody has written yet reads as the key rather
                    than printing "undefined".
                    THE KEYS ARE THE *INTERNAL* VOCABULARY (newPlanet,
                    nextMoon, ...), not either theme's wording. Decision 3
                    is that the code keeps saying `planet`/`moon` forever;
                    a key named after solar's copy would have made the
                    default theme's wording load-bearing in the source of
                    every other theme, which is the opposite of a skin.
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
                    deterministically from a moon's `index` (see
                    groupingName below). Solar's is EMPTY and stays empty:
                    an empty pool is how groupingName knows to hand back
                    the moon's own stored name untouched, so the default
                    theme has no derivation step to get wrong.
     features     — the structural switches, all false for solar so the
                    default theme can never take a new code path. */
/* The 28 nebulae, mirroring src/lib/moonNames.js's 28 moons one for one —
   same count, same bar: real objects with real names, no catalogue numbers.
   (That bar is why decision 6 rejected black-hole names: the real ones are
   mostly designations — TON 618, GRO J1655-40 — and you cannot reach 28
   without them reading as serial numbers. The black hole is the doorway;
   the nebula is where you arrive.)

   Two differences from the moon pool, both deliberate:

   - It is ORDERED, not drawn at random. moonNames.js picks uniformly from
     what's unused because a moon's name is a stored fact created once; a
     nebula name is *derived at render time*, every load, from data that
     never mentions it (decision 6 — this plan writes nothing to `data/`).
     A random pick would therefore rename a grouping on every reload.
   - It is indexed straight off `moon.index`, with no avoid-list. Index is
     already unique within a planet and already 0-based and gapless
     (routes/memories.js assigns `newest.index + 1`), so uniqueness within a
     planet comes free for the first 28 — the same point past which the moon
     pool starts repeating too.

   Index 0 is Orion on purpose: the first grouping anyone ever makes is the
   one nebula everybody can picture. */
const NEBULA_NAMES = [
  'Orion', 'Eagle', 'Crab', 'Helix', 'Ring', 'Lagoon', 'Trifid', 'Rosette',
  'Horsehead', 'Carina', 'Tarantula', 'Veil', "Cat's Eye", 'Owl', 'Dumbbell',
  'Butterfly', 'Pelican', 'Flame', 'Cone', 'Boomerang', 'Bubble', 'Heart',
  'Soul', 'Swan', 'Witch Head', "Elephant's Trunk", 'Ghost', 'Cocoon'
];

const REGISTRY = {
  solar: {
    id: 'solar',
    chipLabel: 'solar system',
    /* Solar's map is today's wording, written out rather than left empty
       and leaned on `label()`'s key fallback. The fallback exists for copy
       that hasn't been themed yet; using it as the *design* would have made
       every solar string invisible here, so the one table you'd want to read
       when checking the two vocabularies against each other would only ever
       have shown half of it. */
    labels: {
      // the picker
      planet: 'planet',
      planets: 'planets',
      newPlanet: 'new planet',
      planetNamePlaceholder: 'e.g. luna the dog, family trips...',
      // Rings are "distance out from the centre" in both themes (decision 7
      // keeps `ring` meaning exactly what it means today); only the thing at
      // the centre is renamed, and maddi is never given a noun on screen.
      ringHint: 'closest to farthest from the sun',
      // the topbar / edit panel
      editPlanet: 'edit planet',
      editPlanetAria: 'Edit this planet',
      backToPlanetsAria: 'Back to planets',
      deletePlanet: 'delete this planet',
      // the ring's moons and its portals
      moon: 'moon',
      previousMoon: 'previous moon',
      nextMoon: 'next moon'
    },
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
    /* The same keys, one step up the scale: a person is a galaxy, a
       grouping of ≤28 is a nebula, a memory is still a star. "not formed
       yet" is deliberately absent — a grouping that doesn't exist yet
       hasn't formed in either vocabulary, so it is one literal, not two. */
    labels: {
      planet: 'galaxy',
      planets: 'galaxies',
      newPlanet: 'new galaxy',
      planetNamePlaceholder: 'e.g. luna the dog, family trips...',
      // "the sun" -> "the centre", not "the centre of the universe": this is
      // a hint under three orbit dots, and the long form is a description of
      // maddi rather than a direction. Named in the plan explicitly.
      ringHint: 'closest to farthest from the centre',
      editPlanet: 'edit galaxy',
      editPlanetAria: 'Edit this galaxy',
      backToPlanetsAria: 'Back to galaxies',
      deletePlanet: 'delete this galaxy',
      moon: 'nebula',
      previousMoon: 'previous nebula',
      nextMoon: 'next nebula'
    },
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
    nebulaNames: NEBULA_NAMES,
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

/* What to CALL one of a planet's groupings on screen.

   Solar hands back `storedName` — the moon's own name, straight off the
   record, chosen once by lib/moonNames.js and written to `data/`. Nothing is
   derived and nothing can drift.

   Universe derives a nebula from the grouping's `index` instead, because
   decision 6 forbids storing a second name (this plan writes nothing to
   `data/` at all). `index % pool.length` is the whole rule, deliberately:
   the mapping has to be checkable by eye — the first grouping is always
   Orion, the second always Eagle — and a hash would have made "why is this
   one the Veil" unanswerable without running the code.

   The accepted trade, agreed in decision 6: the same grouping is Europa in
   one theme and Orion in the other. They are two names for one thing, the
   way the two themes are two names for everything.

   Callers pass both, and the empty-pool test is what selects between them —
   so a theme is opted in by having a pool, not by being checked for by name. */
export function groupingName(index, storedName, name = LOAD_THEME) {
  const pool = themeConfig(name).nebulaNames;
  if (!pool || pool.length === 0) return storedName;
  // A record with no usable index (nothing on disk should have one, but a
  // backfilled or hand-edited moon might) keeps its stored name rather than
  // being silently filed under Orion alongside the real first grouping.
  if (!Number.isInteger(index) || index < 0) return storedName;
  return pool[index % pool.length];
}

/* ============================================================
   STATIC COPY IN THE MARKUP

   index.html carries today's (solar) wording as its literal text, and a
   `data-label` key beside it. That is the right way round for three
   reasons: the markup still reads as English in a diff, the file renders
   correctly before any module has run, and the solar theme's job here is
   to write back exactly what is already there.

   Three attributes, because the copy lands in three different places and
   an element can need more than one (a topbar button holds an SVG *and* a
   text span *and* an aria-label — writing textContent on the button itself
   would delete the icon, so the key goes on the inner span and the aria key
   on the button):

     data-label             -> textContent
     data-label-placeholder -> the placeholder attribute
     data-label-aria        -> the aria-label attribute

   Run once from this module's body rather than from main.js, which is not
   in this phase's file set and does not need to be: module bodies run once,
   after the document is parsed (module scripts are deferred by definition),
   and this module is already the first thing main.js imports. Wrapped for
   the same reason the data-theme write is — no document in tests/workers.
============================================================ */
const LABEL_ATTRS = [
  ['data-label', (el, text) => { el.textContent = text; }],
  ['data-label-placeholder', (el, text) => { el.setAttribute('placeholder', text); }],
  ['data-label-aria', (el, text) => { el.setAttribute('aria-label', text); }]
];

// Exported as well as auto-run: anything that clones themed markup into the
// DOM later can re-run it over its own subtree.
export function applyLabels(root = document, name = LOAD_THEME) {
  LABEL_ATTRS.forEach(([attr, write]) => {
    root.querySelectorAll(`[${attr}]`).forEach((el) => {
      write(el, label(el.getAttribute(attr), name));
    });
  });
}

try {
  applyLabels();
} catch (e) {
  /* no document (tests, workers) — nothing to label */
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
