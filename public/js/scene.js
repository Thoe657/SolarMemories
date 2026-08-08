/* ============================================================
   THREE.JS SETUP — renderer/camera/lights/background/animate loop
   (relies on the global THREE from the CDN <script> tag)
============================================================ */
import { makePolaroidTexture, makePortalTexture, roundRect } from './cards.js';
import { loadAllMemories, loadPlanets } from './api.js';
import { showStorageWarning } from './util.js';
import {
  memories,
  currentGalaxy,
  currentGalaxyId,
  currentPlanets,
  currentPlanetIndex,
  setCurrentPlanets,
  setCurrentPlanetIndex
} from './state.js';
import { shouldDampenMotion, prefersReducedMotion, playUiSound } from './audioManager.js';

const container = document.getElementById('scene-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.2, 9);

/* ============================================================
   ADAPTIVE QUALITY — starts at full quality and, once the animate
   loop is running, measures the first ~60 frames' average frame time
   to decide whether this device can sustain it. If not, pixel ratio,
   the distant star count, and the target FPS step down at runtime
   (see applyLowQuality() near the animate loop below).
   OS-level prefers-reduced-motion is a stated accessibility
   preference, not a capability signal — it short-circuits straight
   to the low-quality path immediately, skipping the benchmark.
============================================================ */
let lowQuality = prefersReducedMotion();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQuality ? 1 : 2));
container.appendChild(renderer.domElement);

// Soft ambient + warm point lights to sell the "fairy light" mood
scene.add(new THREE.AmbientLight(0x554466, 1.1));

const hemi = new THREE.HemisphereLight(0x6f5a8a, 0x2a1830, 0.6);
scene.add(hemi);

/* ----- Background: full starry night sky (equirectangular gradient + nebula glow) -----
   Phase 14: baked offline by scripts/build-backgrounds.js (see that file for the
   original procedural drawing routine this replaced) into a few PNG variants under
   public/assets/backgrounds/, loaded here instead of running the same canvas-drawing
   work in every browser on every page load. One is picked at random per session for
   some variety; the smaller dynamic star/fairy-light layers on top (below) still keep
   the sky feeling alive. ----- */
const BG_VARIANTS = ['nebula-1', 'nebula-2', 'nebula-3'];
const bgVariant = BG_VARIANTS[Math.floor(Math.random() * BG_VARIANTS.length)];

const bgGeo = new THREE.SphereGeometry(60, 64, 64);
const bgTex = new THREE.TextureLoader().load(`assets/backgrounds/${bgVariant}.png`);
bgTex.colorSpace = THREE.SRGBColorSpace;
bgTex.minFilter = THREE.LinearMipmapLinearFilter;
bgTex.magFilter = THREE.LinearFilter;
bgTex.anisotropy = 4;
bgTex.wrapS = THREE.RepeatWrapping;
bgTex.mapping = THREE.EquirectangularReflectionMapping;
const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.BackSide, fog: false });
const bgMesh = new THREE.Mesh(bgGeo, bgMat);
scene.add(bgMesh);

/* ----- Distant twinkling stars (full sphere, including poles) -----
   Rebuildable at a lower count by applyLowQuality() below, since unlike
   the baked background this is cheap to tear down and recreate. ----- */
function createStars(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 24 + Math.random() * 20;
    // uniform distribution over full sphere
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1); // full 0..PI, covers poles too
    pos[i*3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3 + 1] = r * Math.cos(phi);
    pos[i*3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffeec2, size: 0.06, transparent: true, opacity: 0.6 });
  return new THREE.Points(geo, mat);
}

const STAR_COUNT_HIGH = 900;
const STAR_COUNT_LOW = 400;
let stars = createStars(lowQuality ? STAR_COUNT_LOW : STAR_COUNT_HIGH);
scene.add(stars);

/* ----- Floating ambient lights ----- */
const fairyGroup = new THREE.Group();
scene.add(fairyGroup);

