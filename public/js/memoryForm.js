/* ============================================================
   UI: ADD MEMORY FORM — form logic, photo compression
============================================================ */
import { addMemoryToScene, placeNewStar, updateMemoryInScene } from './scene.js';
import { persistMemory, loadMemory } from './api.js';
import { showStorageWarning, showToast } from './util.js';
import { groupingName } from './theme.js';
import { memories, currentPlanetId, storageMode, updateMemoryInState } from './state.js';

const addOverlay = document.getElementById('addOverlay');
const openAddBtn = document.getElementById('openAddBtn');
const cancelAddBtn = document.getElementById('cancelAddBtn');
const saveMemBtn = document.getElementById('saveMemBtn');
const typeRow = document.getElementById('typeRow');
const memTitle = document.getElementById('memTitle');
const memDate = document.getElementById('memDate');
const memMilestone = document.getElementById('memMilestone');
const relatedSearch = document.getElementById('relatedSearch');
const relatedResults = document.getElementById('relatedResults');
const relatedChips = document.getElementById('relatedChips');
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
let pendingRelatedIds = [];
// Set while editing an existing memory (the id being edited); null in
// "add a new memory" mode. Drives both the save handler (upsert by this id
// instead of minting a new one) and the form's pre-fill on open.
let editingMemoryId = null;

const addOverlayHeading = document.querySelector('#addOverlay h2');
const addOverlaySub = document.querySelector('#addOverlay .sub');
const ADD_HEADING = addOverlayHeading.textContent;
const ADD_SUB = addOverlaySub.textContent;
const ADD_SAVE_LABEL = saveMemBtn.textContent;

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

// Re-encode audio down to a low-bitrate opus/webm clip so the gallery
// stays fast and storage stays small, mirroring compressImage above. Falls
// back to the raw file untouched if MediaRecorder/opus isn't supported.
const AUDIO_MIME = 'audio/webm;codecs=opus';
const AUDIO_BITRATE = 40000; // ~40kbps, within the 32-48kbps target

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

function compressAudio(file) {
  const canReencode = typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && MediaRecorder.isTypeSupported(AUDIO_MIME)
    && (window.AudioContext || window.webkitAudioContext);

  if (!canReencode) {
    return readFileAsDataURL(file);
  }

  return new Promise((resolve) => {
    const fallback = () => readFileAsDataURL(file).then(resolve);

    const reader = new FileReader();
    reader.onload = async (e) => {
      let audioCtx;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtx();
        const audioBuffer = await audioCtx.decodeAudioData(e.target.result);

        const dest = audioCtx.createMediaStreamDestination();
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(dest);

        const recorder = new MediaRecorder(dest.stream, {
          mimeType: AUDIO_MIME,
          audioBitsPerSecond: AUDIO_BITRATE
        });
        const chunks = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onstop = () => {
          audioCtx.close();
          if (chunks.length === 0) {
            fallback();
            return;
          }
          const blob = new Blob(chunks, { type: AUDIO_MIME });
          readFileAsDataURL(blob).then(resolve);
        };
        recorder.onerror = () => {
          audioCtx.close();
          fallback();
        };

        recorder.start();
        source.start(0);
        source.onended = () => {
          // small tail so the recorder captures the last chunk
          setTimeout(() => recorder.stop(), 200);
        };
      } catch (err) {
        console.warn('Audio compression failed, using the original file', err);
        if (audioCtx) audioCtx.close();
        fallback();
      }
    };
    reader.onerror = fallback;
    reader.readAsArrayBuffer(file);
  });
}

audioDrop.addEventListener('click', () => audioInput.click());
audioInput.addEventListener('change', () => {
  const file = audioInput.files[0];
  if (!file) return;

  if (storageMode !== 'fs' && file.size > 3 * 1024 * 1024) {
    showStorageWarning('that audio file is fairly large for browser storage — connect a folder for unlimited space, or use a shorter/smaller clip.');
  }

  compressAudio(file).then((dataUrl) => {
    pendingAudioDataUrl = dataUrl;
    audioPreview.src = pendingAudioDataUrl;
    audioPreview.style.display = 'block';
    audioDrop.textContent = file.name;
    audioDrop.classList.add('has-file');
    validateForm();
  });
});

