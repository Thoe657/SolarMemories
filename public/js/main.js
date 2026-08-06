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
