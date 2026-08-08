export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function showStorageWarning(msg) {
  const el = document.getElementById('storageStatus');
  if (!el) return;
  el.innerHTML = `<span class="dot local"></span><span>${escapeHtml(msg)}</span>`;
}

// Brief message in the shared bottom-center toast.
let toastTimer = null;
export function showToast(msg, isError = false) {
  const el = document.getElementById('backupToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}

export function updateStorageStatusUI(storageMode) {
  const el = document.getElementById('storageStatus');
  if (!el) return;

  if (storageMode === 'remote') {
    el.innerHTML = `<span class="dot connected"></span><span>synced to your shared gallery</span>`;
  } else {
    el.innerHTML = `<span class="dot local"></span><span>can't reach the gallery server — start it with "npm start" and reload</span>`;
  }
}
