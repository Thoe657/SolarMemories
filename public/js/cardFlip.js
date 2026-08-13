/* ============================================================
   CARD FLIP — replaces the old disconnected read-overlay modal.
   Clicking a card flips its mesh in 3D, then fades in a DOM panel
   positioned over the card's on-screen rect with the full readable
   content (text, audio, related-memory chips).
============================================================ */
import { deleteMemory as deleteMemoryRemote, restoreMemory as restoreMemoryRemote, loadMemory } from './api.js';
import { escapeHtml, showStorageWarning, showToast } from './util.js';
import { formatDate, makeCardBackTexture } from './cards.js';
import { removeMemoryFromScene, addMemoryToScene, setOnCardClick, getMeshScreenRect, setDragLocked, renderedStarCount, addFrameCallback, onSceneStop } from './scene.js';
import { memories, currentMoons, currentMoonIndex } from './state.js';
import { openAddForm } from './memoryForm.js';
/* Imported as `themeLabel` for the same reason scene.js and planetPicker.js
   do it: `label` is already a common local name here for DOM text. */
import { label as themeLabel } from './theme.js';

const panel = document.getElementById('cardFlipPanel');
const undoToast = document.getElementById('undoToast');
const undoToastMsg = document.getElementById('undoToastMsg');
const undoToastBtn = document.getElementById('undoToastBtn');

const FLIP_DURATION = 400; // ms, matches the plan's "~400ms"
const FADE_DURATION = 300; // ms, matches the panel's CSS opacity transition
// Longer than backupToast's 3.2s (Phase 10) -- this one has an action to
// take, not just a message to read.
const UNDO_TOAST_DURATION = 6000;

// 'idle' | 'opening' | 'open' | 'closing' -- guards against re-entry (rapid
// double-click, clicking another card while one is already open, etc).
let state = 'idle';
let flippedMesh = null; // the mesh actually being flip-animated
let displayedMemory = null; // whichever memory's content is currently shown
// Cancellation token for an open/close in progress -- bumped by abandonFlip()
// when the scene stops under it. See the comment there.
let flipGeneration = 0;

/* ============================================================
   INLINE UNDO TOAST (Phase 10) — complements, doesn't replace, the
   trash panel: a faster same-session "oops" path so deleting a
   memory doesn't require opening trash to get it back. `deletedMemory`
   is the just-deleted memory object itself (not just its id), since
   deleteMemoryAndClose() already spliced it out of `memories` and its
   mesh is gone -- undo needs the full object back to symmetrically
   re-add it to both. A second delete before the first's timer expires
   simply replaces the pending one -- last delete wins the undo slot;
   the trash panel remains the reliable path for anything older.
============================================================ */
let undoToastTimer = null;
let deletedMemory = null;

function hideUndoToast() {
  undoToast.classList.remove('visible');
  clearTimeout(undoToastTimer);
  undoToastTimer = null;
  deletedMemory = null;
}

function showUndoToast(memory) {
  deletedMemory = memory;
  undoToastMsg.textContent = `deleted "${memory.title || 'untitled memory'}"`;
  undoToastBtn.disabled = false;
  undoToast.classList.add('visible');
  clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(hideUndoToast, UNDO_TOAST_DURATION);
}

