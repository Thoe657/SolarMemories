/* ============================================================
   GALAXY PICKER — solar system rendering, orbit math, new-galaxy
   form, hyperspace transition, edit-galaxy panel
============================================================ */
import { createGalaxyRemote, deleteGalaxyRemote, loadTrashedMemories, restoreMemory, deleteMemoryForever } from './api.js';
import { showStorageWarning } from './util.js';
import { clearGalleryScene, loadGalaxyMemories, showLoadingPlaceholders } from './scene.js';
import { currentGalaxy, galaxiesCache, setCurrentGalaxy, setGalaxiesCache } from './state.js';

/* ============================================================
   GALAXY PICKER — twinkling background stars
============================================================ */
(function setupPickerStars() {
  const starsContainer = document.getElementById('startStars');
  const starCount = 120;
  for (let i = 0; i < starCount; i++) {
    const star = document.createElement('span');
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    const size = Math.random() < 0.85 ? 1 + Math.random() * 1.5 : 2.5 + Math.random() * 1.5;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.animationDelay = `${Math.random() * 3}s`;
    star.style.animationDuration = `${2.5 + Math.random() * 2.5}s`;
    starsContainer.appendChild(star);
  }
})();

/* ============================================================
   HYPERSPACE TRANSITION
   -----------------------------------------------------------
   A full-screen canvas overlay drawing streaking starlines that
   radiate outward from the center, accelerating, then fading —
   used when entering or leaving a galaxy.
============================================================ */
const hyperspaceCanvas = document.getElementById('hyperspaceCanvas');
const hyCtx = hyperspaceCanvas.getContext('2d');

function resizeHyperspaceCanvas() {
  hyperspaceCanvas.width = window.innerWidth;
  hyperspaceCanvas.height = window.innerHeight;
}
resizeHyperspaceCanvas();
window.addEventListener('resize', resizeHyperspaceCanvas);

// Plays the hyperspace effect. Calls onMid halfway through (the moment of
// maximum streak/whiteout — good time to swap scene content underneath),
// and resolves once the effect has fully faded out.
function playHyperspace(onMid) {
  return new Promise((resolve) => {
    const DURATION = 1100; // ms
    const STAR_COUNT = 220;
    const cx = hyperspaceCanvas.width / 2;
    const cy = hyperspaceCanvas.height / 2;
    const maxR = Math.hypot(cx, cy);

    const starsData = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      starsData.push({
        angle: Math.random() * Math.PI * 2,
        start: Math.random() * 0.5, // normalized starting distance from center
        speed: 0.6 + Math.random() * 1.2,
        width: Math.random() < 0.85 ? 1 + Math.random() * 1.5 : 2 + Math.random() * 2
      });
    }

    hyperspaceCanvas.classList.add('active');
    let midFired = false;
    const startTime = performance.now();

    function frame(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / DURATION, 1);

      // overall intensity: ramps up to a whiteout peak, then fades
      const intensity = t < 0.5
        ? t / 0.5            // 0 -> 1
        : 1 - (t - 0.5) / 0.5; // 1 -> 0

      hyCtx.fillStyle = `rgba(0, 0, 0, ${0.35 + 0.25 * (1 - intensity)})`;
      hyCtx.fillRect(0, 0, hyperspaceCanvas.width, hyperspaceCanvas.height);

      const travel = t; // 0 -> 1 progress for streak length/position
      starsData.forEach((s) => {
        const dist = (s.start + travel * s.speed) * maxR;
        const prevDist = Math.max(0, dist - (8 + travel * 60) * s.speed);
        const x1 = cx + Math.cos(s.angle) * prevDist;
        const y1 = cy + Math.sin(s.angle) * prevDist;
        const x2 = cx + Math.cos(s.angle) * dist;
        const y2 = cy + Math.sin(s.angle) * dist;

        hyCtx.strokeStyle = `rgba(255, 245, 225, ${0.25 + 0.65 * intensity})`;
        hyCtx.lineWidth = s.width * (0.5 + intensity);
        hyCtx.beginPath();
        hyCtx.moveTo(x1, y1);
        hyCtx.lineTo(x2, y2);
        hyCtx.stroke();
      });

      // whiteout flash at the peak
      if (intensity > 0.7) {
        const flash = (intensity - 0.7) / 0.3;
        hyCtx.fillStyle = `rgba(255, 250, 240, ${flash * 0.5})`;
        hyCtx.fillRect(0, 0, hyperspaceCanvas.width, hyperspaceCanvas.height);
      }

      if (!midFired && t >= 0.5) {
        midFired = true;
        if (onMid) onMid();
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        hyCtx.clearRect(0, 0, hyperspaceCanvas.width, hyperspaceCanvas.height);
        hyperspaceCanvas.classList.remove('active');
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

/* ============================================================
   GALAXY PICKER UI — solar system
============================================================ */
const galaxyPicker = document.getElementById('galaxyPicker');
const orbitsContainer = document.getElementById('orbits');
const newGalaxyForm = document.getElementById('newGalaxyForm');
const newGalaxyName = document.getElementById('newGalaxyName');
const colorRow = document.getElementById('colorRow');
const cancelGalaxyBtn = document.getElementById('cancelGalaxyBtn');
const createGalaxyBtn = document.getElementById('createGalaxyBtn');
const galaxyTitleEl = document.getElementById('galaxyTitle');
const backToGalaxiesBtn = document.getElementById('backToGalaxiesBtn');
const topbar = document.getElementById('topbar');

const ringRow = document.getElementById('ringRow');

let selectedColor = '#ffd9a0';
let selectedRing = 1;

colorRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  [...colorRow.children].forEach(d => d.classList.toggle('active', d === dot));
  selectedColor = dot.dataset.color;
});

ringRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.ring-dot');
  if (!dot) return;
  [...ringRow.children].forEach(d => d.classList.toggle('active', d === dot));
  selectedRing = parseInt(dot.dataset.ring, 10);
});