/* ============================================================
   LINKED MEMORIES — "link to another memory..." picker
============================================================ */
function renderRelatedChips() {
  relatedChips.innerHTML = '';
  pendingRelatedIds.forEach((id) => {
    const mem = memories.find((m) => String(m.id) === id);
    if (!mem) return;
    const chip = document.createElement('span');
    chip.className = 'related-chip';

    const label = document.createElement('span');
    label.textContent = mem.title || 'untitled memory';
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      pendingRelatedIds = pendingRelatedIds.filter((x) => x !== id);
      renderRelatedChips();
    });
    chip.appendChild(removeBtn);

    relatedChips.appendChild(chip);
  });
}

function renderRelatedResults(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    relatedResults.style.display = 'none';
    relatedResults.innerHTML = '';
    return;
  }
  const matches = memories
    .filter((m) => (m.title || '').toLowerCase().includes(q) && !pendingRelatedIds.includes(String(m.id)))
    .slice(0, 6);

  if (matches.length === 0) {
    relatedResults.style.display = 'none';
    relatedResults.innerHTML = '';
    return;
  }

  relatedResults.innerHTML = '';
  matches.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'related-result-item';
    item.textContent = m.title || 'untitled memory';
    item.addEventListener('click', () => {
      pendingRelatedIds.push(String(m.id));
      renderRelatedChips();
      relatedSearch.value = '';
      relatedResults.style.display = 'none';
      relatedResults.innerHTML = '';
    });
    relatedResults.appendChild(item);
  });
  relatedResults.style.display = 'block';
}

relatedSearch.addEventListener('input', () => renderRelatedResults(relatedSearch.value));

function validateForm() {
  let ok = memTitle.value.trim().length > 0;
  if (currentType === 'photo') ok = ok && !!pendingPhotoDataUrl;
  if (currentType === 'audio') ok = ok && !!pendingAudioDataUrl;
  if (currentType === 'letter') ok = ok && memText.value.trim().length > 0;
  saveMemBtn.disabled = !ok;
}

memTitle.addEventListener('input', validateForm);
memText.addEventListener('input', validateForm);

function decodeDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/* Pulls a memory's media back before its edit form is filled in, and refuses
   the edit if it can't.

   Why this is the most dangerous few lines in the file. Since Plan 3 Phase 5
   the records in `memories` arrive slim: hasPhoto/hasAudio instead of the
   base64 itself. The save handler below sends whatever is in the pending*
   fields as the memory's *whole* new content, and the server upserts by id —
   so pre-filling them from a slim record would post photoData: null over a
   real photo and audioData: null over a real recording. These files are
   irreplaceable and there is no undo for an edit. Hence: fetch first, verify
   the media actually came back, and on any doubt don't open the form at all.
   Refusing to edit is an inconvenience; the alternative is a memory quietly
   losing the thing it was made of.

   Usually a no-op: the card was just open, and cardFlip.js's own fetch has
   already put the bytes on this same object. Returns true if it is safe to
   proceed. */
async function ensureFullRecordForEdit(memory) {
  const needsPhoto = !!memory.hasPhoto && !memory.photoData;
  const needsAudio = !!memory.hasAudio && !memory.audioData;
  if (!needsPhoto && !needsAudio) return true;
  try {
    const full = await loadMemory(memory.id);
    // A record that came back without the media it says it has is not a
    // memory with no photo — it's a load that went wrong in a way that would
    // look exactly like a deliberate deletion once saved.
    if ((needsPhoto && !full.photoData) || (needsAudio && !full.audioData)) {
      throw new Error('came back without its photo/audio');
    }
    memory.photoData = full.photoData || memory.photoData || null;
    memory.audioData = full.audioData || memory.audioData || null;
    return true;
  } catch (e) {
    console.warn('Could not load that memory for editing', e);
    showStorageWarning(`couldn't open that memory for editing (${e.message || 'connection error'}) — nothing has been changed. Check that the gallery server is running, then try again.`);
    return false;
  }
}

