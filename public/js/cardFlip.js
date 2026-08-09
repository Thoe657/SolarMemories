/* ============================================================
   CARD FLIP — replaces the old disconnected read-overlay modal.
   Clicking a card flips its mesh in 3D, then fades in a DOM panel
   positioned over the card's on-screen rect with the full readable
   content (text, audio, related-memory chips).
============================================================ */
import { deleteMemory as deleteMemoryRemote } from './api.js';
import { escapeHtml, showStorageWarning } from './util.js';
import { formatDate, makeCardBackTexture } from './cards.js';
import { removeMemoryFromScene, setOnCardClick, getMeshScreenRect, setDragLocked, renderedStarCount } from './scene.js';
import { memories } from './state.js';
import { playUiSound } from './audioManager.js';

const panel = document.getElementById('cardFlipPanel');

const FLIP_DURATION = 400; // ms, matches the plan's "~400ms"
const FADE_DURATION = 300; // ms, matches the panel's CSS opacity transition

// 'idle' | 'opening' | 'open' | 'closing' -- guards against re-entry (rapid
// double-click, clicking another card while one is already open, etc).
let state = 'idle';
let flippedMesh = null; // the mesh actually being flip-animated
let displayedMemory = null; // whichever memory's content is currently shown

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
    const start = performance.now();

    function frame(now) {
      const t = Math.min((now - start) / FLIP_DURATION, 1);
      const eased = easeInOutQuad(t);
      mesh.rotation.y = fromRot + (toRot - fromRot) * eased;
      const s = fromScale + (toScale - fromScale) * eased;
      mesh.scale.set(s, s, s);

      if (!halfwayFired && t >= 0.5) {
        halfwayFired = true;
        onHalfway();
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
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

function renderRelatedMemoriesHtml(memory) {
  const related = getRelatedMemories(memory);
  if (related.length === 0) return '';
  let html = '<div class="related-memories">';
  related.forEach((m) => {
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
    html += `<span class="milestone-badge">✦ milestone</span>`;
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
  html += `<button class="read-delete" id="deleteMemBtn">delete this memory</button>`;
  html += `<div class="confirm-row hidden" id="deleteConfirmRow" style="display:none;">
    <button class="btn btn-secondary" id="cancelDeleteBtn">keep it</button>
    <button class="btn btn-primary" id="confirmDeleteBtn" style="background: var(--accent-deep);">yes, delete</button>
  </div>`;
  html += `</div>`;
  panel.innerHTML = html;

  document.getElementById('closeReadBtn').addEventListener('click', closeCard);

  panel.querySelectorAll('.related-memory-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const target = memories.find((m) => String(m.id) === chip.dataset.id);
      if (target) renderContent(target); // swaps in place, doesn't close/reopen
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

  await closeCard();
}

async function openCard(memory, mesh) {
  if (state !== 'idle') return; // re-entry guard
  state = 'opening';
  playUiSound('flip');

  const rect = getMeshScreenRect(mesh);
  flippedMesh = mesh;
  mesh.userData.flipping = true;
  setDragLocked(true);

  const frontMap = mesh.material.map;
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

  mesh.userData.frontMap = frontMap;
  mesh.userData.backMap = backMap;

  positionPanel(rect);
  renderContent(memory);
  await fadePanel(true);

  state = 'open';
}

async function closeCard() {
  if (state !== 'open') return;
  state = 'closing';

  await fadePanel(false);
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

  mesh.userData.flipping = false;
  setDragLocked(false);
  flippedMesh = null;
  displayedMemory = null;
  state = 'idle';
}

setOnCardClick(openCard);