function openNewGalaxyForm() {
  newGalaxyForm.classList.remove('hidden');
  newGalaxyName.focus();
}

cancelGalaxyBtn.addEventListener('click', () => {
  newGalaxyForm.classList.add('hidden');
  newGalaxyName.value = '';
  createGalaxyBtn.disabled = true;
});

newGalaxyName.addEventListener('input', () => {
  createGalaxyBtn.disabled = newGalaxyName.value.trim().length === 0;
});

createGalaxyBtn.addEventListener('click', async () => {
  const name = newGalaxyName.value.trim();
  if (!name) return;
  const galaxy = {
    id: `gal-${Date.now()}`,
    name,
    accentColor: selectedColor,
    ring: selectedRing
  };
  createGalaxyBtn.disabled = true;
  try {
    await createGalaxyRemote(galaxy);
    galaxiesCache.push(galaxy);
    renderSolarSystem();
    newGalaxyForm.classList.add('hidden');
    newGalaxyName.value = '';
    createGalaxyBtn.disabled = true;
  } catch (e) {
    console.warn('Could not create galaxy', e);
    showStorageWarning('couldn\'t create that galaxy — check the gallery server and try again.');
    createGalaxyBtn.disabled = false;
  }
});

// Four fixed orbital radii (px), always drawn, centered on the sun.
// Ring index 0 is reserved for the "+ new galaxy" planet. Galaxies
// choose from rings 1-3 (displayed as options "1", "2", "3" — the ring
// just outside the new-galaxy ring, and so on outward).
const RING_RADII = [90, 165, 240, 320];
const PLANET_SIZES = [38, 32, 36, 30, 40, 34, 32, 38]; // px, cycling per planet
const NEW_GALAXY_RING = 0;