function createFloatingLights(count, color, radiusMin, radiusMax) {
  const segments = lowQuality ? 5 : 8;
  const bulbGeo = new THREE.SphereGeometry(0.045, segments, segments);
  const glowGeo = new THREE.SphereGeometry(0.12, segments, segments);

  for (let i = 0; i < count; i++) {
    // random position in a spherical shell around the viewer
    const r = radiusMin + Math.random() * (radiusMax - radiusMin);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const pos = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );

    const bulbMat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.copy(pos);
    bulb.userData.basePos = pos.clone();
    bulb.userData.baseOpacity = 0.6 + Math.random() * 0.35;
    bulb.userData.twinkleSpeed = 0.4 + Math.random() * 1.4;
    bulb.userData.twinklePhase = Math.random() * Math.PI * 2;
    bulb.userData.driftSpeed = 0.05 + Math.random() * 0.12;
    bulb.userData.driftPhase = Math.random() * Math.PI * 2;
    fairyGroup.add(bulb);

    // tiny halo glow
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(pos);
    bulb.userData.glow = glow;
    fairyGroup.add(glow);
  }
}

// scattered warm lights, closer in and further out, drifting gently
createFloatingLights(lowQuality ? 20 : 50, 0xffd9a0, 3, 7);
createFloatingLights(lowQuality ? 15 : 40, 0xffe8c0, 6, 11);
createFloatingLights(lowQuality ? 10 : 30, 0xffcf9a, 4, 9);

/* ============================================================
   MEMORY CARD CREATION (polaroid sprites)
============================================================ */
const cardGroup = new THREE.Group();
scene.add(cardGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// layout positions for cards — arranged in a ring around the viewer so the
// gallery wraps seamlessly as you turn around (360°)
const RING_RADIUS = 6.5;

function getCardPosition(index) {
  const perLevel = 8; // cards per ring level
  const level = Math.floor(index / perLevel);
  const slot = index % perLevel;

  // spread levels slightly in height, alternating up/down from eye level
  const levelHeights = [1.4, -0.6, 3.0, -2.4];
  const y = levelHeights[level % levelHeights.length] + (Math.random() - 0.5) * 0.3;

  // even spacing around the full circle, with a small per-level offset so
  // levels don't perfectly stack
  const angleOffset = (level * Math.PI) / perLevel;
  const angle = (slot / perLevel) * Math.PI * 2 + angleOffset;

  const r = RING_RADIUS + (Math.random() - 0.5) * 0.6;
  const x = Math.sin(angle) * r;
  const z = Math.cos(angle) * r;

  return { pos: new THREE.Vector3(x, y, z), angle };
}

/* ============================================================
   TEXTURE CACHE — in-memory Map<memoryId, CanvasTexture>, scoped to
   this page session. Re-entering a previously visited galaxy skips
   regenerating (canvas-drawing) unchanged memories' textures.
   NOTE: memory content editing isn't supported yet (Phase 6's
   relatedIds don't affect the visual texture), so cache invalidation
   is a non-issue for now — this cache MUST be invalidated (or have
   the relevant entry deleted) if memory-content editing is ever added.
============================================================ */
const textureCache = new Map();

function getCachedTexture(id) {
  return textureCache.get(id);
}

function cacheTexture(id, tex) {
  tex.userData.cached = true;
  textureCache.set(id, tex);
}

// A card's map is only disposed if it isn't a shared, cached texture —
// disposing a cached texture here would break it for the next cache hit.
function disposeCardMesh(mesh) {
  if (mesh.material.map && !mesh.material.map.userData?.cached) {
    mesh.material.map.dispose();
  }
  mesh.material.dispose();
  mesh.geometry.dispose();
}

export function addMemoryToScene(memory) {
  const cached = getCachedTexture(memory.id);
  // A photo memory's texture isn't "final" until its image has decoded
  // (refreshMemoryTexture regenerates + caches it then) — don't cache the
  // interim placeholder-ish draw, or a re-entry would get stuck without it.
  const stillAwaitingPhoto = memory.type === 'photo' && memory.photoData && !memory.photoImg;
  const tex = cached || makePolaroidTexture(memory);
  if (!cached && !stillAwaitingPhoto) cacheTexture(memory.id, tex);
  const aspect = 512 / 600;
  const height = 1.8;
  const width = height * aspect;
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);

  // Ring slot comes from how many stars are *rendered*, not how many the
  // galaxy has — `memories` now spans every planet, only one of which is
  // in the ring at a time.
  const { pos, angle } = getCardPosition(cardGroup.children.length);
  mesh.position.copy(pos);
  // face the card toward the center of the ring (toward the viewer)
  mesh.rotation.y = angle + Math.PI;
  mesh.rotation.z = (Math.random() - 0.5) * 0.12;
  mesh.userData.basePos = pos.clone();
  mesh.userData.baseRotY = mesh.rotation.y;
  mesh.userData.baseRotZ = mesh.rotation.z;
  mesh.userData.bobOffset = Math.random() * Math.PI * 2;
  mesh.userData.bobSpeed = 0.4 + Math.random() * 0.3;
  mesh.userData.memory = memory;

  cardGroup.add(mesh);
  memory.mesh = mesh;

  document.getElementById('emptyHint').classList.add('hidden');
}

