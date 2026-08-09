/* ============================================================
   PLANET PICKER — solar system rendering, orbit math, new-planet
   form, hyperspace transition, edit-planet panel
============================================================ */
import { createPlanetRemote, deletePlanetRemote, loadTrashedMemories, restoreMemory, deleteMemoryForever } from './api.js';
import { showStorageWarning } from './util.js';
import { clearGalleryScene, loadPlanetMemories, showLoadingPlaceholders, setOnPortalClick, showMoon } from './scene.js';
import { currentPlanet, planetsCache, setCurrentPlanet, setPlanetsCache } from './state.js';
import { prefersReducedMotion } from './motionPreference.js';

/* ============================================================
   PLANET PICKER — twinkling background stars
============================================================ */
(function setupPickerStars() {
  const starsContainer = document.getElementById('startStars');

  // Depth layers: more/smaller/slower-drifting stars toward the back, fewer/
  // larger/more-parallaxed ones up front.
  const layers = [
    { count: 60, size: [1, 1.8], duration: [2.5, 5], parallax: 6 },
    { count: 40, size: [1.5, 2.5], duration: [2.2, 4.2], parallax: 14 },
    { count: 20, size: [2, 3.5], duration: [2, 3.5], parallax: 26 },
  ];

  const layerEls = layers.map((layer) => {
    const layerEl = document.createElement('div');
    layerEl.className = 'star-layer';
    for (let i = 0; i < layer.count; i++) {
      const star = document.createElement('span');
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      const size = layer.size[0] + Math.random() * (layer.size[1] - layer.size[0]);
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.animationDelay = `${Math.random() * 3}s`;
      star.style.animationDuration = `${layer.duration[0] + Math.random() * (layer.duration[1] - layer.duration[0])}s`;
      layerEl.appendChild(star);
    }
    starsContainer.appendChild(layerEl);
    return { el: layerEl, parallax: layer.parallax };
  });

  // Subtle parallax tied to pointer position -- each layer drifts opposite
  // the pointer by its own amount, and the CSS transition on .star-layer
  // smooths/lags the movement instead of tracking it 1:1.
  window.addEventListener('pointermove', (e) => {
    const nx = e.clientX / window.innerWidth - 0.5;
    const ny = e.clientY / window.innerHeight - 0.5;
    layerEls.forEach(({ el, parallax }) => {
      el.style.transform = `translate(${-nx * parallax}px, ${-ny * parallax}px)`;
    });
  });

  // Occasional shooting stars, every 8-15s (randomized so there's no
  // noticeable fixed rhythm), each removing itself once its animation ends.
  function spawnShootingStar() {
    const el = document.createElement('div');
    el.className = 'shooting-star';
    const startX = Math.random() * 70;
    const startY = Math.random() * 40;
    const angle = 25 + Math.random() * 20;
    const distance = 220 + Math.random() * 160;
    const duration = 900 + Math.random() * 500;
    el.style.left = `${startX}%`;
    el.style.top = `${startY}%`;
    el.style.setProperty('--angle', `${angle}deg`);
    el.style.setProperty('--distance', `${distance}px`);
    el.style.animationDuration = `${duration}ms`;
    starsContainer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function scheduleShootingStar() {
    const delay = 8000 + Math.random() * 7000;
    setTimeout(() => {
      spawnShootingStar();
      scheduleShootingStar();
    }, delay);
  }
  scheduleShootingStar();
})();

/* ============================================================
   HYPERSPACE TRANSITION
   -----------------------------------------------------------
   A full-screen canvas overlay drawing streaking starlines that
   radiate outward from the center, accelerating, then fading —
   used when entering or leaving a planet.
============================================================ */
const hyperspaceCanvas = document.getElementById('hyperspaceCanvas');
const hyCtx = hyperspaceCanvas.getContext('2d');

function resizeHyperspaceCanvas() {
  hyperspaceCanvas.width = window.innerWidth;
  hyperspaceCanvas.height = window.innerHeight;
}
resizeHyperspaceCanvas();
window.addEventListener('resize', resizeHyperspaceCanvas);

/* Two intensities of the same effect. `planet` is the original, unchanged:
   crossing between planets. `moon` is the escalation used for hopping
   between moons *within* one planet — longer, denser, and drawn in the
   warm/rose/violet range instead of a single warm white, so the two trips
   don't feel interchangeable. */
const HYPERSPACE_PRESETS = {
  planet: {
    duration: 1100,
    starCount: 220,
    speedScale: 1,
    trailScale: 1,
    colors: ['255, 245, 225'],
    flashColor: '255, 250, 240',
    flashMax: 0.5
  },
  moon: {
    duration: 1750,
    starCount: 420,
    speedScale: 1.35,
    trailScale: 1.5,
    colors: ['255, 245, 225', '255, 217, 160', '242, 166, 176', '184, 166, 242', '166, 232, 242'],
    flashColor: '246, 236, 255',
    flashMax: 0.7
  }
};

// Plays the hyperspace effect at the named intensity. Calls onMid halfway
// through (the moment of maximum streak/whiteout — good time to swap scene
// content underneath), and resolves once the effect has fully faded out.
function playHyperspace(onMid, kind = 'planet') {
  return new Promise((resolve) => {
    // A stated motion preference outranks the drama: fall back to the shorter,
    // sparser trip rather than escalating.
    const preset = HYPERSPACE_PRESETS[prefersReducedMotion() ? 'planet' : kind]
      || HYPERSPACE_PRESETS.planet;
    const DURATION = preset.duration;
    const STAR_COUNT = preset.starCount;
    const cx = hyperspaceCanvas.width / 2;
    const cy = hyperspaceCanvas.height / 2;
    const maxR = Math.hypot(cx, cy);

    const starsData = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      starsData.push({
        angle: Math.random() * Math.PI * 2,
        start: Math.random() * 0.5, // normalized starting distance from center
        speed: (0.6 + Math.random() * 1.2) * preset.speedScale,
        width: Math.random() < 0.85 ? 1 + Math.random() * 1.5 : 2 + Math.random() * 2,
        color: preset.colors[Math.floor(Math.random() * preset.colors.length)]
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
        const prevDist = Math.max(0, dist - (8 + travel * 60) * s.speed * preset.trailScale);
        const x1 = cx + Math.cos(s.angle) * prevDist;
        const y1 = cy + Math.sin(s.angle) * prevDist;
        const x2 = cx + Math.cos(s.angle) * dist;
        const y2 = cy + Math.sin(s.angle) * dist;

        hyCtx.strokeStyle = `rgba(${s.color}, ${0.25 + 0.65 * intensity})`;
        hyCtx.lineWidth = s.width * (0.5 + intensity);
        hyCtx.beginPath();
        hyCtx.moveTo(x1, y1);
        hyCtx.lineTo(x2, y2);
        hyCtx.stroke();
      });

      // whiteout flash at the peak
      if (intensity > 0.7) {
        const flash = (intensity - 0.7) / 0.3;
        hyCtx.fillStyle = `rgba(${preset.flashColor}, ${flash * preset.flashMax})`;
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
   PLANET PICKER UI — solar system
============================================================ */
const planetPicker = document.getElementById('planetPicker');
const orbitsContainer = document.getElementById('orbits');
const newPlanetForm = document.getElementById('newPlanetForm');
const newPlanetName = document.getElementById('newPlanetName');
const colorRow = document.getElementById('colorRow');
const cancelPlanetBtn = document.getElementById('cancelPlanetBtn');
const createPlanetBtn = document.getElementById('createPlanetBtn');
const planetTitleEl = document.getElementById('planetTitle');
const backToPlanetsBtn = document.getElementById('backToPlanetsBtn');
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

function openNewPlanetForm() {
  newPlanetForm.classList.remove('hidden');
  newPlanetName.focus();
}

cancelPlanetBtn.addEventListener('click', () => {
  newPlanetForm.classList.add('hidden');
  newPlanetName.value = '';
  createPlanetBtn.disabled = true;
});

newPlanetName.addEventListener('input', () => {
  createPlanetBtn.disabled = newPlanetName.value.trim().length === 0;
});

createPlanetBtn.addEventListener('click', async () => {
  const name = newPlanetName.value.trim();
  if (!name) return;
  const planet = {
    id: `gal-${Date.now()}`,
    name,
    accentColor: selectedColor,
    ring: selectedRing
  };
  createPlanetBtn.disabled = true;
  try {
    await createPlanetRemote(planet);
    planetsCache.push(planet);
    renderSolarSystem();
    newPlanetForm.classList.add('hidden');
    newPlanetName.value = '';
    createPlanetBtn.disabled = true;
  } catch (e) {
    console.warn('Could not create planet', e);
    showStorageWarning('couldn\'t create that planet — check the gallery server and try again.');
    createPlanetBtn.disabled = false;
  }
});

// Four fixed orbital radii (px), always drawn, centered on the sun.
// Ring index 0 is reserved for the "+ new planet" icon. Planets
// choose from rings 1-3 (displayed as options "1", "2", "3" — the ring
// just outside the new-planet ring, and so on outward).
const RING_RADII = [90, 165, 240, 320];
const PLANET_SIZES = [38, 32, 36, 30, 40, 34, 32, 38]; // px, cycling per planet
const NEW_PLANET_RING = 0;

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

  // group planets by their assigned ring (default ring index 1, the
  // innermost selectable ring) so multiple planets on the same ring
  // spread out evenly around it
  const ringGroups = new Map();
  planetsCache.forEach((g) => {
    const ring = Number.isInteger(g.ring) && g.ring >= 1 && g.ring < RING_RADII.length ? g.ring : 1;
    if (!ringGroups.has(ring)) ringGroups.set(ring, []);
    ringGroups.get(ring).push(g);
  });

  let sizeIndex = 0;
  ringGroups.forEach((planetsOnRing, ring) => {
    const radius = RING_RADII[ring];
    const duration = 26 + ring * 16;
    const direction = ring % 2 === 0 ? 'normal' : 'reverse';
    const count = planetsOnRing.length;

    planetsOnRing.forEach((g, idx) => {
      const startAngle = (idx / count) * 360 + ring * 23; // spread + per-ring offset
      addPlanet(g, radius, duration, direction, startAngle, PLANET_SIZES[sizeIndex % PLANET_SIZES.length]);
      sizeIndex++;
    });
  });

  // "+ new planet" icon always orbits the innermost ring
  addPlanet({ __isNew: true }, RING_RADII[NEW_PLANET_RING], 26 + NEW_PLANET_RING * 16, 'normal', 180, 34);
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

  // counter-rotating planet icon, keeps its label upright
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
    planet.classList.add('new-planet');
    body.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
    body.style.display = 'flex';
    body.style.alignItems = 'center';
    body.style.justifyContent = 'center';
    label.textContent = 'new planet';

    planet.appendChild(body);
    planet.appendChild(label);
    planet.addEventListener('click', () => openNewPlanetForm());
  } else {
    const color = g.accentColor || '#ffd9a0';
    body.style.background = `radial-gradient(circle at 35% 35%, #fff, ${color} 55%, ${color} 100%)`;
    body.style.boxShadow = `0 0 18px 6px ${color}66, 0 0 36px 14px ${color}33`;
    label.textContent = g.name;

    planet.appendChild(body);
    planet.appendChild(label);
    planet.addEventListener('click', () => selectPlanet(g));
  }

  offset.appendChild(planet);
  spin.appendChild(offset);
  orbitsContainer.appendChild(spin);
}

// Enter a planet: hyperspace transition, then swap content underneath.
async function selectPlanet(planet) {
  setCurrentPlanet(planet);

  await playHyperspace(() => {
    // mid-transition: swap content while the screen is at peak whiteout
    planetTitleEl.textContent = `${planet.name.toLowerCase()}'s memories`;
    planetPicker.classList.add('fading');
    topbar.style.display = '';
    clearGalleryScene();
    showLoadingPlaceholders();
  });

  planetPicker.classList.add('hidden');
  await loadPlanetMemories(planet.id);
}

// Travel to another of the open planet's moons — the same "swap the scene
// while the screen is whited out" pattern as entering a planet, one moon's
// stars in place of one planet's memories. The hyperspace canvas doesn't take
// pointer events, so a second portal click during the trip would otherwise
// land on whatever is underneath.
let travelling = false;
setOnPortalClick(async (moonIndex) => {
  if (travelling || moonIndex === null) return;
  travelling = true;
  try {
    await playHyperspace(() => showMoon(moonIndex), 'moon');
  } finally {
    travelling = false;
  }
});

// Return to the planet picker.
async function showPlanetPicker() {
  await playHyperspace(() => {
    clearGalleryScene();
    topbar.style.display = 'none';
    planetPicker.classList.remove('hidden');
    planetPicker.classList.remove('fading');
    setCurrentPlanet(null);
  });
  renderSolarSystem();
}

backToPlanetsBtn.addEventListener('click', () => {
  showPlanetPicker();
});

/* ============================================================
   EDIT PLANET PANEL
============================================================ */
const editPlanetOverlay = document.getElementById('editPlanetOverlay');
const editPlanetBtn = document.getElementById('editPlanetBtn');
const editPlanetName = document.getElementById('editPlanetName');
const editColorRow = document.getElementById('editColorRow');
const editRingRow = document.getElementById('editRingRow');
const cancelEditPlanetBtn = document.getElementById('cancelEditPlanetBtn');
const saveEditPlanetBtn = document.getElementById('saveEditPlanetBtn');
const deletePlanetBtn = document.getElementById('deletePlanetBtn');
const deletePlanetConfirmRow = document.getElementById('deletePlanetConfirmRow');
const cancelDeletePlanetBtn = document.getElementById('cancelDeletePlanetBtn');
const confirmDeletePlanetBtn = document.getElementById('confirmDeletePlanetBtn');
const trashList = document.getElementById('trashList');

let editSelectedColor = '#ffd9a0';
let editSelectedRing = 1;

// Loads and renders the currently-open planet's trashed memories, with
// "restore" / "delete forever" actions on each.
async function renderTrash() {
  if (!currentPlanet) return;
  trashList.innerHTML = '<div class="trash-empty">loading…</div>';
  try {
    const trashed = await loadTrashedMemories(currentPlanet.id);
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

editPlanetBtn.addEventListener('click', () => {
  if (!currentPlanet) return;
  editPlanetName.value = currentPlanet.name || '';
  editSelectedColor = currentPlanet.accentColor || '#ffd9a0';
  editSelectedRing = (Number.isInteger(currentPlanet.ring) && currentPlanet.ring >= 1 && currentPlanet.ring <= 3) ? currentPlanet.ring : 1;

  [...editColorRow.children].forEach(d => d.classList.toggle('active', d.dataset.color === editSelectedColor));
  [...editRingRow.children].forEach(d => d.classList.toggle('active', parseInt(d.dataset.ring, 10) === editSelectedRing));
  deletePlanetBtn.style.display = '';
  deletePlanetConfirmRow.style.display = 'none';
  confirmDeletePlanetBtn.disabled = false;
  cancelDeletePlanetBtn.disabled = false;
  editPlanetOverlay.classList.add('visible');
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

function closeEditPlanet() {
  editPlanetOverlay.classList.remove('visible');
}

cancelEditPlanetBtn.addEventListener('click', closeEditPlanet);
editPlanetOverlay.addEventListener('click', (e) => {
  if (e.target === editPlanetOverlay) closeEditPlanet();
});

saveEditPlanetBtn.addEventListener('click', async () => {
  const name = editPlanetName.value.trim();
  if (!name || !currentPlanet) return;

  const updated = {
    id: currentPlanet.id,
    name,
    accentColor: editSelectedColor,
    ring: editSelectedRing
  };
  saveEditPlanetBtn.disabled = true;
  try {
    await createPlanetRemote(updated); // upserts by id
    setCurrentPlanet(updated);
    setPlanetsCache(planetsCache.map(g => g.id === updated.id ? updated : g));
    planetTitleEl.textContent = `${name.toLowerCase()}'s memories`;
    closeEditPlanet();
  } catch (e) {
    console.warn('Could not update planet', e);
    showStorageWarning('couldn\'t save those changes — check the gallery server and try again.');
  } finally {
    saveEditPlanetBtn.disabled = false;
  }
});

deletePlanetBtn.addEventListener('click', () => {
  deletePlanetBtn.style.display = 'none';
  deletePlanetConfirmRow.style.display = 'flex';
});

cancelDeletePlanetBtn.addEventListener('click', () => {
  deletePlanetConfirmRow.style.display = 'none';
  deletePlanetBtn.style.display = '';
});

confirmDeletePlanetBtn.addEventListener('click', async () => {
  if (!currentPlanet) return;
  confirmDeletePlanetBtn.disabled = true;
  cancelDeletePlanetBtn.disabled = true;
  try {
    await deletePlanetRemote(currentPlanet.id);
    setPlanetsCache(planetsCache.filter(g => g.id !== currentPlanet.id));
    closeEditPlanet();
    await showPlanetPicker();
    confirmDeletePlanetBtn.disabled = false;
    cancelDeletePlanetBtn.disabled = false;

    deletePlanetConfirmRow.style.display = 'none';
    deletePlanetBtn.style.display = '';
  } catch (e) {
    console.warn('Could not delete planet', e);
    showStorageWarning('couldn\'t delete that planet — check the gallery server and try again.');
    confirmDeletePlanetBtn.disabled = false;
    cancelDeletePlanetBtn.disabled = false;
  }
});
