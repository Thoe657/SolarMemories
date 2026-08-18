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
import { getSettings, saveSettings, revealDataFolder, quitApp } from './api.js';
import { showToast } from './util.js';

const entryScreen = document.getElementById('entryScreen');
const enterBtn = document.getElementById('entryEnterBtn');

/* ============================================================
   OWNER NAME (Plan 7 Phase 4)

   The app ships with data/settings.json blank on purpose -- typing her
   name here, on first launch, is the reveal moment. Once it's set, every
   later launch has to show it immediately, which is what the pre-paint
   cache in index.html's own inline script is for: this fetch is the
   authoritative correction of whatever that cache already guessed, never
   the first thing the owner sees.

   The title itself becomes the input while there's no name yet, rather
   than a separate field bolted on beside it -- one slot, shown as either
   text or an input depending on whether there's anything to show.
============================================================ */
const OWNER_NAME_KEY = 'solarMemories.ownerName';
const entryTitleEl = document.getElementById('entryTitle');
const ownerNameInput = document.getElementById('ownerNameInput');

let capturingOwnerName = false;
let ownerName = '';

function cacheOwnerName(name) {
  try {
    window.localStorage.setItem(OWNER_NAME_KEY, name);
  } catch (e) {
    // Cache is a pre-paint nicety, not the source of truth — losing it
    // just means the next load re-fetches before showing the name.
  }
}

function applyOwnerName(name) {
  ownerName = name;
  const lower = name.toLowerCase();
  document.title = `${name}'s Memories`;
  entryTitleEl.textContent = `${lower}'s memories`;
  const sunLabelEl = document.getElementById('sunLabel');
  if (sunLabelEl) sunLabelEl.textContent = lower;
  const planetTitleEl = document.getElementById('planetTitle');
  if (planetTitleEl) planetTitleEl.textContent = `${lower}'s memories`;
}

function enterCaptureMode() {
  capturingOwnerName = true;
  entryTitleEl.classList.add('hidden');
  ownerNameInput.classList.remove('hidden');
  enterBtn.disabled = true;
}

function exitCaptureMode() {
  capturingOwnerName = false;
  entryTitleEl.classList.remove('hidden');
  ownerNameInput.classList.add('hidden');
  enterBtn.disabled = false;
}

ownerNameInput.addEventListener('input', () => {
  enterBtn.disabled = !ownerNameInput.value.trim();
});

// Enter inside the input submits + enters, same as clicking the button.
ownerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!enterBtn.disabled) enterBtn.click();
  }
});

// Resolves true (and applies the name) once it's saved, false if the save
// failed and capture mode should stay up.
async function submitOwnerName() {
  const name = ownerNameInput.value.trim();
  if (!name) return false;
  enterBtn.disabled = true;
  try {
    const saved = await saveSettings(name);
    cacheOwnerName(saved);
    applyOwnerName(saved);
    exitCaptureMode();
    return true;
  } catch (e) {
    console.warn('Could not save name', e);
    enterBtn.disabled = false;
    showToast(`couldn't save that — ${e.message || 'try again'}`, true);
    return false;
  }
}

// Held disabled until the settings fetch resolves, so a click in the first
// instant of a true first launch can't slip past the still-blank name.
enterBtn.disabled = true;
getSettings()
  .then((name) => {
    if (name) {
      cacheOwnerName(name);
      applyOwnerName(name);
      enterBtn.disabled = false;
    } else {
      enterCaptureMode();
    }
  })
  .catch((e) => {
    console.warn('Could not load settings', e);
    // Whatever the pre-paint cache already showed stays; never block entry
    // on a settings fetch failing.
    enterBtn.disabled = false;
  });

/* ============================================================
   SETTINGS PANEL (Plan 7 Phase 5)

   A small gear opening three actions: change name, open the data folder,
   exit the app. Nested inside #entryScreen in the markup so it only has to
   out-rank .entry-content's z-index, not the whole app underneath.
============================================================ */
const entryContentEl = document.getElementById('entryContent');
const settingsBtn = document.getElementById('entrySettingsBtn');
const settingsOverlay = document.getElementById('ownerSettingsOverlay');
const closeSettingsBtn = document.getElementById('closeOwnerSettingsBtn');
const changeNameBtn = document.getElementById('changeNameBtn');
const revealDataBtn = document.getElementById('revealDataBtn');
const exitAppBtn = document.getElementById('exitAppBtn');
const exitAppConfirmRow = document.getElementById('exitAppConfirmRow');
const cancelExitAppBtn = document.getElementById('cancelExitAppBtn');
const confirmExitAppBtn = document.getElementById('confirmExitAppBtn');
const quitScreen = document.getElementById('quitScreen');

