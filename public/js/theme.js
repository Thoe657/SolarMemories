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
   built against for the whole life of the page.
   Useful consequence: a session's card-texture cache can never hold two
   themes' cards, so Plan 3 Phase 6's LRU key needs no theme component.

   THAT IS STILL TRUE, AND THE USER NO LONGER PAYS FOR IT (Plan 5 Phase 2,
   decision 10). The entry screen used to say out loud that a theme change
   landed on the *next* load, the same way the quality selector does for
   antialias. Now `enter()` reloads the page instead — under its own still-
   visible curtain, which Plan 5 Phase 1 made static and theme-invariant, so
   the reload is genuinely invisible and the new page runs the ordinary
   fade-out on arrival. Nothing here changed: a load is still what applies a
   theme. What changed is that pressing enter *is* a load.

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
     tokens       — the content-surface palette that styles.css also
                    carries as CSS custom properties. Duplicated on purpose:
                    the DOM reads the CSS block, and cards.js draws to a
                    canvas where custom properties don't reach, so Phase 5
                    has it read these instead of the hexes it used to
                    hardcode. THE TWO MUST BE KEPT IN STEP — same keys,
                    same values, in both theme blocks; styles.css says so
                    too, and the invariant is deliberately mechanical so it
                    can be checked by diffing one against the other rather
                    than by eye.
     cardPalette  — the canvas-only half: values cards.js draws with that
                    no DOM rule wants (the card's rim stroke, the letter/
                    audio placeholder blocks, the milestone gold family).
                    Kept out of `tokens` precisely so `tokens` can stay
                    one-for-one with the CSS block.
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
      // The field label above those dots. Phase 2 left it alone deliberately —
      // it is not a noun from the vocabulary table — but Phase 6 turns the
      // rings into spiral arms, and "orbit" then describes a layout that is no
      // longer there.
      ringField: 'orbit',
      /* The picker's way back to the entry screen (Plan 5 Phase 1). The same
         string in both themes, and that is the point rather than an oversight:
         decision 5 puts the menu *outside* both vocabularies — it is a fixed,
         theme-invariant sky where you choose which theme to go into. It lives
         in the map anyway so the copy is in the one table you read to check
         the two vocabularies against each other, and so a future theme can
         rename it without touching index.html. */
      exitToMenu: 'menu',
      // the topbar / edit panel
      editPlanet: 'edit planet',
      editPlanetAria: 'Edit this planet',
      backToPlanetsAria: 'Back to planets',
      deletePlanet: 'delete this planet',
      // the ring's moons and its portals
      moon: 'moon',
      previousMoon: 'previous moon',
      nextMoon: 'next moon',
      /* The read panel's milestone pill (Plan 4 Phase 8). The glyph leads the
         string rather than living in CSS as a ::before, because it is the
         DOM half of "the badge follows the shape" — the card's silhouette is
         a star here and a comet in universe, and the pill has to say the same
         thing. Kept as one label rather than a glyph key plus a word key: the
         two are never wanted apart, and one string is one thing to translate.
         The comet carries U+FE0E (text presentation) for the reason spelled
         out beside universe's copy. */
      milestoneBadge: '✦ milestone',
      /* The add-memory form's checkbox. Same glyph as the badge above and for
         the same reason — it is the promise of what the card will become, so
         it has to show the shape the cutout is about to take. Missed by Phase
         8 only because index.html was outside that phase's file set. */
      markMilestone: 'mark as milestone ✦'
    },
    backgrounds: [
      'assets/backgrounds/nebula-1.webp',
      'assets/backgrounds/nebula-2.webp',
      'assets/backgrounds/nebula-3.webp'
    ],
    /* Every value here is the literal that was sitting in styles.css (or,
       for the cardPalette below, in cards.js) before Phase 5 tokenised it.
       That is what makes "solar is pixel-identical" a property of the diff
       rather than a claim about it: the default theme's job in this phase
       is to write back exactly what was already there. */
    tokens: {
      '--card-bg': '#fffaf0',
      '--card-text': '#4a3b2a',
      '--card-muted': '#8a7a68',
      '--card-faint': '#b3a18c',
      '--accent': '#f2a6b0',
      '--accent-deep': '#d6798a',
      '--heading': '#d6798a',
      '--on-accent': '#6e2530',
      '--field-bg': '#fffdfa',
      '--field-border': '#ecdfce',
      '--surface-soft': '#fdf8ef',
      '--surface-sunk': '#f3ece1',
      '--surface-hover': '#fdf6ec',
      '--surface-rim': 'transparent',
      '--btn-disabled': '#e8d6d3',
      '--photo-backdrop': '#111',
      '--milestone-fg': '#a9791a',
      '--milestone-bg': 'rgba(255, 217, 160, 0.35)',
      '--milestone-border': 'rgba(169, 121, 26, 0.35)',
      '--danger': '#b23a3a'
    },
    cardPalette: {
      rim: 'rgba(0,0,0,0.04)',
      placeholderLetter: '#ece1f5',
      placeholderAudio: '#dceee6',
      placeholderIcon: 'rgba(0,0,0,0.35)',
      milestoneGlow: 'rgba(255, 221, 150, 0.55)',
      // The far stop of that same glow. It was a literal inside cards.js until
      // Plan 5 Phase 4; it lives here now so a theme whose milestone ink is not
      // gold cannot end up fading out through gold. Solar's value is the exact
      // literal it replaced, which is what keeps this theme pixel-identical.
      milestoneGlowFade: 'rgba(255, 221, 150, 0)',
      milestoneRing: 'rgba(201, 154, 46, 0.85)',
      milestoneLine: '#c99a2e',
      milestoneInner: 'rgba(255, 217, 160, 0.7)',
      milestoneDate: '#8a6a24'
    },
    nebulaNames: [],
    features: {
      spiralPicker: false,
      blackHolePortals: false,
      darkSurfaces: false,
      // Plan 4 Phase 8. Two flags rather than one: the milestone silhouette
      // and the hyperspace palette are separate surfaces with separate revert
      // conditions, and a theme could reasonably want one without the other.
      cometMilestones: false,
      hyperspaceRetint: false
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
      ringField: 'arm',
      // Deliberately identical to solar's — see the note beside it.
      exitToMenu: 'menu',
      editPlanet: 'edit galaxy',
      editPlanetAria: 'Edit this galaxy',
      backToPlanetsAria: 'Back to galaxies',
      deletePlanet: 'delete this galaxy',
      moon: 'nebula',
      previousMoon: 'previous nebula',
      nextMoon: 'next nebula',
      /* U+2604 COMET, followed by U+FE0E VARIATION SELECTOR-15. The selector
         is load-bearing: U+2604 defaults to *text* presentation per Unicode,
         but every platform that ships a colour comet will happily serve it
         from the emoji font if nothing asks otherwise, and a full-colour
         emoji in a gold pill ignores --milestone-fg entirely. FE0E asks for
         the monochrome glyph, which then inherits the pill's colour like the
         solar star does. Where no text glyph exists the platform falls back
         to the colour one — still a comet, just not tinted — which is the
         right failure. */
      milestoneBadge: '☄︎ milestone',
      // Carries U+FE0E for the reason given above the badge.
      markMilestone: 'mark as milestone ☄︎'
    },
    // These three files do not exist yet — Phase 3 generates them, as a
    // second family from the same procedural script. The paths are declared
    // now so nothing downstream has to invent a naming scheme later.
    backgrounds: [
      'assets/backgrounds/universe-1.webp',
      'assets/backgrounds/universe-2.webp',
      'assets/backgrounds/universe-3.webp'
    ],
    /* THE CARD SURFACE AND ITS INK ARE A SOLVED SIMULTANEOUS CONSTRAINT,
       NOT TASTE (Plan 4 Phase 5; criterion 2 of the plan's three, and the
       phase's own "letter text legible at length").

       Two bounds pull in opposite directions on the same number:

         card vs sky   (Lcard + 0.05) / (Lsky + 0.05)  >= 3     <- lighter card
         text on card  1.05 / (Lcard + 0.05)           >= 4.5   <- darker card

       The second is WCAG AA for normal-size text, and it is the right bar
       rather than the 3:1 large-text one because the longest thing anyone
       reads here is a letter: `.read-text.letter` renders at 19px, weight
       400, in Caveat — under the 24px-regular / 18.66px-bold threshold, and
       Caveat's small x-height makes it read smaller still, not larger.

       Multiplying the two out, they can only both hold if the sky-to-white
       span is at least 3 x 4.5 = 13.5:1, i.e. Lsky <= 0.0278. That is the
       whole problem in one number, and it is why this phase had to reach
       back into build-backgrounds.js: universe-2 shipped at field p99
       0.0322 (a 12.8:1 span) and NO card colour could satisfy both against
       it. Its `gain` came down until it matched its two siblings.

       With the family at 0.0262 / 0.0258 / 0.0269 the binding sky is
       universe-3, and the window for Lcard is [0.1806, 0.1833] — about one
       percent wide. #707688 sits at 0.1818, near the middle. Measured on the
       shipped WebPs, not on the drawing code:

         card vs universe-1/2/3   3.04:1 / 3.07:1 / 3.02:1
         white on card            4.53:1

       So both hexes below are load-bearing to two decimal places:
       - GOING DARKER breaks the sky ratio and invalidates the ceiling
         build-backgrounds.js derives from UNIVERSE_CARD_LUMINANCE. A card
         that sinks into the sky is the one way this theme makes the app
         worse rather than different.
       - GOING LIGHTER breaks the body-text ratio, and the ink cannot absorb
         it: --card-text is already pure white with nowhere left to go.
       - BRIGHTENING THE UNIVERSE SKY breaks both at once. The guard in
         build-backgrounds.js is what catches that.

       The cost of a mid-grey surface, stated plainly so nobody re-derives
       it as a bug: solar has 10.35:1 of range to spend on its ink hierarchy
       and universe has 4.53:1, so body/muted/faint land at 4.53 / 3.66 /
       2.90 instead of 10.35 / 3.99 / 2.40. Secondary text is a shade weaker
       than solar's and tertiary text is better; body text is what the
       criterion names and it clears AA.

       The rest of the block keeps solar's *roles* — muted, faint, sunken,
       soft — and inverts each one's direction: fields and pills go darker
       than the card so they still read as inset, text goes lighter. */
    tokens: {
      '--card-bg': '#707688',
      '--card-text': '#ffffff',
      '--card-muted': '#e2e7f5',
      '--card-faint': '#c8cfe0',
      '--accent': '#a8c4ff',
      // Backgrounds and borders only (buttons, focus rings, the checkbox).
      // Heading *text* on the card surface uses --heading instead: one value
      // cannot be both a button dark enough for white text and a heading
      // light enough to read on graphite.
      '--accent-deep': '#5f7fd0',
      '--heading': '#e6edff',
      '--on-accent': '#16203a',
      // The inset family is --card-bg scaled to 90% per channel, so "sunk
      // below the surface" survives the surface itself getting darker.
      // Derived rather than re-picked: it holds each one's ratio against the
      // card exactly where it was.
      '--field-bg': '#515768',
      '--field-border': '#8991a3',
      '--surface-soft': '#646a7a',
      '--surface-sunk': '#5c6272',
      '--surface-hover': '#676e7f',
      // Solar's panels sit on the sky as bright shapes and need no edge;
      // a graphite panel does, so the same faint luminous rim the cards get
      // is carried on the DOM surfaces as a 1px box-shadow ring.
      '--surface-rim': 'rgba(200, 215, 255, 0.30)',
      '--btn-disabled': '#505664',
      '--photo-backdrop': '#0b0d14',
      '--milestone-fg': '#ffe1a3',
      '--milestone-bg': 'rgba(255, 217, 160, 0.14)',
      '--milestone-border': 'rgba(255, 217, 160, 0.42)',
      // Solar's danger is *darker* than its muted ink; on a dark surface the
      // emphasis inverts, so this is lifted to muted's luminance rather than
      // dropped below it (2.97:1 -> 3.67:1 against the card).
      '--danger': '#ffe0e0'
    },
    /* REVERSAL (Plan 5 Phase 4, decisions 7 and 13). This block used to say the
       milestone gold stayed gold in both themes — "a signal about the memory,
       not a property of the surface". Living with the skin overturned it: the
       gold was the last warm thing left in a cool theme, and on a graphite card
       under a blue-black sky it read as foreign rather than as special. The
       comet is now ice-blue. Recorded as a reversal on purpose, so this file and
       PLAN_ARCHIVE.md do not quietly contradict each other. SOLAR'S STAR IS
       UNTOUCHED AND STAYS GOLD — the decision was about this theme.

       The milestone* family below is still live: cards.js's milestonePalette()
       falls back to it if `cometMilestones` is ever flipped off here, so the two
       families are the two silhouettes' inks, not dead weight and a replacement.

       WHY A NEW FAMILY RATHER THAN --accent (#a8c4ff). Reuse would have been
       free, and wrong: what makes a milestone read as special is that its marker
       colour appears NOWHERE else on the card. Painted in the accent, a
       milestone becomes a slightly fancier normal card. So these are their own
       blues — brighter (every one above --accent's L 0.5502) and cooler (hue
       ~205 against its 221).

       MEASURED, NOT PICKED. The universe palette window is about one percent
       wide, so every value here was checked against the card (#707688, L 0.1818)
       and none ships below the gold it replaces:

         cometGlow  1.796 : 1  (gold 1.778)   cometLine   3.285 : 1  (gold 3.182)
         cometRing  3.097 : 1  (gold 2.956)   cometInner  3.067 : 1  (gold 3.018)
         cometDate  3.866 : 1  (gold 3.632)

       The date is the binding one, and 4.5:1 is NOT reachable above this card by
       any colour at all: pure white is 4.53:1, so 4.5 needs L >= 0.9931 and only
       white-to-two-decimals clears it. The shipped gold sat at 3.632. #dbf0ff is
       the most saturated ice blue that improves on that, and improving on it is
       the bar this phase could actually hold. If the date ever has to clear 4.5,
       it has to become --card-text white and stop being a colour. */
    cardPalette: {
      rim: 'rgba(206, 221, 255, 0.55)',
      placeholderLetter: '#4c4560',
      placeholderAudio: '#3f5a50',
      placeholderIcon: 'rgba(233, 238, 255, 0.5)',
      milestoneGlow: 'rgba(255, 221, 150, 0.42)',
      milestoneGlowFade: 'rgba(255, 221, 150, 0)',
      milestoneRing: 'rgba(255, 214, 130, 0.9)',
      milestoneLine: '#ffd27a',
      milestoneInner: 'rgba(255, 240, 210, 0.75)',
      milestoneDate: '#ffe3ac',
      // The comet's ink. cometLine is what milestonePalette() tests for, so it
      // is the one entry that must exist for this family to be picked up at all.
      cometGlow: 'rgba(150, 212, 255, 0.52)',
      cometGlowFade: 'rgba(150, 212, 255, 0)',
      cometRing: 'rgba(175, 225, 255, 0.95)',
      cometLine: '#b7e1ff',
      cometInner: 'rgba(232, 246, 255, 0.75)',
      cometDate: '#dbf0ff'
    },
    nebulaNames: NEBULA_NAMES,
    features: {
      spiralPicker: true,
      blackHolePortals: true,
      darkSurfaces: true,
      cometMilestones: true,
      hyperspaceRetint: true
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
// active theme. Comparing it with currentTheme() is how the entry screen
// knows a load is owed — which since Plan 5 Phase 2 it performs itself,
// rather than only reporting.
export function chosenTheme() {
  return choice;
}

// The whole registry record, for callers that want the feature flags or the
// background family. Falls back to solar rather than returning undefined:
// a bad theme name should degrade to the default, not throw mid-render.
export function themeConfig(name = LOAD_THEME) {
  return REGISTRY[name] || REGISTRY[DEFAULT_THEME];
}

// The content-surface palette, for the canvas renderers that CSS can't
// reach. Mirrors the matching block in styles.css key for key.
export function tokens(name = LOAD_THEME) {
  return themeConfig(name).tokens;
}

// One token by name, so a caller can ask for '--card-bg' without indexing
// into the object and getting `undefined` written into a fillStyle (which
// canvas silently ignores, leaving the previous colour in place — a bug
// that shows up as "the title is the wrong colour" and nowhere else).
export function token(key, name = LOAD_THEME) {
  const value = tokens(name)[key];
  if (value === undefined) {
    console.warn(`theme: no such token ${key}`);
    return '#000';
  }
  return value;
}

// The canvas-only card values (rim, placeholder blocks, milestone gold).
export function cardPalette(name = LOAD_THEME) {
  return themeConfig(name).cardPalette;
}

/* ============================================================
   PER-PLANET ACCENT, RE-AIMED AT A DARK SURFACE (Plan 4 Phase 5)

   Every accent in the picker's swatch row is a pastel — twelve colours at
   roughly 80% lightness and 75% saturation — because they were chosen to
   sit against a cream card and a warm-lit world. Against graphite and a
   near-black sky the same twelve arrive washed out and nearly
   indistinguishable from each other: at that lightness the hue has very
   little of the colour left to carry it.

   So universe pulls the lightness down into a band where the hue can be
   seen and pushes the saturation up to replace what the lightness gave
   away. Deliberately a PURE FUNCTION of the stored value, computed at
   render time: decision 4 forbids a second stored colour, and this plan
   writes nothing to `data/` at all. The user's choice stays the user's
   choice; only its rendering is theme-aware.

   Solar returns the input untouched — not "recomputed to the same thing",
   literally the same string — so the default theme cannot drift by a
   rounding error in the HSL round trip.

   The band is a clamp rather than a scale on purpose: a clamp is a no-op
   for any accent already inside it, so a future darker swatch is left
   alone instead of being dragged to the middle with everything else. */
/* Tuned against the twelve swatches in index.html, which all sit at lightness
   0.80-0.83. A harder push (max lightness 0.62, saturation x1.15 + 0.08) was
   tried first and rejected: it turned the soft pink #f2a6b0 into #f9435b, a
   red. The point is to make the user's colour readable on a dark surface, not
   to pick a different one, so the numbers stop where the hue is still
   obviously the same colour — #f2a6b0 -> #f25f72, #a6e8f2 -> #5fdef2. */
const ACCENT_MAX_L = 0.66;   // pastels come down to here
const ACCENT_MIN_L = 0.38;   // nothing is allowed to sink into the sky
const ACCENT_S_GAIN = 1.08;  // and gets a little of the lost hue back
const ACCENT_S_LIFT = 0.04;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function parseHex(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function themedAccent(hex, name = LOAD_THEME) {
  if (!themeFlag('darkSurfaces', name)) return hex;
  const rgb = parseHex(hex);
  if (!rgb) return hex; // not a hex we understand — leave it exactly as given
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const nextL = Math.min(ACCENT_MAX_L, Math.max(ACCENT_MIN_L, l));
  const nextS = Math.min(1, s * ACCENT_S_GAIN + ACCENT_S_LIFT);
  const [r, g, b] = hslToRgb(h, nextS, nextL);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
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
   change `data-theme`: see the "fixed at load" note at the top. Getting the
   choice onto the screen is the caller's business, and since Plan 5 Phase 2
   the entry screen does it by reloading on enter — which is what
   chosenTheme() vs currentTheme() is for. */
export function setTheme(next) {
  if (!isTheme(next)) return choice;
  choice = next;
  writeStored(next);
  return choice;
}
