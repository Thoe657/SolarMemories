/* ============================================================
   MAIN — startup and wiring between modules
============================================================ */
import { tryRestoreStorage, loadGalaxies, createBackupRemote } from './api.js';
import { showStorageWarning, updateStorageStatusUI } from './util.js';
import { renderSolarSystem } from './galaxyPicker.js';
import './memoryForm.js';
import './entryScreen.js';
import './cardFlip.js';
import { storageMode, setStorageMode, setGalaxiesCache } from './state.js';
import { isQuietMode, setQuietMode } from './audioManager.js';

/* ============================================================
   QUIET MODE TOGGLE
============================================================ */
const quietModeBtn = document.getElementById('quietModeBtn');

function syncQuietModeBtn(quiet) {
  quietModeBtn.classList.toggle('active', quiet);
  quietModeBtn.setAttribute('aria-pressed', String(quiet));
  quietModeBtn.setAttribute('aria-label', quiet ? 'Turn quiet mode off' : 'Turn quiet mode on');
}
syncQuietModeBtn(isQuietMode());

quietModeBtn.addEventListener('click', () => {
  setQuietMode(!isQuietMode());
  syncQuietModeBtn(isQuietMode());
});

/* ============================================================
   BACKUP
============================================================ */
const backupBtn = document.getElementById('backupBtn');
const backupToast = document.getElementById('backupToast');
let toastTimer = null;

function showToast(msg, isError = false) {
  backupToast.textContent = msg;
  backupToast.classList.toggle('error', isError);
  backupToast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => backupToast.classList.remove('visible'), 3200);
}

backupBtn.addEventListener('click', async () => {
  backupBtn.disabled = true;
  showToast('backing up…');
  try {
    await createBackupRemote();
    showToast('backup saved ✦');
  } catch (e) {
    console.warn('Backup failed', e);
    showToast(`backup failed — ${e.message || 'try again'}`, true);
  } finally {
    backupBtn.disabled = false;
  }
});

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