function openSettingsOverlay() {
  settingsOverlay.classList.add('visible');
}

function closeSettingsOverlay() {
  settingsOverlay.classList.remove('visible');
  exitAppConfirmRow.style.display = 'none';
  exitAppBtn.style.display = '';
}

settingsBtn.addEventListener('click', openSettingsOverlay);
closeSettingsBtn.addEventListener('click', closeSettingsOverlay);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettingsOverlay();
});

// Reuses the same title-becomes-input flow first-run capture uses, just
// pre-filled with the current name — submitOwnerName() already applies the
// result live, so there's nothing further to defer to a reload.
changeNameBtn.addEventListener('click', () => {
  closeSettingsOverlay();
  ownerNameInput.value = ownerName;
  enterCaptureMode();
  enterBtn.disabled = !ownerNameInput.value.trim();
  ownerNameInput.focus();
  ownerNameInput.select();
});

revealDataBtn.addEventListener('click', async () => {
  revealDataBtn.disabled = true;
  try {
    await revealDataFolder();
  } catch (e) {
    console.warn('Could not open the data folder', e);
    showToast(`couldn't open that — ${e.message || 'try again'}`, true);
  } finally {
    revealDataBtn.disabled = false;
  }
});

exitAppBtn.addEventListener('click', () => {
  exitAppBtn.style.display = 'none';
  exitAppConfirmRow.style.display = 'flex';
});

cancelExitAppBtn.addEventListener('click', () => {
  exitAppConfirmRow.style.display = 'none';
  exitAppBtn.style.display = '';
});

confirmExitAppBtn.addEventListener('click', async () => {
  confirmExitAppBtn.disabled = true;
  cancelExitAppBtn.disabled = true;
  await quitApp();
  // The server is exiting (or already has); there is nothing left to wait
  // on or roll back, so this always proceeds to the calm state.
  settingsOverlay.classList.remove('visible');
  entryContentEl.classList.add('hidden');
  settingsBtn.classList.add('hidden');
  quitScreen.classList.remove('hidden');
});

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

/* ============================================================
   SETTINGS THAT NEED A NEW PAGE (Plan 5 Phase 2)

   The theme is fixed at load by design (theme.js, decision 5) and so is
   antialias (quality.js). Both selectors below therefore used to persist a
   preference and say, honestly but unhelpfully, that it lands *next time*.
   Decision 10 makes "next time" mean "now" by reloading the page — and the
   reload is invisible, because Phase 1 made this menu theme-invariant and
   static. So it does NOT fade out first: the curtain stays up at full
   opacity, the page reloads underneath it, and the new page runs the normal
   700ms fade on arrival. What the user sees is one continuous animation.

   That is also why there is no `data-skip-entry`, no CSS hiding rule and no
   addition to index.html's inline <head> script. The flag below survives
   from the original plan but its meaning is inverted: it says "fade me out
   on arrival", not "hide me instantly".

   Decision 6 — quality reloads too, and not only when the choice crosses
   the antialias boundary. Everything else the tier controls (texture size,
   starfield density, galaxy motion) already re-applies live through
   `onTierChange`, so a boundary-conditional reload would be more correct
   and less predictable, and "sometimes pressing enter reloads and sometimes
   it doesn't" is a worse thing to explain than one extra second.
============================================================ */
const ENTER_ON_LOAD_KEY = 'solarMemories.enterOnLoad';

/* The quality choice this page resolved against. Compared against
   `userChoice()` rather than against `currentTier()`, and captured rather
   than read live, for the same reason: what warrants a reload is the *user*
   moving the selector, not the tier moving. The rolling frame-time average
   can step `currentTier()` down mid-session all on its own, and a menu that
   reloaded because the machine got busy would be exactly the unpredictable
   behaviour decision 6 rejected. quality.js's body has already run by the
   time this line does (this module imports it), so this is the stored
   choice, untouched by any click. */