// Optional `memory` arg switches the form into edit mode: pre-fills every
// field from the passed memory (instead of the blank/reset state) and the
// save handler below reuses its id rather than minting a new one.
async function openAddForm(memory) {
  if (memory) {
    if (!await ensureFullRecordForEdit(memory)) return;
    // The decoded image, not just the bytes: it is what the card texture is
    // drawn from, and saving with it null would redraw this star as a
    // photoless placeholder. The ring usually has it already; decoding it here
    // covers an edit made before the card's lazy photo fetch finished.
    const photoImg = memory.photoImg
      || (memory.photoData ? await decodeDataUrl(memory.photoData) : null);

    // Everything below this line is synchronous on purpose: every await this
    // function does is above it, so the form can't be half-filled with one
    // memory's content while a click on "add a memory" resets it out from
    // under this one.
    editingMemoryId = memory.id;
    memTitle.value = memory.title || '';
    memDate.value = memory.date || '';
    memText.value = memory.text || '';
    memMilestone.checked = !!memory.milestone;
    pendingPhotoDataUrl = memory.photoData || null;
    pendingPhotoImg = photoImg;
    pendingAudioDataUrl = memory.audioData || null;
    pendingRelatedIds = (memory.relatedIds || []).map(String);
    relatedSearch.value = '';
    relatedResults.style.display = 'none';
    relatedResults.innerHTML = '';
    renderRelatedChips();

    photoPreview.src = pendingPhotoDataUrl || '';
    photoPreview.style.display = pendingPhotoDataUrl ? 'block' : 'none';
    photoDrop.textContent = pendingPhotoDataUrl ? 'photo attached — click to replace' : 'click to choose a photo';
    photoDrop.classList.toggle('has-file', !!pendingPhotoDataUrl);

    audioPreview.src = pendingAudioDataUrl || '';
    audioPreview.style.display = pendingAudioDataUrl ? 'block' : 'none';
    audioDrop.textContent = pendingAudioDataUrl ? 'audio attached — click to replace' : 'click to choose an audio file';
    audioDrop.classList.toggle('has-file', !!pendingAudioDataUrl);

    setType(memory.type || 'photo');
    addOverlayHeading.textContent = 'edit memory';
    addOverlaySub.textContent = 'what would you like to change?';
    saveMemBtn.textContent = 'save changes';
    validateForm();
  } else {
    resetForm();
  }
  addOverlay.classList.add('visible');
}
function closeAddForm() {
  addOverlay.classList.remove('visible');
  resetForm();
}
function resetForm() {
  editingMemoryId = null;
  memTitle.value = '';
  memText.value = '';
  memDate.value = '';
  memMilestone.checked = false;
  pendingPhotoDataUrl = null;
  pendingPhotoImg = null;
  pendingAudioDataUrl = null;
  pendingRelatedIds = [];
  relatedSearch.value = '';
  relatedResults.style.display = 'none';
  relatedResults.innerHTML = '';
  renderRelatedChips();
  photoPreview.style.display = 'none';
  photoPreview.src = '';
  photoDrop.textContent = 'click to choose a photo';
  photoDrop.classList.remove('has-file');
  audioPreview.style.display = 'none';
  audioPreview.src = '';
  audioDrop.textContent = 'click to choose an audio file';
  audioDrop.classList.remove('has-file');
  addOverlayHeading.textContent = ADD_HEADING;
  addOverlaySub.textContent = ADD_SUB;
  saveMemBtn.textContent = ADD_SAVE_LABEL;
  setType('photo');
}

openAddBtn.addEventListener('click', () => openAddForm());
cancelAddBtn.addEventListener('click', closeAddForm);
addOverlay.addEventListener('click', (e) => {
  if (e.target === addOverlay) closeAddForm();
});