/* ============================================================
   LOADING PLACEHOLDERS — shown at ring positions while a galaxy's
   memories are being fetched, so entering a galaxy never shows a
   flash of empty ring on a slow connection.
============================================================ */
const LOADING_PLACEHOLDER_COUNT = 4;
let loadingPlaceholders = [];

function makePlaceholderTexture() {
  const W = 512, H = 600;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(210, 200, 190, 0.22)';
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function showLoadingPlaceholders() {
  const aspect = 512 / 600;
  const height = 1.8;
  const width = height * aspect;
  for (let i = 0; i < LOADING_PLACEHOLDER_COUNT; i++) {
    const geo = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({ map: makePlaceholderTexture(), transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);

    const { pos, angle } = getCardPosition(i);
    mesh.position.copy(pos);
    mesh.rotation.y = angle + Math.PI;
    mesh.userData.basePos = pos.clone();
    mesh.userData.baseRotY = mesh.rotation.y;
    mesh.userData.baseRotZ = 0;
    mesh.userData.bobOffset = Math.random() * Math.PI * 2;
    mesh.userData.bobSpeed = 0.4 + Math.random() * 0.3;

    cardGroup.add(mesh);
    loadingPlaceholders.push(mesh);
  }
}

export function clearLoadingPlaceholders() {
  loadingPlaceholders.forEach((mesh) => {
    mesh.material.map?.dispose();
    mesh.material.dispose();
    mesh.geometry.dispose();
    cardGroup.remove(mesh);
  });
  loadingPlaceholders = [];
}

function refreshMemoryTexture(memory) {
  if (!memory.mesh) return;
  const newTex = makePolaroidTexture(memory);
  const oldMap = memory.mesh.material.map;
  if (oldMap && !oldMap.userData?.cached) oldMap.dispose();
  memory.mesh.material.map = newTex;
  memory.mesh.material.needsUpdate = true;
  cacheTexture(memory.id, newTex);
}

function loadPhotoImgFor(memory) {
  if (!memory.photoData) return;
  const img = new Image();
  img.onload = () => {
    memory.photoImg = img;
    refreshMemoryTexture(memory);
  };
  img.src = memory.photoData;
}

// Tear down every mesh currently in the ring (stars and any loading
// placeholders) without touching `memories` — used both when leaving a galaxy
// and when travelling to another of its planets.
function clearRenderedStars() {
  cardGroup.children.slice().forEach((mesh) => {
    disposeCardMesh(mesh);
    cardGroup.remove(mesh);
    if (mesh.userData.memory) mesh.userData.memory.mesh = null;
  });
  loadingPlaceholders = [];
}

// Remove all memory cards from the scene and reset state, ready for a
// different galaxy's memories to be loaded in.
export function clearGalleryScene() {
  clearRenderedStars();
  memories.length = 0;
  setCurrentPlanets([]);
  setCurrentPlanetIndex(0);
  updatePortals();
  updatePlanetLabel();
  document.getElementById('emptyHint').classList.remove('hidden');
}

// How many stars are actually in the ring right now — i.e. the viewed
// planet's, not the whole galaxy's.
export function renderedStarCount() {
  return cardGroup.children.length;
}

// Picks the subset of a galaxy's memories that belongs in the ring: the ones
// filed onto the viewed planet. Two fallbacks keep a galaxy from ever
// rendering an empty ring when it has stars to show:
//  - no planets at all (nothing has been filed yet) → render everything;
//  - a star with no planetId (predates planets, backfill not run) → treat it
//    as belonging to the oldest planet.
function starsOnViewedPlanet(all, planets, planetIndex) {
  if (planets.length === 0) return all;
  const viewed = planets.find((p) => p.index === planetIndex);
  if (!viewed) return [];
  return all.filter((m) => (
    m.planetId ? m.planetId === viewed.id : viewed.index === 0
  ));
}

/* ============================================================
   PLANET PORTALS — two markers sitting just outside the card ring,
   left and right of where you enter, for travelling between a
   galaxy's planets. They live in their own group so the ring's own
   bookkeeping (slot index, renderedStarCount) still counts stars only.
   The "next" portal is shown greyed/locked when no successor planet
   exists yet; "previous" only appears when there's an earlier planet
   and is never locked.
============================================================ */
const portalGroup = new THREE.Group();
scene.add(portalGroup);

const PORTAL_RADIUS = 9;    // outside the card ring's 6.5
const PORTAL_Y = 0.3;       // between the ring's first two height bands
const PORTAL_SIZE = 2.8;
// ±100° from straight ahead: to either side, and off the multiples of 22.5°
// that getCardPosition() places cards on.
const PORTAL_ANGLES = { prev: -Math.PI * (100 / 180), next: Math.PI * (100 / 180) };

function makePortalMesh(kind) {
  const geo = new THREE.PlaneGeometry(PORTAL_SIZE, PORTAL_SIZE);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false // the glow's soft edges shouldn't punch holes in the cards behind
  });
  const mesh = new THREE.Mesh(geo, mat);
  const angle = PORTAL_ANGLES[kind];
  const x = Math.sin(angle) * PORTAL_RADIUS;
  const z = Math.cos(angle) * PORTAL_RADIUS;
  mesh.position.set(x, PORTAL_Y, z);
  mesh.rotation.y = angle + Math.PI; // face the center of the ring
  mesh.userData = {
    portal: kind,
    angle,
    baseX: x,
    baseZ: z,
    bobOffset: kind === 'next' ? 0 : Math.PI,
    locked: false,
    targetIndex: null,
    nudgeStart: 0
  };
  mesh.visible = false;
  portalGroup.add(mesh);
  return mesh;
}