export function renderSolarSystem() {
  orbitsContainer.innerHTML = '';

  // always draw all ring guides, regardless of whether anything
  // currently orbits them
  RING_RADII.forEach((radius) => {
    const ring = document.createElement('div');
    ring.className = 'orbit-ring';
    ring.style.width = `${radius * 2}px`;
    ring.style.height = `${radius * 2}px`;
    orbitsContainer.appendChild(ring);
  });

  // group galaxies by their assigned ring (default ring index 1, the
  // innermost selectable ring) so multiple galaxies on the same ring
  // spread out evenly around it
  const ringGroups = new Map();
  galaxiesCache.forEach((g) => {
    const ring = Number.isInteger(g.ring) && g.ring >= 1 && g.ring < RING_RADII.length ? g.ring : 1;
    if (!ringGroups.has(ring)) ringGroups.set(ring, []);
    ringGroups.get(ring).push(g);
  });

  let sizeIndex = 0;
  ringGroups.forEach((galaxiesOnRing, ring) => {
    const radius = RING_RADII[ring];
    const duration = 26 + ring * 16;
    const direction = ring % 2 === 0 ? 'normal' : 'reverse';
    const count = galaxiesOnRing.length;

    galaxiesOnRing.forEach((g, idx) => {
      const startAngle = (idx / count) * 360 + ring * 23; // spread + per-ring offset
      addPlanet(g, radius, duration, direction, startAngle, PLANET_SIZES[sizeIndex % PLANET_SIZES.length]);
      sizeIndex++;
    });
  });

  // "+ new galaxy" planet always orbits the innermost ring
  addPlanet({ __isNew: true }, RING_RADII[NEW_GALAXY_RING], 26 + NEW_GALAXY_RING * 16, 'normal', 180, 34);
}

function addPlanet(g, radius, duration, direction, startAngle, size) {
  // rotating container
  const spin = document.createElement('div');
  spin.className = 'orbit-spin';
  spin.style.animationDuration = `${duration}s`;
  spin.style.animationDirection = direction;
  // negative delay offsets the starting angle without fighting the
  // animation's own transform
  const delay = `${-(startAngle / 360) * duration}s`;
  spin.style.animationDelay = delay;

  // static radius offset (not animated)
  const offset = document.createElement('div');
  offset.className = 'orbit-offset';
  offset.style.transform = `translateX(${radius}px)`;

  // counter-rotating planet, keeps its label upright
  const planet = document.createElement('div');
  planet.className = 'planet';
  planet.style.animationDuration = `${duration}s`;
  planet.style.animationDirection = direction;
  planet.style.animationDelay = delay;

  const body = document.createElement('div');
  body.className = 'planet-body';
  body.style.width = `${size}px`;
  body.style.height = `${size}px`;
  body.style.position = 'absolute';
  body.style.left = '50%';
  body.style.top = '50%';
  body.style.transform = 'translate(-50%, -50%)';

  const label = document.createElement('span');
  label.className = 'planet-label';

  if (g.__isNew) {
    planet.classList.add('new-galaxy-planet');
    body.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
    body.style.display = 'flex';
    body.style.alignItems = 'center';
    body.style.justifyContent = 'center';
    label.textContent = 'new galaxy';

    planet.appendChild(body);
    planet.appendChild(label);
    planet.addEventListener('click', () => openNewGalaxyForm());
  } else {
    const color = g.accentColor || '#ffd9a0';
    body.style.background = `radial-gradient(circle at 35% 35%, #fff, ${color} 55%, ${color} 100%)`;
    body.style.boxShadow = `0 0 18px 6px ${color}66, 0 0 36px 14px ${color}33`;
    label.textContent = g.name;

    planet.appendChild(body);
    planet.appendChild(label);
    planet.addEventListener('click', () => selectGalaxy(g));
  }

  offset.appendChild(planet);
  spin.appendChild(offset);
  orbitsContainer.appendChild(spin);
}

// Enter a galaxy: hyperspace transition, then swap content underneath.
async function selectGalaxy(galaxy) {
  setCurrentGalaxy(galaxy);

  await playHyperspace(() => {
    // mid-transition: swap content while the screen is at peak whiteout
    galaxyTitleEl.textContent = `${galaxy.name.toLowerCase()}'s memories`;
    galaxyPicker.classList.add('fading');
    topbar.style.display = '';
    clearGalleryScene();
    showLoadingPlaceholders();
  });

  galaxyPicker.classList.add('hidden');
  await loadGalaxyMemories(galaxy.id);
}

