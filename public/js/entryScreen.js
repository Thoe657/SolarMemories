/* ============================================================
   ENTRY SCREEN — the menu the app opens on, and returns to
   -----------------------------------------------------------
   A visual/interaction gate layered on top of the planet picker,
   which keeps initializing underneath exactly as it always has.

   PLAN 5 PHASE 1 MADE THIS A NET DELETION. It used to paint its own
   sky: a 2D canvas running a rAF loop over a per-theme set of
   drifting radial-gradient blobs, at quarter resolution and ~10fps
   (Plan 3 Phase 2) to keep the app's first impression cheap on the
   slowest machine it will ever run on. All of that — the canvas, the
   loop, the resize listener, the two blob sets — is gone, replaced by
   one fixed sky image in the stylesheet. Two reasons, in order:

   1. THE MENU IS NOW REACHABLE FROM THE APP. `enter()` was one-way and
      nothing ever removed `.fading .hidden`, so a page load was the
      only way back. Showing this screen again has to be trivial and
      idempotent, and "remove two classes" is trivial in a way
      "restart a throttled animation loop" is not.
   2. THE MENU SITS OUTSIDE BOTH THEMES (decision 5/9). It is where you
      *choose* a theme, so painting it in the theme you are about to
      leave, or have just left, says the wrong thing. The chosen sky is
      a `universe-*` variant because cool indigo reads as neutral space
      where a solar-warm sky reads as "you are in solar" — and it is
      universe-3 specifically because it measured darkest at the
      centre, where the title and the buttons sit.

   The cost, recorded so nobody "restores" it: Plan 4 Phase 4's
   per-theme blob art is discarded, and the menu no longer previews
   which theme you are about to enter. The selected chip already says
   so in words.
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
const enterBtn = document.getElementById('entryEnterBtn');

/* The screen is shown on load and hidden by `enter()`; `showEntryScreen()`
   brings it back. The two are mirror images and must be able to alternate
   indefinitely, so both are guarded on one boolean rather than on the DOM
   classes — reading the classes would make "currently fading out" and
   "hidden" two different states to reason about, and a click landing during
   the fade is exactly the case that has to behave.

   The pending timeout is tracked for the same reason: `enter()` schedules
   `.hidden` 700ms out, and a `showEntryScreen()` inside that window would
   otherwise be undone by a timer fired for a state that no longer exists. */
let visible = true;
let hideTimer = null;

// Deliberately does not touch the Three.js scene: what this reveals is the
// planet picker, which is DOM, and the picker sits between here and any
// planet. scene.js stays asleep until planetPicker.js's selectPlanet resumes
// it mid-whiteout — and stays asleep on the way back out too, since
// planetPicker.js has already paused it before this screen can be reached.
function enter() {
  if (!visible) return;
  visible = false;

  entryScreen.classList.add('fading');
  // matches the .overlay fade timing (~500-700ms) elsewhere in the app
  hideTimer = setTimeout(() => {
    hideTimer = null;
    entryScreen.classList.add('hidden');
  }, 700);
}

/* The way back, called by planetPicker.js's exit button (Plan 5 Phase 1).

   The order of the three steps is load-bearing. `.hidden` is `display: none`,
   and dropping `display: none` and `opacity: 0` in the same frame gives the
   style engine nothing to interpolate from — the screen would pop rather than
   fade. So: un-hide, force a reflow to flush that as a real starting style,
   then drop `.fading` and let the transition run. */
export function showEntryScreen() {
  if (visible) return;
  visible = true;

  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  entryScreen.classList.remove('hidden');
  void entryScreen.offsetWidth;
  entryScreen.classList.remove('fading');

  /* Both notes can have gone stale while the app was open — the quality one
     most obviously, since the rolling frame-time average may have stepped the
     tier down since this screen was last read. Re-rendering is what keeps the
     honesty the two selectors were built for; guarded because their markup is
     optional (see the two blocks below). */
  if (themeOptions && themeNote) renderThemeSelector();
  if (qualityOptions && qualityNote) renderQualitySelector();
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