const portals = { prev: makePortalMesh('prev'), next: makePortalMesh('next') };

function setPortalTexture(mesh, opts) {
  const old = mesh.material.map;
  mesh.material.map = makePortalTexture({ color: currentGalaxy?.accentColor || '#ffd9a0', ...opts });
  mesh.material.needsUpdate = true;
  old?.dispose();
}

// Rebuilds both portals from the current planet list and viewed index. A
// galaxy with no planet records at all shows neither: the ring isn't
// planet-filtered in that case (see starsOnViewedPlanet), so there's nowhere
// to travel to.
function updatePortals() {
  if (currentPlanets.length === 0) {
    portals.prev.visible = false;
    portals.next.visible = false;
    return;
  }

  const earlier = currentPlanets.filter((p) => p.index < currentPlanetIndex);
  const prev = earlier[earlier.length - 1];
  const next = currentPlanets.find((p) => p.index > currentPlanetIndex);

  portals.prev.visible = !!prev;
  if (prev) {
    portals.prev.userData.locked = false;
    portals.prev.userData.targetIndex = prev.index;
    setPortalTexture(portals.prev, {
      direction: 'prev', caption: 'previous planet', label: prev.name, locked: false
    });
  }

  portals.next.visible = true;
  portals.next.userData.locked = !next;
  portals.next.userData.targetIndex = next ? next.index : null;
  setPortalTexture(portals.next, next
    ? { direction: 'next', caption: 'next planet', label: next.name, locked: false }
    : { direction: 'next', caption: 'next planet', label: 'not formed yet', locked: true });
}

// Small "you're here" readout in the topbar — without it the portals tell you
// where you can go but not where you are. Hidden for a galaxy that only has
// the one planet, where there's nothing to disambiguate.
function updatePlanetLabel() {
  const el = document.getElementById('planetLabel');
  if (!el) return;
  const pos = currentPlanets.findIndex((p) => p.index === currentPlanetIndex);
  if (currentPlanets.length < 2 || pos === -1) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = `✦ ${currentPlanets[pos].name} · planet ${pos + 1} of ${currentPlanets.length}`;
  el.classList.remove('hidden');
}