// Return to the galaxy picker.
async function showGalaxyPicker() {
  await playHyperspace(() => {
    clearGalleryScene();
    topbar.style.display = 'none';
    galaxyPicker.classList.remove('hidden');
    galaxyPicker.classList.remove('fading');
    setCurrentGalaxy(null);
  });
  renderSolarSystem();
}

backToGalaxiesBtn.addEventListener('click', () => {
  showGalaxyPicker();
});

/* ============================================================
   EDIT GALAXY PANEL
============================================================ */
const editGalaxyOverlay = document.getElementById('editGalaxyOverlay');
const editGalaxyBtn = document.getElementById('editGalaxyBtn');
const editGalaxyName = document.getElementById('editGalaxyName');
const editColorRow = document.getElementById('editColorRow');
const editRingRow = document.getElementById('editRingRow');
const cancelEditGalaxyBtn = document.getElementById('cancelEditGalaxyBtn');
const saveEditGalaxyBtn = document.getElementById('saveEditGalaxyBtn');
const deleteGalaxyBtn = document.getElementById('deleteGalaxyBtn');
const deleteGalaxyConfirmRow = document.getElementById('deleteGalaxyConfirmRow');
const cancelDeleteGalaxyBtn = document.getElementById('cancelDeleteGalaxyBtn');
const confirmDeleteGalaxyBtn = document.getElementById('confirmDeleteGalaxyBtn');
const trashList = document.getElementById('trashList');

let editSelectedColor = '#ffd9a0';
let editSelectedRing = 1;

// Loads and renders the currently-open galaxy's trashed memories, with
// "restore" / "delete forever" actions on each.
async function renderTrash() {
  if (!currentGalaxy) return;
  trashList.innerHTML = '<div class="trash-empty">loading…</div>';
  try {
    const trashed = await loadTrashedMemories(currentGalaxy.id);
    if (trashed.length === 0) {
      trashList.innerHTML = '<div class="trash-empty">nothing in the trash</div>';
      return;
    }
    trashList.innerHTML = '';
    trashed.forEach((m) => {
      const row = document.createElement('div');
      row.className = 'trash-item';

      const title = document.createElement('span');
      title.className = 'trash-item-title';
      title.textContent = m.title || 'untitled memory';

      const actions = document.createElement('div');
      actions.className = 'trash-item-actions';

      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'trash-restore-btn';
      restoreBtn.textContent = 'restore';
      restoreBtn.addEventListener('click', async () => {
        restoreBtn.disabled = true;
        try {
          await restoreMemory(m.id);
          await renderTrash();
        } catch (e) {
          console.warn('Could not restore memory', e);
          showStorageWarning('couldn\'t restore that memory — check the gallery server and try again.');
          restoreBtn.disabled = false;
        }
      });

      const foreverBtn = document.createElement('button');
      foreverBtn.className = 'trash-forever-btn';
      foreverBtn.textContent = 'delete forever';
      foreverBtn.addEventListener('click', async () => {
        foreverBtn.disabled = true;
        try {
          await deleteMemoryForever(m.id);
          await renderTrash();
        } catch (e) {
          console.warn('Could not permanently delete memory', e);
          showStorageWarning('couldn\'t delete that memory — check the gallery server and try again.');
          foreverBtn.disabled = false;
        }
      });

      actions.appendChild(restoreBtn);
      actions.appendChild(foreverBtn);
      row.appendChild(title);
      row.appendChild(actions);
      trashList.appendChild(row);
    });
  } catch (e) {
    console.warn('Could not load trash', e);
    trashList.innerHTML = '<div class="trash-empty">couldn\'t load trash</div>';
  }
}

