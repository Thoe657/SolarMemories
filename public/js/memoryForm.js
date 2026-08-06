/* ============================================================
   UI: ADD MEMORY FORM — form logic, photo compression
============================================================ */
import { addMemoryToScene } from './scene.js';
import { persistMemory } from './api.js';
import { showStorageWarning } from './util.js';
import { memories, currentGalaxyId, storageMode } from './state.js';

const addOverlay = document.getElementById('addOverlay');
const openAddBtn = document.getElementById('openAddBtn');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const saveMemBtn = document.getElementById('saveMemBtn');
const typeRow = document.getElementById('typeRow');
const memTitle = document.getElementById('memTitle');
const memDate = document.getElementById('memDate');
const memText = document.getElementById('memText');
const textLabel = document.getElementById('textLabel');
const textField = document.getElementById('textField');
const photoField = document.getElementById('photoField');
const audioField = document.getElementById('audioField');
const photoDrop = document.getElementById('photoDrop');
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const audioDrop = document.getElementById('audioDrop');
const audioInput = document.getElementById('audioInput');
const audioPreview = document.getElementById('audioPreview');

let currentType = 'photo';
let pendingPhotoDataUrl = null;
let pendingPhotoImg = null;
let pendingAudioDataUrl = null;

const typeLabels = {
  photo: 'caption',
  letter: 'letter',
  audio: 'caption'
};
const typePlaceholders = {
  photo: "what's this photo about...",
  letter: 'write your letter here...',
  audio: 'What does this remind you of?'
};

function setType(type) {
  currentType = type;
  [...typeRow.children].forEach(p => p.classList.toggle('active', p.dataset.type === type));
  photoField.style.display = type === 'photo' ? '' : 'none';
  audioField.style.display = type === 'audio' ? '' : 'none';
  textLabel.textContent = typeLabels[type];
  memText.placeholder = typePlaceholders[type];
  memText.style.minHeight = type === 'letter' ? '160px' : '90px';
  validateForm();
}

typeRow.addEventListener('click', (e) => {
  const pill = e.target.closest('.type-pill');
  if (pill) setType(pill.dataset.type);
});

photoDrop.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const rawDataUrl = e.target.result;
    const img = new Image();
    img.onload = () => {
      compressImage(img, file.type).then((compressedDataUrl) => {
        pendingPhotoDataUrl = compressedDataUrl;
        pendingPhotoImg = img;
        photoPreview.src = compressedDataUrl;
        photoPreview.style.display = 'block';
        photoDrop.textContent = file.name;
        photoDrop.classList.add('has-file');
        validateForm();
      });
    };
    img.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
});

// Resize large photos down to a manageable size and re-encode as JPEG
// so the gallery stays fast and storage stays small.
function compressImage(img, originalType) {
  return new Promise((resolve) => {
    const MAX_DIM = 1600;
    let { width, height } = img;
    if (width > MAX_DIM || height > MAX_DIM) {
      if (width > height) {
        height = Math.round(height * (MAX_DIM / width));
        width = MAX_DIM;
      } else {
        width = Math.round(width * (MAX_DIM / height));
        height = MAX_DIM;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    // keep PNG transparency for png/webp/gif, otherwise use JPEG for smaller files
    const keepPng = originalType === 'image/png' || originalType === 'image/gif';
    const outType = keepPng ? 'image/png' : 'image/jpeg';
    const quality = keepPng ? undefined : 0.82;
    resolve(canvas.toDataURL(outType, quality));
  });
}

audioDrop.addEventListener('click', () => audioInput.click());
audioInput.addEventListener('change', () => {
  const file = audioInput.files[0];
  if (!file) return;

  if (storageMode !== 'fs' && file.size > 3 * 1024 * 1024) {
    showStorageWarning('that audio file is fairly large for browser storage — connect a folder for unlimited space, or use a shorter/smaller clip.');
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    pendingAudioDataUrl = e.target.result;
    audioPreview.src = pendingAudioDataUrl;
    audioPreview.style.display = 'block';
    audioDrop.textContent = file.name;
    audioDrop.classList.add('has-file');
    validateForm();
  };
  reader.readAsDataURL(file);
});

function validateForm() {
  let ok = memTitle.value.trim().length > 0;
  if (currentType === 'photo') ok = ok && !!pendingPhotoDataUrl;
  if (currentType === 'audio') ok = ok && !!pendingAudioDataUrl;
  if (currentType === 'letter') ok = ok && memText.value.trim().length > 0;
  saveMemBtn.disabled = !ok;
}

memTitle.addEventListener('input', validateForm);
memText.addEventListener('input', validateForm);

function openAddForm() {
  addOverlay.classList.add('visible');
}
function closeAddForm() {
  addOverlay.classList.remove('visible');
  resetForm();
}
function resetForm() {
  memTitle.value = '';
  memText.value = '';
  memDate.value = '';
  pendingPhotoDataUrl = null;
  pendingPhotoImg = null;
  pendingAudioDataUrl = null;
  photoPreview.style.display = 'none';
  photoPreview.src = '';
  photoDrop.textContent = 'click to choose a photo';
  photoDrop.classList.remove('has-file');
  audioPreview.style.display = 'none';
  audioPreview.src = '';
  audioDrop.textContent = 'click to choose an audio file';
  audioDrop.classList.remove('has-file');
  setType('photo');
}

openAddBtn.addEventListener('click', openAddForm);
cancelAddBtn.addEventListener('click', closeAddForm);
addOverlay.addEventListener('click', (e) => {
  if (e.target === addOverlay) closeAddForm();
});

saveMemBtn.addEventListener('click', async () => {
  const memory = {
    id: Date.now(),
    type: currentType,
    title: memTitle.value.trim(),
    date: memDate.value,
    text: memText.value.trim(),
    photoData: pendingPhotoDataUrl,
    photoImg: pendingPhotoImg,
    audioData: pendingAudioDataUrl
  };
  memories.push(memory);
  addMemoryToScene(memory);
  closeAddForm();
  try {
    await persistMemory(memory, currentGalaxyId);
  } catch (e) {
    console.warn('Could not save memory', e);
    const msg = storageMode === 'remote'
      ? `couldn't save to the gallery server (${e.message || 'connection error'}) — it's shown here but may not persist.`
      : 'couldn\'t save that memory — try connecting a folder for more reliable storage.';
    showStorageWarning(msg);
  }
});

setType('photo');