// Swap which planet's stars are in the ring. `memories` (the galaxy's stars
// across every planet) is deliberately left alone — only the meshes change.
export function showPlanet(planetIndex) {
  clearRenderedStars();
  setCurrentPlanetIndex(planetIndex);

  starsOnViewedPlanet(memories, currentPlanets, planetIndex).forEach((mem) => {
    addMemoryToScene(mem);
    // a cache hit already has its final texture (photo decoded and all) —
    // no need to re-decode the image and regenerate it
    if (!getCachedTexture(mem.id)) loadPhotoImgFor(mem);
  });

  updatePortals();
  updatePlanetLabel();
  document.getElementById('emptyHint').classList.toggle('hidden', renderedStarCount() > 0);
}

// Places a newly-created star. Which planet it belongs to is the server's
// call (it files new stars onto the galaxy's newest planet, creating the next
// one past the cap), so the planet list is refetched and the star only joins
// the ring if it landed on the planet being viewed. Returns the planet it
// landed on, or null if that couldn't be determined.
export async function placeNewStar(memory) {
  try {
    setCurrentPlanets(await loadPlanets(currentGalaxyId));
  } catch (e) {
    console.warn('Could not refresh planets', e);
  }

  const viewed = currentPlanets.find((p) => p.index === currentPlanetIndex);
  // No planetId (a save the server never assigned) or no planets at all means
  // the ring isn't planet-filtered — show it either way.
  if (!memory.planetId || !viewed || memory.planetId === viewed.id) {
    addMemoryToScene(memory);
  }

  updatePortals();
  updatePlanetLabel();
  return currentPlanets.find((p) => p.id === memory.planetId) || null;
}

// Callback invoked with the target planet index when an unlocked portal is
// clicked. Wired up by galaxyPicker.js (which owns the transition) rather
// than imported from there, to avoid a circular import.
let onPortalClick = null;
export function setOnPortalClick(fn) {
  onPortalClick = fn;
}

function handlePortalClick(mesh) {
  if (mesh.userData.locked) {
    // Nothing to travel to yet — acknowledge the click instead of ignoring it.
    playUiSound('locked');
    mesh.userData.nudgeStart = performance.now();
    return;
  }
  playUiSound('select');
  if (onPortalClick) onPortalClick(mesh.userData.targetIndex);
}

// Load a galaxy's memories into the (already-cleared) scene. Every memory goes
// into the shared `memories` state, but only the viewed planet's are rendered.
export async function loadGalaxyMemories(galaxyId) {
  let restored = [];
  let planets = [];
  try {
    [restored, planets] = await Promise.all([
      loadAllMemories(galaxyId),
      loadPlanets(galaxyId)
    ]);
  } catch (e) {
    console.warn('Could not load memories', e);
    showStorageWarning('couldn\'t reach the gallery server — check that "npm start" is running, then reload.');
  }
  setCurrentPlanets(planets);

  clearLoadingPlaceholders();
  restored.forEach((mem) => memories.push(mem));

  // A galaxy always opens on its oldest planet.
  showPlanet(planets.length > 0 ? planets[0].index : 0);
}

// Removes a single memory's mesh from the scene (disposing its GPU
// resources) without touching the `memories` array.
export function removeMemoryFromScene(memory) {
  if (memory.mesh) {
    disposeCardMesh(memory.mesh);
    cardGroup.remove(memory.mesh);
  }
  textureCache.delete(memory.id);
}

/* ============================================================
   CAMERA CONTROLS — fixed position, free 360° look-around
   (drag to look in any direction, including straight up/down)
============================================================ */
let isDragging = false;
let prevX = 0, prevY = 0;
let targetYaw = 0, targetPitch = 0;
let yaw = 0, pitch = 0;
const PITCH_LIMIT = Math.PI / 2 - 0.02; // just shy of straight up/down to avoid gimbal flip artifacts

// Lets cardFlip.js pause camera-look while a card is flipping/open.
let dragLocked = false;
export function setDragLocked(locked) {
  dragLocked = locked;
  if (locked) isDragging = false;
}

camera.position.set(0, 1.2, 0);

function updateCameraFromAngles() {
  const dirX = Math.sin(yaw) * Math.cos(pitch);
  const dirY = Math.sin(pitch);
  const dirZ = Math.cos(yaw) * Math.cos(pitch);
  camera.lookAt(
    camera.position.x + dirX,
    camera.position.y + dirY,
    camera.position.z + dirZ
  );
}
updateCameraFromAngles();