editGalaxyBtn.addEventListener('click', () => {
  if (!currentGalaxy) return;
  editGalaxyName.value = currentGalaxy.name || '';
  editSelectedColor = currentGalaxy.accentColor || '#ffd9a0';
  editSelectedRing = (Number.isInteger(currentGalaxy.ring) && currentGalaxy.ring >= 1 && currentGalaxy.ring <= 3) ? currentGalaxy.ring : 1;

  [...editColorRow.children].forEach(d => d.classList.toggle('active', d.dataset.color === editSelectedColor));
  [...editRingRow.children].forEach(d => d.classList.toggle('active', parseInt(d.dataset.ring, 10) === editSelectedRing));
  deleteGalaxyBtn.style.display = '';
  deleteGalaxyConfirmRow.style.display = 'none';
  confirmDeleteGalaxyBtn.disabled = false;
  cancelDeleteGalaxyBtn.disabled = false;
  editGalaxyOverlay.classList.add('visible');
  renderTrash();
});

editColorRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (!dot) return;
  [...editColorRow.children].forEach(d => d.classList.toggle('active', d === dot));
  editSelectedColor = dot.dataset.color;
});

editRingRow.addEventListener('click', (e) => {
  const dot = e.target.closest('.ring-dot');
  if (!dot) return;
  [...editRingRow.children].forEach(d => d.classList.toggle('active', d === dot));
  editSelectedRing = parseInt(dot.dataset.ring, 10);
});

function closeEditGalaxy() {
  editGalaxyOverlay.classList.remove('visible');
}

cancelEditGalaxyBtn.addEventListener('click', closeEditGalaxy);
editGalaxyOverlay.addEventListener('click', (e) => {
  if (e.target === editGalaxyOverlay) closeEditGalaxy();
});

saveEditGalaxyBtn.addEventListener('click', async () => {
  const name = editGalaxyName.value.trim();
  if (!name || !currentGalaxy) return;

  const updated = {
    id: currentGalaxy.id,
    name,
    accentColor: editSelectedColor,
    ring: editSelectedRing
  };
  saveEditGalaxyBtn.disabled = true;
  try {
    await createGalaxyRemote(updated); // upserts by id
    setCurrentGalaxy(updated);
    setGalaxiesCache(galaxiesCache.map(g => g.id === updated.id ? updated : g));
    galaxyTitleEl.textContent = `${name.toLowerCase()}'s memories`;
    closeEditGalaxy();
  } catch (e) {
    console.warn('Could not update galaxy', e);
    showStorageWarning('couldn\'t save those changes — check the gallery server and try again.');
  } finally {
    saveEditGalaxyBtn.disabled = false;
  }
});

deleteGalaxyBtn.addEventListener('click', () => {
  deleteGalaxyBtn.style.display = 'none';
  deleteGalaxyConfirmRow.style.display = 'flex';
});

cancelDeleteGalaxyBtn.addEventListener('click', () => {
  deleteGalaxyConfirmRow.style.display = 'none';
  deleteGalaxyBtn.style.display = '';
});

confirmDeleteGalaxyBtn.addEventListener('click', async () => {
  if (!currentGalaxy) return;
  confirmDeleteGalaxyBtn.disabled = true;
  cancelDeleteGalaxyBtn.disabled = true;
  try {
    await deleteGalaxyRemote(currentGalaxy.id);
    setGalaxiesCache(galaxiesCache.filter(g => g.id !== currentGalaxy.id));
    closeEditGalaxy();
    await showGalaxyPicker();
    confirmDeleteGalaxyBtn.disabled = false;
    cancelDeleteGalaxyBtn.disabled = false;

    deleteGalaxyConfirmRow.style.display = 'none';
    deleteGalaxyBtn.style.display = '';
  } catch (e) {
    console.warn('Could not delete galaxy', e);
    showStorageWarning('couldn\'t delete that galaxy — check the gallery server and try again.');
    confirmDeleteGalaxyBtn.disabled = false;
    cancelDeleteGalaxyBtn.disabled = false;
  }
});
