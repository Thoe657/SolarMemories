/* ============================================================
   MAIN — startup and wiring between modules
============================================================ */
import { tryRestoreStorage, loadPlanets, createBackupRemote, listBackupsRemote, restoreBackupRemote } from './api.js';
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
   RESTORE FROM BACKUP (Phase 8)
============================================================ */
const restoreBackupBtn = document.getElementById('restoreBackupBtn');
const backupOverlay = document.getElementById('backupOverlay');
const backupList = document.getElementById('backupList');
const closeBackupOverlayBtn = document.getElementById('closeBackupOverlayBtn');

function formatBackupLabel(entry) {
  const when = new Date(entry.mtime);
  const nice = Number.isNaN(when.getTime()) ? entry.filename : when.toLocaleString();
  return nice;
}

// Loads and renders the available backups, each with a two-step
// "restore" -> "yes, restore" / "cancel" action, mirroring the same
// inline-confirm pattern the edit-planet panel's delete button uses —
// restoring wipes everything since that backup, so it shouldn't be a
// single accidental click away.
async function renderBackupList() {
  backupList.innerHTML = '<div class="trash-empty">loading…</div>';
  try {
    const backups = await listBackupsRemote();
    if (backups.length === 0) {
      backupList.innerHTML = '<div class="trash-empty">no backups yet</div>';
      return;
    }
    backupList.innerHTML = '';
    backups.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'trash-item';

      const label = document.createElement('span');
      label.className = 'trash-item-title';
      label.textContent = formatBackupLabel(entry);
      label.title = entry.filename;

      const actions = document.createElement('div');
      actions.className = 'trash-item-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'trash-restore-btn';
      restoreBtn.textContent = 'restore';

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'trash-forever-btn';
      confirmBtn.textContent = 'yes, restore';
      confirmBtn.style.display = 'none';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'cancel';
      cancelBtn.style.display = 'none';

      restoreBtn.addEventListener('click', () => {
        restoreBtn.style.display = 'none';
        confirmBtn.style.display = '';
        cancelBtn.style.display = '';
      });

      cancelBtn.addEventListener('click', () => {
        restoreBtn.style.display = '';
        confirmBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
      });

      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        showToast('restoring…');
        try {
          await restoreBackupRemote(entry.filename);
          showToast('restored ✦ reloading…');
          setTimeout(() => window.location.reload(), 1200);
        } catch (e) {
          console.warn('Restore failed', e);
          showToast(`restore failed — ${e.message || 'try again'}`, true);
          confirmBtn.disabled = false;
          cancelBtn.disabled = false;
          restoreBtn.style.display = '';
          confirmBtn.style.display = 'none';
          cancelBtn.style.display = 'none';
        }
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
      row.appendChild(label);
      row.appendChild(actions);
      backupList.appendChild(row);
    });
  } catch (e) {
    console.warn('Could not load backups', e);
    backupList.innerHTML = '<div class="trash-empty">couldn\'t load backups</div>';
  }
}

restoreBackupBtn.addEventListener('click', () => {
  backupOverlay.classList.add('visible');
  renderBackupList();
});

function closeBackupOverlay() {
  backupOverlay.classList.remove('visible');
}

closeBackupOverlayBtn.addEventListener('click', closeBackupOverlay);
backupOverlay.addEventListener('click', (e) => {
  if (e.target === backupOverlay) closeBackupOverlay();
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