renderer.domElement.style.touchAction = 'none';

// Safari fires non-standard gesturestart/gesturechange events for
// pinch-zoom that `touch-action: none` alone doesn't fully suppress there.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (dragLocked) return;
  isDragging = true;
  prevX = e.clientX;
  prevY = e.clientY;
});

window.addEventListener('pointerup', () => { isDragging = false; });

window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (!isDragging || dragLocked) return;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;
  targetYaw -= dx * 0.004;
  targetPitch += dy * 0.004;
  targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));
});

// Callback invoked with (memory, mesh) when a card is clicked (only if not
// dragged much). The caller (cardFlip.js) wires this up to the flip + read
// panel.
let onCardClick = null;
export function setOnCardClick(fn) {
  onCardClick = fn;
}

/* Click to open a memory (only if not dragged much) */
let downPos = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (dragLocked) return; // a card is already flipping/open
  const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  if (dist > 6) return; // was a drag
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = cardGroup.children.concat(portalGroup.children.filter((p) => p.visible));
  const intersects = raycaster.intersectObjects(targets);
  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    if (mesh.userData.portal) {
      handlePortalClick(mesh);
    } else if (onCardClick && mesh.userData.memory) {
      // no memory means it's a loading placeholder — nothing to open yet
      onCardClick(mesh.userData.memory, mesh);
    }
  }
});