undoToastBtn.addEventListener('click', async () => {
  const memory = deletedMemory;
  if (!memory) return;
  hideUndoToast();
  undoToastBtn.disabled = true;
  try {
    await restoreMemoryRemote(memory.id);
    memories.push(memory);
    // Only draw it back into the ring if it belongs to the moon currently
    // being viewed -- same check placeNewStar() uses for a freshly created
    // star, so undo can't paint a star from a different moon into the
    // wrong ring if the viewer navigated moons while the toast was up.
    const viewed = currentMoons.find((p) => p.index === currentMoonIndex);
    if (!memory.moonId || !viewed || memory.moonId === viewed.id) {
      addMemoryToScene(memory);
    }
  } catch (e) {
    console.warn('Could not undo delete', e);
    showStorageWarning('couldn\'t undo that delete — it\'s still in the trash panel, though.');
  } finally {
    undoToastBtn.disabled = false;
  }
});

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Tweens a card mesh's scale + rotation.y over FLIP_DURATION, calling
// onHalfway() at the 90°/edge-on midpoint (where the texture gets swapped).
function animateFlip(mesh, { reverse, onHalfway }) {
  return new Promise((resolve) => {
    const baseRotY = mesh.userData.baseRotY;
    const fromRot = reverse ? baseRotY + Math.PI : baseRotY;
    const toRot = reverse ? baseRotY : baseRotY + Math.PI;
    const fromScale = reverse ? 1.08 : 1;
    const toScale = reverse ? 1 : 1.08;
    let halfwayFired = false;

    /* Driven by scene.js's frame registry, not its own requestAnimationFrame.
       Two reasons, both from Plan 3. The scene's loop is throttled to the
       tier's target FPS, so a parallel rAF chain at display rate computed this
       tween about twice per frame that was actually drawn at the low tier —
       half of it thrown away unseen. And since Phase 2 the loop stops entirely
       when the planet view isn't on screen; a tween on its own chain would go
       on mutating a mesh nobody is rendering.

       Progress comes from the frame's own delta rather than performance.now(),
       so the flip lasts FLIP_DURATION of *rendered* time. A now-based tween
       would keep advancing across a stall and the card would snap to wherever
       the wall clock had reached. If the scene stops altogether, the tween is
       abandoned rather than finished — see onSceneStop below. */
    let elapsed = 0;
    let stop = null;
    let unlisten = null;

    function settle(t) {
      const eased = easeInOutQuad(t);
      mesh.rotation.y = fromRot + (toRot - fromRot) * eased;
      const s = fromScale + (toScale - fromScale) * eased;
      mesh.scale.set(s, s, s);

      if (!halfwayFired && t >= 0.5) {
        halfwayFired = true;
        onHalfway();
      }

      if (t >= 1) {
        stop();
        unlisten();
        resolve();
      }
    }

    function frame(frameDelta) {
      elapsed += frameDelta;
      settle(Math.min(elapsed / FLIP_DURATION, 1));
    }

    stop = addFrameCallback(frame);
    /* If the scene stops rendering mid-flip — the topbar's "planets" button is
       live during one — this tween will never get another frame, so it has to
       take itself out of the registry. Otherwise it would sit there and resume
       mutating the mesh the next time frames run, on a planet that may not even
       be this one.

       Deliberately *not* settle(1): abandonFlip() below has already run by this
       point (it is registered first, at module load) and put the mesh back to
       its front face. Finishing the tween here would fire onHalfway and swap
       the card's back texture in over the top of that. Resolve so nothing is
       left awaiting; the generation check in openCard/closeCard stops them
       going any further. */
    unlisten = onSceneStop(() => {
      stop();
      unlisten(); // or this tween's listener outlives the flip it belonged to
      resolve();
    });
  });
}

function fadePanel(visible) {
  return new Promise((resolve) => {
    panel.classList.toggle('visible', visible);
    setTimeout(resolve, FADE_DURATION);
  });
}