saveMemBtn.addEventListener('click', async () => {
  if (editingMemoryId != null) {
    /* The same hazard ensureFullRecordForEdit() guards on the way in, checked
       once more on the way out — because this is the request that actually
       overwrites the file. A record that says it has a photo, about to be
       saved without one, means the pre-fill lost it somewhere between there
       and here; there is no path through this form that legitimately empties
       an attachment (replacing one always leaves the new bytes behind), so
       this can only ever fire on a bug, and the right thing to do with a bug
       here is nothing at all. */
    const original = memories.find((m) => String(m.id) === String(editingMemoryId));
    if (original && ((original.hasPhoto && !pendingPhotoDataUrl) || (original.hasAudio && !pendingAudioDataUrl))) {
      console.error('Refusing to save an edit that would drop this memory\'s photo/audio', editingMemoryId);
      showStorageWarning('something went wrong loading this memory\'s photo/audio, so your changes weren\'t saved — the memory itself is untouched. Reload and try again.');
      closeAddForm();
      return;
    }

    const memory = {
      id: editingMemoryId,
      type: currentType,
      title: memTitle.value.trim(),
      date: memDate.value,
      text: memText.value.trim(),
      photoData: pendingPhotoDataUrl,
      photoImg: pendingPhotoImg,
      audioData: pendingAudioDataUrl,
      milestone: memMilestone.checked,
      relatedIds: pendingRelatedIds.slice()
    };
    closeAddForm();
    // POST /api/memories upserts by id and preserves createdAt/moonId for an
    // id that already exists (src/routes/memories.js), so this reuses the
    // exact same save path as a new memory -- no separate edit endpoint.
    try {
      await persistMemory(memory, currentPlanetId);
      const updated = updateMemoryInState(memory);
      if (updated) updateMemoryInScene(updated);
    } catch (e) {
      console.warn('Could not save memory edit', e);
      // Unlike a new memory, don't show the edit optimistically here: the
      // ring already shows the last-saved version, which is a safer thing
      // to leave visible than an edit that may not have persisted.
      const msg = storageMode === 'remote'
        ? `couldn't save your changes to the gallery server (${e.message || 'connection error'}) — try again.`
        : 'couldn\'t save your changes — try connecting a folder for more reliable storage.';
      showStorageWarning(msg);
    }
    return;
  }

  const memory = {
    id: Date.now(),
    type: currentType,
    title: memTitle.value.trim(),
    date: memDate.value,
    text: memText.value.trim(),
    photoData: pendingPhotoDataUrl,
    photoImg: pendingPhotoImg,
    audioData: pendingAudioDataUrl,
    milestone: memMilestone.checked,
    relatedIds: pendingRelatedIds.slice()
  };
  memories.push(memory);
  closeAddForm();
  // Which moon a new star lands on is the server's decision (the newest
  // moon, or a fresh one past the star cap), so drawing it into the ring
  // waits on that answer — otherwise it can appear on a moon it doesn't
  // belong to and jump elsewhere on the next reload.
  try {
    const saved = await persistMemory(memory, currentPlanetId);
    memory.moonId = saved?.moonId || null;
    const landedOn = await placeNewStar(memory);
    if (landedOn && !memory.mesh) {
      /* The grouping's *displayed* name, not its stored one (Plan 4 Phase 2's
         one leftover, deferred to Phase 5 rather than taking a sixth file).
         Universe derives a nebula name from the moon's index, so the raw
         record here would have sent someone looking for "Puck" while the
         portal they were being pointed at, and the topbar above it, both said
         "Eagle". Solar's groupingName() hands back landedOn.name untouched. */
      const where = groupingName(landedOn.index, landedOn.name);
      showToast(`saved onto ${where} — travel there through the portal ✦`);
    }
  } catch (e) {
    console.warn('Could not save memory', e);
    // Still show it: unsaved is bad enough without it also vanishing.
    addMemoryToScene(memory);
    const msg = storageMode === 'remote'
      ? `couldn't save to the gallery server (${e.message || 'connection error'}) — it's shown here but may not persist.`
      : 'couldn\'t save that memory — try connecting a folder for more reliable storage.';
    showStorageWarning(msg);
  }
});

setType('photo');

export { openAddForm };
