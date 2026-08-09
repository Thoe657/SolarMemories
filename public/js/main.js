/* ============================================================
   MAIN — startup and wiring between modules
============================================================ */
import { tryRestoreStorage, loadPlanets, createBackupRemote } from './api.js';
import { showStorageWarning, showToast, updateStorageStatusUI } from './util.js';
import { renderSolarSystem } from './planetPicker.js';
import './memoryForm.js';
import './entryScreen.js';
import './cardFlip.js';
import { storageMode, setStorageMode, setPlanetsCache } from './state.js';

/* ============================================================
   BACKUP
============================================================ */
const backupBtn = document.getElementById('backupBtn');

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
   STARTUP & PLANET SWITCHING
============================================================ */
async function init() {
  setStorageMode(await tryRestoreStorage());
  updateStorageStatusUI(storageMode);

  try {
    setPlanetsCache(await loadPlanets());
  } catch (e) {
    console.warn('Could not load planets', e);
    showStorageWarning('couldn\'t reach the gallery server — check that "npm start" is running, then reload.');
  }
  renderSolarSystem();
}

init();