const LOAD_CHOICE = userChoice();

/* Wrapped like every other web-storage access in the app: sessionStorage is
   absent in some embeddings and throws outright when site data is disabled.
   The failure mode is a menu that needs one more click, never a broken app. */
function markEnterOnLoad() {
  try {
    window.sessionStorage.setItem(ENTER_ON_LOAD_KEY, '1');
  } catch (e) {
    /* the next page will just wait for a click */
  }
}

// Read-and-clear in one step, so a flag can never outlive the one load it
// was written for — a stale "fade me out" would skip the menu on a later
// manual reload, which is the one thing this screen must never do.
function takeEnterOnLoad() {
  try {
    if (window.sessionStorage.getItem(ENTER_ON_LOAD_KEY) === null) return false;
    window.sessionStorage.removeItem(ENTER_ON_LOAD_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/* Would the next load actually be a different page? Both halves compare
   against what THIS page was built with, and both stand down when something
   outranks the selector — a ?theme= or ?quality= override wins again on the
   reload (it is still in the address bar) and prefers-reduced-motion pins
   the tier at low regardless, so reloading would spend a second to arrive
   exactly where we already are. The notes below already say so in words. */
function reloadNeeded() {
  const themeMoved = themeSource() !== 'forced' && chosenTheme() !== currentTheme();
  const qualityMoved = tierSource() !== 'forced'
    && tierSource() !== 'reduced-motion'
    && userChoice() !== LOAD_CHOICE;
  return themeMoved || qualityMoved;
}

// Deliberately does not touch the Three.js scene: what this reveals is the
// planet picker, which is DOM, and the picker sits between here and any
// planet. scene.js stays asleep until planetPicker.js's selectPlanet resumes
// it mid-whiteout — and stays asleep on the way back out too, since
// planetPicker.js has already paused it before this screen can be reached.
function enter() {
  if (!visible) return;
  visible = false;

  /* No `.fading` on this path — see the block above. `visible` is already
     false, which makes the button inert for the moment the reload takes
     rather than leaving a live control on a page that is going away. */
  if (reloadNeeded()) {
    markEnterOnLoad();
    location.reload();
    return;
  }

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

enterBtn.addEventListener('click', async () => {
  if (capturingOwnerName) {
    const saved = await submitOwnerName();
    if (!saved) return;
  }
  enter();
});

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
  // Plan 5 Phase 2: this used to read "opens in this theme next time", which
  // stopped being true when `enter()` learned to reload under its own curtain.
  if (chosenTheme() !== currentTheme()) return 'applies when you press enter';
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
      // Plan 5 Phase 2 again: still the only *deferred* setting the tier
      // owns, but "next time you open this" is now "when you press enter".
      // The note stays narrow — the rest of the tier already applied on the
      // click, so only the one thing that didn't has anything to announce.
      : 'edge smoothing applies when you press enter';
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

/* ============================================================
   ARRIVAL AFTER A SETTINGS RELOAD (Plan 5 Phase 2)

   The other half of `enter()`'s reload. The flag says the previous page's
   curtain was still up when it went, so this page owes the fade it didn't
   run — and it is the *same* fade, on an identical static menu, which is
   what makes the reload invisible.

   Deferred by a timeout rather than run inline, for two reasons:

   1. A CSS transition needs a resolved starting style to interpolate from.
      This is the same hazard showEntryScreen() documents, so it takes the
      same precaution — flush the layout first, then add `.fading`. Without
      it the screen can pop straight to transparent, which is precisely the
      discontinuity decision 10 exists to avoid.
   2. It lets main.js finish its own body and call init() first, so the
      picker is fetching underneath while the curtain is still near-opaque.
      Nothing depends on that fetch finishing — the fade is 700ms and the
      request is local — but starting the animation *after* startup's
      synchronous work rather than in the middle of it is free.

   A timeout and not requestAnimationFrame: rAF is suspended in a background
   tab, which would leave the menu sitting there until the tab is looked at.
   Harmless (the button still works) but pointless. */
if (takeEnterOnLoad()) {
  setTimeout(() => {
    void entryScreen.offsetWidth;
    enter();
  }, 0);
}