function positionPanel(rect) {
  const width = Math.min(440, window.innerWidth * 0.9);
  const maxHeight = window.innerHeight * 0.86;
  const margin = 16;
  let left = rect.left + rect.width / 2 - width / 2;
  let top = rect.top + rect.height / 2 - maxHeight / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - maxHeight - margin));
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${maxHeight}px`;
}

// Relationship is stored one-directionally (memory.relatedIds includes the
// other memory's id) but displayed bidirectionally: also scan for any
// memory whose relatedIds includes this one's id. Missing/trashed related
// ids (no longer in the loaded `memories` array) are simply skipped.
function getRelatedMemories(memory) {
  const ids = new Set((memory.relatedIds || []).map(String));
  memories.forEach((m) => {
    if ((m.relatedIds || []).map(String).includes(String(memory.id))) {
      ids.add(String(m.id));
    }
  });
  ids.delete(String(memory.id));
  return [...ids]
    .map((id) => memories.find((m) => String(m.id) === id))
    .filter(Boolean);
}

/* ============================================================
   FETCHING THE MEDIA (Plan 3 Phase 5)

   The panel is the only place a memory's audio is ever played and the only
   place its photo is shown full size, and since Phase 5 the record in
   `memories` carries hasPhoto/hasAudio rather than the bytes. So opening a
   card is where the bytes are asked for — the whole point of the phase being
   that a 6.9MB audio clip isn't downloaded to draw a ring nobody has clicked.

   The bytes are kept on the memory object afterwards, so reopening the same
   card (or editing it straight from the panel) doesn't ask again.
============================================================ */
// Opening the panel waits on the fetch below, so a request that never answers
// would leave the card stuck mid-flip with the camera locked and no way back.
// Give up rather than hang: the panel then opens without the media, which is
// recoverable, unlike a frozen screen.
const MEDIA_FETCH_TIMEOUT = 8000;

async function ensureMediaLoaded(memory) {
  const needsPhoto = memory.hasPhoto && !memory.photoData;
  const needsAudio = memory.hasAudio && !memory.audioData;
  if (!needsPhoto && !needsAudio) return;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), MEDIA_FETCH_TIMEOUT);
  try {
    const full = await loadMemory(memory.id, controller?.signal);
    if (full.photoData) memory.photoData = full.photoData;
    if (full.audioData) memory.audioData = full.audioData;
  } catch (e) {
    // The panel below renders whatever it actually has, so a failure here
    // costs the photo/audio and not the memory — but silently showing a photo
    // memory as text only would read as data loss, hence the toast.
    console.warn('Could not load this memory\'s photo/audio', e);
    showToast('couldn\'t load this memory\'s photo/audio — check the gallery server.', true);
  } finally {
    clearTimeout(timer);
  }
}

function renderRelatedMemoriesHtml(memory) {
  const related = getRelatedMemories(memory);
  if (related.length === 0) return '';
  let html = '<div class="related-memories">';
  related.forEach((m) => {
    /* Thumbnail only when the photo is already in hand — i.e. the related
       memory is on the moon you're looking at, or you've opened it this
       session. Deliberately no fetch: a chip is a 22px circle, and the only
       way to fill it is a full record each, so five related memories would
       pull megabytes (their audio included) to decorate five buttons — the
       exact cost Phase 5 exists to remove, spent on the smallest thing on
       screen. Without it the chip is its title, which is how every related
       letter and audio memory has always rendered. */
    const thumb = m.type === 'photo' && m.photoData ? `<img src="${m.photoData}" alt="" />` : '';
    html += `<button class="related-memory-chip" data-id="${escapeHtml(String(m.id))}">${thumb}<span>${escapeHtml(m.title || 'untitled memory')}</span></button>`;
  });
  html += '</div>';
  return html;
}

// Renders `memory`'s content into the panel (already positioned/visible).
// Used both for the initial open and for swapping to a related memory in
// place, without closing/reopening the panel.
function renderContent(memory) {
  displayedMemory = memory;

  let html = '';
  if (memory.type === 'photo' && memory.photoData) {
    html += `<div class="read-img-wrap"><img src="${memory.photoData}" alt="${escapeHtml(memory.title)}" /></div>`;
  }
  html += `<div class="read-body">`;
  if (memory.date) {
    html += `<p class="read-date">${formatDate(memory.date)}</p>`;
  }
  if (memory.milestone) {
    /* The DOM half of "the badge glyph follows the shape" (Plan 4 Phase 8).
       The card's own silhouette is cut by cards.js -- a star in solar, a
       comet in universe -- and this pill is the only other place the app
       says "milestone" about a memory, so it carries the matching glyph.
       Escaped like every other string that reaches innerHTML here, even
       though this one comes from our own registry rather than from a
       record: the rule is worth more than the exception. */
    html += `<span class="milestone-badge">${escapeHtml(themeLabel('milestoneBadge'))}</span>`;
  }
  html += `<h2 class="read-title">${escapeHtml(memory.title || 'untitled memory')}</h2>`;
  if (memory.text) {
    const cls = memory.type === 'letter' ? 'read-text letter' : 'read-text';
    html += `<p class="${cls}">${escapeHtml(memory.text)}</p>`;
  }
  if (memory.type === 'audio' && memory.audioData) {
    html += `<audio class="read-audio" controls src="${memory.audioData}"></audio>`;
  }
  html += renderRelatedMemoriesHtml(memory);
  html += `<button class="read-close" id="closeReadBtn">close</button>`;
  html += `<button class="read-close" id="editMemBtn">edit</button>`;
  html += `<button class="read-delete" id="deleteMemBtn">delete this memory</button>`;
  html += `<div class="confirm-row hidden" id="deleteConfirmRow" style="display:none;">
    <button class="btn btn-secondary" id="cancelDeleteBtn">keep it</button>
    <button class="btn btn-primary" id="confirmDeleteBtn" style="background: var(--accent-deep);">yes, delete</button>
  </div>`;
  html += `</div>`;
  panel.innerHTML = html;

  document.getElementById('closeReadBtn').addEventListener('click', closeCard);

  document.getElementById('editMemBtn').addEventListener('click', () => {
    // Capture `memory` (this renderContent() call's closure param) rather
    // than reading the module-level `displayedMemory` after closeCard()
    // resolves -- closeCard() nulls that out as part of closing.
    closeCard().then(() => openAddForm(memory));
  });

  panel.querySelectorAll('.related-memory-chip').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const target = memories.find((m) => String(m.id) === chip.dataset.id);
      if (!target) return;
      // Same media fetch the card open does — swapping to a related memory
      // shows it in the panel just as fully, photo and audio included.
      await ensureMediaLoaded(target);
      if (state !== 'open') return; // panel was closed while that was in flight
      renderContent(target); // swaps in place, doesn't close/reopen
    });
  });

  const deleteBtn = document.getElementById('deleteMemBtn');
  const confirmRow = document.getElementById('deleteConfirmRow');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  deleteBtn.addEventListener('click', () => {
    deleteBtn.style.display = 'none';
    confirmRow.style.display = 'flex';
  });
  cancelDeleteBtn.addEventListener('click', () => {
    confirmRow.style.display = 'none';
    deleteBtn.style.display = '';
  });
  confirmDeleteBtn.addEventListener('click', async () => {
    confirmDeleteBtn.disabled = true;
    cancelDeleteBtn.disabled = true;
    try {
      await deleteMemoryAndClose(memory);
    } catch (e) {
      console.warn('Could not delete memory', e);
      showStorageWarning('couldn\'t delete that memory — check the gallery server and try again.');
      confirmDeleteBtn.disabled = false;
      cancelDeleteBtn.disabled = false;
    }
  });
}

async function deleteMemoryAndClose(memory) {
  await deleteMemoryRemote(memory.id);

  removeMemoryFromScene(memory);
  const idx = memories.findIndex((m) => m.id === memory.id);
  if (idx >= 0) memories.splice(idx, 1);

  // The hint is about the ring being empty, so it tracks rendered stars —
  // `memories` also holds the planet's other moons' stars.
  if (renderedStarCount() === 0) {
    document.getElementById('emptyHint').classList.remove('hidden');
  }

  showUndoToast(memory);

  await closeCard();
}

async function openCard(memory, mesh) {
  if (state !== 'idle') return; // re-entry guard
  state = 'opening';
  const generation = flipGeneration;

  const rect = getMeshScreenRect(mesh);
  flippedMesh = mesh;
  mesh.userData.flipping = true;
  setDragLocked(true);

  // Started here rather than after the flip so the round trip happens *during*
  // the 400ms the card spends turning over — on a local server that is usually
  // the whole of it, and the panel opens with its photo already there.
  const mediaReady = ensureMediaLoaded(memory);

  // Stashed before the flip, not after it. scene.js may be part-way through
  // fetching this card's photo, and when it arrives refreshMemoryTexture hands
  // the redrawn front to userData.frontMap rather than to the live map (which
  // is the back of the card by then) — so the slot has to already exist, or
  // assigning it afterwards would put the photoless drawing back.
  const frontMap = mesh.material.map;
  mesh.userData.frontMap = frontMap;
  const backMap = makeCardBackTexture(memory);
  // A 180° Y-rotation shows the mesh's back face, which mirrors the
  // texture horizontally by default -- cancel that out so the back-of-card
  // text renders right-reading, not flipped.
  backMap.wrapS = THREE.RepeatWrapping;
  backMap.repeat.x = -1;

  await animateFlip(mesh, {
    reverse: false,
    onHalfway: () => {
      mesh.material.map = backMap;
      mesh.material.needsUpdate = true;
    }
  });

  // Abandoned while we were awaiting — the scene stopped and abandonFlip()
  // already put this mesh and the panel back. Every await below is a point
  // where that can have happened; carrying on would re-open a panel over a
  // planet the viewer has left.
  if (generation !== flipGeneration) {
    backMap.dispose();
    return;
  }

  mesh.userData.backMap = backMap;

  // Whatever the fetch above is going to produce, the panel is drawn from the
  // finished record — never from a half-loaded one that would render a photo
  // memory as text only.
  await mediaReady;
  if (generation !== flipGeneration) return;

  positionPanel(rect);
  renderContent(memory);
  await fadePanel(true);
  if (generation !== flipGeneration) return;

  state = 'open';
}

async function closeCard() {
  if (state !== 'open') return;
  state = 'closing';
  const generation = flipGeneration;

  await fadePanel(false);
  // Same abandonment check as openCard: if the scene stopped during the fade,
  // abandonFlip() has already put everything back and flippedMesh is null.
  if (generation !== flipGeneration) return;
  panel.innerHTML = '';

  const mesh = flippedMesh;
  await animateFlip(mesh, {
    reverse: true,
    onHalfway: () => {
      mesh.material.map = mesh.userData.frontMap;
      mesh.material.needsUpdate = true;
      mesh.userData.backMap?.dispose();
      mesh.userData.backMap = null;
    }
  });

  if (generation !== flipGeneration) return;
  mesh.userData.flipping = false;
  setDragLocked(false);
  flippedMesh = null;
  displayedMemory = null;
  state = 'idle';
}

/* Leaving a planet with a card open used to strand the whole view.

   setDragLocked(true) is set when a card opens and only ever cleared by
   closeCard(), and nothing closed the card on the way out to the picker — so
   coming back left `state` at 'open', the drag lock on, and a stale panel over
   the ring. Both the camera and every card click test that lock first, so the
   planet was frozen until a reload. That predates Plan 3; it is fixed here
   because Phase 8 moved the flip tween onto the scene's frame registry, which
   is what made "the scene stopped" an event this file can see at all.

   flipGeneration is the cancellation token. Resolving a tween's promise isn't
   enough on its own: openCard/closeCard resume on a microtask *after* this
   handler returns, so without a token they would carry on and re-open the
   panel over a planet that is no longer on screen. Bumping the generation
   makes every await in those functions bail instead.

   Tear down rather than animate: by the time this fires the whiteout covers
   the screen and the planet view is gone, so there is nothing to play out. */

function abandonFlip() {
  if (state === 'idle') return;
  flipGeneration++;
  panel.classList.remove('visible');
  panel.innerHTML = '';
  const mesh = flippedMesh;
  if (mesh) {
    mesh.rotation.y = mesh.userData.baseRotY;
    mesh.scale.set(1, 1, 1);
    mesh.userData.flipping = false;
    if (mesh.userData.frontMap) {
      mesh.material.map = mesh.userData.frontMap;
      mesh.material.needsUpdate = true;
    }
    mesh.userData.backMap?.dispose();
    mesh.userData.backMap = null;
  }
  setDragLocked(false);
  flippedMesh = null;
  displayedMemory = null;
  state = 'idle';
}

onSceneStop(abandonFlip);

setOnCardClick(openCard);