// Projects a card mesh's four corners to screen-space pixel coordinates and
// returns their bounding box, for positioning the flip read panel "over"
// the card.
export function getMeshScreenRect(mesh) {
  const { width, height } = mesh.geometry.parameters;
  const hw = width / 2, hh = height / 2;
  const localCorners = [
    new THREE.Vector3(-hw, -hh, 0),
    new THREE.Vector3(hw, -hh, 0),
    new THREE.Vector3(hw, hh, 0),
    new THREE.Vector3(-hw, hh, 0),
  ];
  mesh.updateMatrixWorld();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  localCorners.forEach((corner) => {
    const world = corner.applyMatrix4(mesh.matrixWorld);
    const ndc = world.project(camera);
    const x = (ndc.x + 1) / 2 * window.innerWidth;
    const y = (1 - (ndc.y + 1) / 2) * window.innerHeight;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

/* ============================================================
   ANIMATION LOOP
============================================================ */
const clock = new THREE.Clock();
let TARGET_FPS = lowQuality ? 30 : 60;
let FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastFrameTime = 0;
let animPaused = false;

// Steps pixel ratio, star count, and target FPS down to their low-quality
// values. Called either immediately (prefers-reduced-motion at load) or
// once the frame-time benchmark below decides the device can't keep up.
function applyLowQuality() {
  if (lowQuality) return; // already applied
  lowQuality = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  TARGET_FPS = 30;
  FRAME_INTERVAL = 1000 / TARGET_FPS;

  const oldStars = stars;
  stars = createStars(STAR_COUNT_LOW);
  scene.add(stars);
  scene.remove(oldStars);
  oldStars.geometry.dispose();
  oldStars.material.dispose();
}

// Runtime capability benchmark: average frame time over the first ~60
// rendered frames. Skipped entirely if lowQuality was already forced on
// by prefers-reduced-motion — that's a stated preference, not something
// a fast benchmark result should override.
const BENCHMARK_FRAME_COUNT = 60;
const BENCHMARK_MS_THRESHOLD = 22; // ~45fps
let benchmarkDone = lowQuality;
let benchmarkFrames = 0;
let benchmarkTotal = 0;

// Pause rendering when tab is hidden to save CPU/GPU
document.addEventListener('visibilitychange', () => {
  animPaused = document.hidden;
  if (!animPaused) lastFrameTime = 0; // reset so no huge delta on resume
});

function animate(now = 0) {
  requestAnimationFrame(animate);
  if (animPaused) return;

  // Throttle to TARGET_FPS
  if (now - lastFrameTime < FRAME_INTERVAL) return;
  const frameDelta = lastFrameTime ? now - lastFrameTime : 0;
  lastFrameTime = now;

  // Ignore a stray huge gap (e.g. right after a visibilitychange resume)
  // so it doesn't skew the average toward a false downgrade.
  if (!benchmarkDone && frameDelta > 0 && frameDelta < 200) {
    benchmarkFrames++;
    benchmarkTotal += frameDelta;
    if (benchmarkFrames >= BENCHMARK_FRAME_COUNT) {
      benchmarkDone = true;
      const avgFrameTime = benchmarkTotal / benchmarkFrames;
      if (avgFrameTime > BENCHMARK_MS_THRESHOLD) applyLowQuality();
    }
  }

  const t = clock.getElapsedTime();

  yaw += (targetYaw - yaw) * 0.08;
  pitch += (targetPitch - pitch) * 0.08;
  updateCameraFromAngles();

  // Quiet mode (or OS-level prefers-reduced-motion) slows/pauses the
  // ambient drift animations below — 1 is full motion, near-0 is nearly still.
  const motionDamp = shouldDampenMotion() ? 0.12 : 1;

  // gentle bob/sway for cards, rotation stays anchored to face the viewer.
  // Skip any card cardFlip.js is currently animating/holding open, so the
  // two animation systems don't fight over rotation.y each frame.
  cardGroup.children.forEach((mesh) => {
    if (mesh.userData.flipping) return;
    const ud = mesh.userData;
    mesh.position.y = ud.basePos.y + Math.sin(t * ud.bobSpeed + ud.bobOffset) * 0.08 * motionDamp;
    mesh.rotation.y = ud.baseRotY + Math.sin(t * ud.bobSpeed * 0.3 + ud.bobOffset) * 0.05 * motionDamp;
    mesh.rotation.z = ud.baseRotZ + Math.sin(t * ud.bobSpeed * 0.5 + ud.bobOffset) * 0.03 * motionDamp;
  });

  // portals: a slow breathing pulse, plus a short shake when a locked one
  // gets clicked
  portalGroup.children.forEach((mesh) => {
    if (!mesh.visible) return;
    const ud = mesh.userData;
    const wave = Math.sin(t * 1.1 + ud.bobOffset);
    const pulse = 1 + wave * 0.035 * motionDamp;
    mesh.scale.set(pulse, pulse, 1);
    mesh.position.y = PORTAL_Y + Math.sin(t * 0.5 + ud.bobOffset) * 0.12 * motionDamp;
    mesh.material.opacity = ud.locked ? 0.6 : 0.9 + 0.1 * wave * motionDamp;

    if (ud.nudgeStart) {
      const e = (performance.now() - ud.nudgeStart) / 380;
      // shake along the ring's tangent at this portal's angle
      const k = e >= 1 ? 0 : Math.sin(e * Math.PI * 4) * (1 - e) * 0.2;
      if (e >= 1) ud.nudgeStart = 0;
      mesh.position.x = ud.baseX + Math.cos(ud.angle) * k;
      mesh.position.z = ud.baseZ - Math.sin(ud.angle) * k;
    }
  });

  // twinkle + drift floating lights
  fairyGroup.children.forEach((obj) => {
    if (obj.userData.twinklePhase !== undefined) {
      const rawFlick = 0.6 + 0.4 * Math.sin(t * obj.userData.twinkleSpeed + obj.userData.twinklePhase);
      // dampened: blend toward a steady 1 (no flicker) instead of fully off
      const flick = motionDamp < 1 ? 1 - (1 - rawFlick) * motionDamp : rawFlick;
      obj.material.opacity = obj.userData.baseOpacity * flick;

      // gentle drifting motion around the base position
      const d = obj.userData.driftSpeed;
      const p = obj.userData.driftPhase;
      obj.position.x = obj.userData.basePos.x + Math.sin(t * d + p) * 0.4 * motionDamp;
      obj.position.y = obj.userData.basePos.y + Math.cos(t * d * 0.8 + p) * 0.4 * motionDamp;
      obj.position.z = obj.userData.basePos.z + Math.sin(t * d * 0.6 + p) * 0.4 * motionDamp;

      if (obj.userData.glow) {
        obj.userData.glow.material.opacity = 0.18 * flick;
        obj.userData.glow.position.copy(obj.position);
      }
    }
  });

  // gentle star twinkle via scene rotation
  stars.rotation.y = t * 0.005 * motionDamp;

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowQuality ? 1 : 2));
});
