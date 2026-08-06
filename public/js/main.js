/* ============================================================
   MAIN — read view UI, startup, and wiring between modules
============================================================ */
import { tryRestoreStorage, loadGalaxies, deleteMemory as deleteMemoryRemote } from './api.js';
import { escapeHtml, showStorageWarning, updateStorageStatusUI } from './util.js';
import { formatDate } from './cards.js';
import { removeMemoryFromScene, setOnCardClick } from './scene.js';
import { renderSolarSystem } from './galaxyPicker.js';
import './memoryForm.js';
import './entryScreen.js';
import { memories, storageMode, setStorageMode, setGalaxiesCache } from './state.js';

/* ============================================================
   UI: READ VIEW
============================================================ */
const readOverlay = document.getElementById('readOverlay');
const readCard = document.getElementById('readCard');

function openReadView(memory) {
  let html = '';
  if (memory.type === 'photo' && memory.photoData) {
    html += `<div class="read-img-wrap"><img src="${memory.photoData}" alt="${escapeHtml(memory.title)}" /></div>`;
  }
  html += `<div class="read-body">`;
  if (memory.date) {
    html += `<p class="read-date">${formatDate(memory.date)}</p>`;
  }
  html += `<h2 class="read-title">${escapeHtml(memory.title || 'untitled memory')}</h2>`;
  if (memory.text) {
    const cls = memory.type === 'letter' ? 'read-text letter' : 'read-text';
    html += `<p class="${cls}">${escapeHtml(memory.text)}</p>`;
  }
  if (memory.type === 'audio' && memory.audioData) {
    html += `<audio class="read-audio" controls src="${memory.audioData}"></audio>`;
  }
  html += `<button class="read-close" id="closeReadBtn">close</button>`;
  html += `<button class="read-delete" id="deleteMemBtn">delete this memory</button>`;
  html += `<div class="confirm-row hidden" id="deleteConfirmRow" style="display:none;">
    <button class="btn btn-secondary" id="cancelDeleteBtn">keep it</button>
    <button class="btn btn-primary" id="confirmDeleteBtn" style="background: var(--accent-deep);">yes, delete</button>
  </div>`;
  html += `</div>`;
  readCard.innerHTML = html;
  readOverlay.classList.add('visible');
  document.getElementById('closeReadBtn').addEventListener('click', closeReadView);

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
      await deleteMemory(memory);
      closeReadView();
    } catch (e) {
      console.warn('Could not delete memory', e);
      showStorageWarning('couldn\'t delete that memory — check the gallery server and try again.');
      confirmDeleteBtn.disabled = false;
      cancelDeleteBtn.disabled = false;
    }
  });
}

async function deleteMemory(memory) {
  await deleteMemoryRemote(memory.id);

  // remove from scene
  removeMemoryFromScene(memory);
  const idx = memories.findIndex(m => m.id === memory.id);
  if (idx >= 0) memories.splice(idx, 1);

  if (memories.length === 0) {
    document.getElementById('emptyHint').classList.remove('hidden');
  }
}

function closeReadView() {
  readOverlay.classList.remove('visible');
}

readOverlay.addEventListener('click', (e) => {
  if (e.target === readOverlay) closeReadView();
});

setOnCardClick(openReadView);

/* ============================================================
   STARTUP & GALAXY SWITCHING
============================================================ */
async function init() {
  setStorageMode(await tryRestoreStorage());
  updateStorageStatusUI(storageMode);

  try {
    setGalaxiesCache(await loadGalaxies());
  } catch (e) {
    console.warn('Could not load galaxies', e);
    showStorageWarning('couldn\'t reach the gallery server — check that "npm start" is running, then reload.');
  }
  renderSolarSystem();
}

init();
