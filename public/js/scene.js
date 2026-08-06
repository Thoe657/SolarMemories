/* ============================================================
   THREE.JS SETUP — renderer/camera/lights/background/animate loop
   (relies on the global THREE from the CDN <script> tag)
============================================================ */
import { makePolaroidTexture, roundRect } from './cards.js';
import { loadAllMemories } from './api.js';
import { showStorageWarning } from './util.js';
import { memories } from './state.js';
import { shouldDampenMotion } from './audioManager.js';

const container = document.getElementById('scene-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.2, 9);

// Detect low-end devices: cap pixel ratio at 1 and skip antialias to save GPU fill-rate
const isLowEnd = navigator.hardwareConcurrency <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ antialias: !isLowEnd, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(isLowEnd ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Soft ambient + warm point lights to sell the "fairy light" mood
scene.add(new THREE.AmbientLight(0x554466, 1.1));

const hemi = new THREE.HemisphereLight(0x6f5a8a, 0x2a1830, 0.6);
scene.add(hemi);

/* ----- Background: full starry night sky (equirectangular gradient + nebula glow) ----- */
const bgGeo = new THREE.SphereGeometry(60, isLowEnd ? 32 : 64, isLowEnd ? 32 : 64);
const bgCanvas = document.createElement('canvas');
const BG_W = isLowEnd ? 2048 : 4096, BG_H = isLowEnd ? 1024 : 2048;
bgCanvas.width = BG_W; bgCanvas.height = BG_H;
const bgCtx = bgCanvas.getContext('2d');

// base: near-black night sky, with the faintest gradient so it's not flat
const grad = bgCtx.createLinearGradient(0, 0, 0, BG_H);
grad.addColorStop(0, '#000000');
grad.addColorStop(0.5, '#03030a');
grad.addColorStop(1, '#000000');
bgCtx.fillStyle = grad;
bgCtx.fillRect(0, 0, BG_W, BG_H);

// soft, subtle nebula glow patches
function paintGlow(x, y, r, color, alpha) {
  const g = bgCtx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('ALPHA', alpha));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  bgCtx.fillStyle = g;
  bgCtx.fillRect(x - r, y - r, r * 2, r * 2);
}
paintGlow(3040, 600, 1040, 'rgba(80,60,120,ALPHA)', '0.12');
paintGlow(800, 920, 880, 'rgba(110,70,90,ALPHA)', '0.08');
paintGlow(2080, 1520, 960, 'rgba(60,50,100,ALPHA)', '0.09');
paintGlow(3800, 1600, 800, 'rgba(40,60,90,ALPHA)', '0.07');

// dense background stars baked into the texture (varied size + brightness)
const bakedStarCount = isLowEnd ? 2500 : 5600;
for (let i = 0; i < bakedStarCount; i++) {
  const x = Math.random() * BG_W;
  const y = Math.random() * BG_H;
  const size = Math.random() < 0.85 ? Math.random() * 3 + 0.8 : Math.random() * 5 + 3;
  const alpha = Math.random() * 0.6 + 0.3;
  bgCtx.fillStyle = `rgba(255, 245, 225, ${alpha})`;
  bgCtx.beginPath();
  bgCtx.arc(x, y, size, 0, Math.PI * 2);
  bgCtx.fill();
}

// a few brighter "named" stars with subtle glow
for (let i = 0; i < 24; i++) {
  const x = Math.random() * BG_W;
  const y = Math.random() * 1520 + 40;
  const g = bgCtx.createRadialGradient(x, y, 0, x, y, 24);
  g.addColorStop(0, 'rgba(255, 250, 235, 0.9)');
  g.addColorStop(1, 'rgba(255, 250, 235, 0)');
  bgCtx.fillStyle = g;
  bgCtx.fillRect(x - 24, y - 24, 48, 48);
  bgCtx.fillStyle = 'rgba(255, 255, 245, 0.95)';
  bgCtx.beginPath();
  bgCtx.arc(x, y, 5.6, 0, Math.PI * 2);
  bgCtx.fill();
}

const bgTex = new THREE.CanvasTexture(bgCanvas);
bgTex.colorSpace = THREE.SRGBColorSpace;
bgTex.minFilter = THREE.LinearMipmapLinearFilter;
bgTex.magFilter = THREE.LinearFilter;
bgTex.anisotropy = isLowEnd ? 1 : 4;
bgTex.wrapS = THREE.RepeatWrapping;
bgTex.mapping = THREE.EquirectangularReflectionMapping;
const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.BackSide, fog: false });
const bgMesh = new THREE.Mesh(bgGeo, bgMat);
scene.add(bgMesh);

/* ----- Distant twinkling stars (full sphere, including poles) ----- */
const starGeo = new THREE.BufferGeometry();
const starCount = isLowEnd ? 400 : 900;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 24 + Math.random() * 20;
  // uniform distribution over full sphere
  const u = Math.random();
  const v = Math.random();
  const theta = u * Math.PI * 2;
  const phi = Math.acos(2 * v - 1); // full 0..PI, covers poles too
  starPos[i*3]     = r * Math.sin(phi) * Math.cos(theta);
  starPos[i*3 + 1] = r * Math.cos(phi);
  starPos[i*3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffeec2, size: 0.06, transparent: true, opacity: 0.6 });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

/* ----- Floating ambient lights ----- */
const fairyGroup = new THREE.Group();
scene.add(fairyGroup);

function createFloatingLights(count, color, radiusMin, radiusMax) {
  const segments = isLowEnd ? 5 : 8;
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
createFloatingLights(isLowEnd ? 20 : 50, 0xffd9a0, 3, 7);
createFloatingLights(isLowEnd ? 15 : 40, 0xffe8c0, 6, 11);
createFloatingLights(isLowEnd ? 10 : 30, 0xffcf9a, 4, 9);

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

  const { pos, angle } = getCardPosition(memories.length);
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

// Remove all memory cards from the scene and reset state, ready for a
// different galaxy's memories to be loaded in.
export function clearGalleryScene() {
  cardGroup.children.slice().forEach((mesh) => {
    disposeCardMesh(mesh);
    cardGroup.remove(mesh);
  });
  memories.length = 0;
  document.getElementById('emptyHint').classList.remove('hidden');
}

// Load a galaxy's memories into the (already-cleared) scene.
export async function loadGalaxyMemories(galaxyId) {
  let restored = [];
  try {
    restored = await loadAllMemories(galaxyId);
  } catch (e) {
    console.warn('Could not load memories', e);
    showStorageWarning('couldn\'t reach the gallery server — check that "npm start" is running, then reload.');
  }
  clearLoadingPlaceholders();
  restored.forEach((mem) => {
    memories.push(mem);
    addMemoryToScene(mem);
    // a cache hit already has its final texture (photo decoded and all) —
    // no need to re-decode the image and regenerate it
    if (!getCachedTexture(mem.id)) loadPhotoImgFor(mem);
  });
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
  const intersects = raycaster.intersectObjects(cardGroup.children);
  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    if (onCardClick) onCardClick(mesh.userData.memory, mesh);
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
const TARGET_FPS = isLowEnd ? 30 : 60;
const FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastFrameTime = 0;
let animPaused = false;

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
  lastFrameTime = now;

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
  renderer.setPixelRatio(isLowEnd ? Math.min(window.devicePixelRatio, 1) : Math.min(window.devicePixelRatio, 2));
});
