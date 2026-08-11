/* ============================================================
   THREE.JS SETUP — renderer/camera/lights/background/animate loop
   (relies on the global THREE from the CDN <script> tag)
============================================================ */
import { makePolaroidTexture, makeMoonSurfaceTexture, makePortalLabelTexture, roundRect } from './cards.js';
import { loadAllMemories, loadMoons } from './api.js';
import { showStorageWarning } from './util.js';
import {
  memories,
  currentPlanet,
  currentPlanetId,
  currentMoons,
  currentMoonIndex,
  setCurrentMoons,
  setCurrentMoonIndex
} from './state.js';
import { prefersReducedMotion } from './motionPreference.js';
import {
  currentTier,
  tierSettings,
  tierLabel,
  nextTierDown,
  autoTierAllowed,
  recordMeasuredTier,
  onTierChange
} from './quality.js';

const container = document.getElementById('scene-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.2, 9);

/* ============================================================
   ADAPTIVE QUALITY (Plan 3 Phase 4) — the tier itself lives in
   quality.js, which this module imports and which therefore finishes
   resolving before a single line down here runs. That ordering is the
   entire reason it is a separate module: `antialias` is baked into the
   WebGL context by the constructor two lines below and cannot be
   changed for the life of the page, so the low tier's
   `antialias: false` is only reachable if the tier is already known —
   from prefers-reduced-motion, ?quality=, a choice made on the entry
   screen, or a verdict this machine reached in an earlier session and
   quality.js read back out of localStorage.

   Everything else the tier controls (pixel ratio, target FPS, distant
   star count, fairy-light count) can be changed on a live renderer,
   which is what applyQualityTier() near the animate loop does — either
   because the entry screen's selector moved the tier, or because the
   rolling frame-time average down there decided this machine can't hold
   the tier it started on. That replaced a one-shot 60-frame benchmark
   whose verdict was binary, forgotten at the end of the session, and
   unable to touch the fairy lights at all.
============================================================ */
let quality = tierSettings();

const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
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
   Rebuildable at another tier's count by applyQualityTier() below, since
   unlike the baked background this is cheap to tear down and recreate. ----- */
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

// 900 / 600 / 400 by tier — see quality.js's TIER_SETTINGS.
let stars = createStars(quality.distantStars);
scene.add(stars);

/* ============================================================
   FLOATING AMBIENT LIGHTS (the "fairy lights")

   Two THREE.Points clouds — the bulbs and their haloes — sharing one small
   ShaderMaterial. Twinkle and drift are computed on the GPU from a single
   uTime uniform; every per-light value (colour, size, base opacity, twinkle
   and drift speed/phase) rides along as a buffer attribute.

   What this replaced, and what it actually bought (Plan 3 Phase 3): 240 sphere
   meshes — 120 bulbs + 120 glows — each with its own MeshBasicMaterial, all
   mutated from JS every frame. The draw-call saving is much smaller than the
   plan's "~240 calls" claim: measured, a whole planet renders in 31 calls
   total, because the lights are scattered through a shell *around* the camera
   and three frustum-culls each mesh, so only ~25 of the 240 were ever
   submitted. The costs that were real are the ones culling never touched — a
   per-frame JS loop over 240 objects doing sin/cos and writing .position
   (dirtying 240 matrices, all recomputed in updateMatrixWorld every frame),
   240 material.opacity writes, and those ~25 draw calls. All of that is now
   two uniform writes and 2 draw calls.

   The mesh implementation is still below as createFloatingLights(): it is the
   fallback for a driver that can't compile the shader (see probeFairyShader).
============================================================ */
const fairyGroup = new THREE.Group();
scene.add(fairyGroup);

// Counts come from quality.js's TIER_SETTINGS: 120 / 60 / 24. High is the
// 50+40+30 the scene has always had; low drops to 24 (the pre-Plan-3 low path
// built 45, and could only reach that at module load).

// The three populations, as *shares* of the total so a tier scales them
// together instead of one group vanishing first. At the high tier's 120 they
// come out at exactly the original 50 / 40 / 30 — that is the point, the high
// tier has to be untouched. (medium's 60 → 25/20/15; low's 24 → 10/8/6.)
const FAIRY_POPULATIONS = [
  { share: 50 / 120, color: 0xffd9a0, radiusMin: 3, radiusMax: 7 },
  { share: 40 / 120, color: 0xffe8c0, radiusMin: 6, radiusMax: 11 },
  { share: 30 / 120, color: 0xffcf9a, radiusMin: 4, radiusMax: 9 }
];

const FAIRY_BULB_RADIUS = 0.045;
const FAIRY_GLOW_RADIUS = 0.12;
const FAIRY_GLOW_OPACITY = 0.18;

function fairyCounts(total) {
  return FAIRY_POPULATIONS.map((pop) => Math.round(total * pop.share));
}

/* Colour space — the part of this change that would be invisible in a diff if
   it were wrong. MeshBasicMaterial({ color: 0xffd9a0 }) put the hex through
   THREE.Color, which (with ColorManagement on, the r160 default) converts
   sRGB → linear working space; the built-in shader then encoded linear → sRGB
   again on the way out, because renderer.outputColorSpace is SRGBColorSpace.
   Net, the framebuffer got the hex back. A ShaderMaterial has neither half of
   that — no material colour going in, no output stage coming out — so packing
   THREE.Color's linear components straight into an attribute would ship washed-
   out, wrong-hued lights. This bakes the output encoding on the CPU instead,
   using three's own conversion (Color.convertLinearToSRGB is the same curve the
   colorspace shader chunk applies), because it's constant per light and has no
   business being a per-fragment pow. The fragment shader then writes the result
   out untouched. If the renderer is ever switched to a linear output, the
   un-encoded linear value is what the old material produced, so skip the step. */
function fairyOutputColor(hex) {
  const c = new THREE.Color(hex); // sRGB hex → linear working space
  if (renderer.outputColorSpace === THREE.SRGBColorSpace) c.convertLinearToSRGB();
  return c;
}

/* Point size has to attenuate with distance the way the spheres did: these
   lights sit 3–11 units out with the camera *inside* the shell, so a fixed
   screen-space size would be an obvious regression the moment you looked
   around. A world-space diameter D at view depth d covers

       D * (1 / tan(fov/2)) * (H_device / 2) / d      device pixels

   vertically, so the attribute carries D and the uniform carries
   (H_device / 2) / tan(fov/2). (three's own sizeAttenuation uses scale = H/2
   and drops the 1/tan(fov/2) — PointsMaterial.size isn't in world units — which
   is why this doesn't just reuse that value.) It depends on the drawing buffer
   height, i.e. on both the canvas size and the pixel ratio, so it is refreshed
   on resize and whenever the quality path changes the pixel ratio. */
const fairyUniforms = {
  uTime: { value: 0 },
  uMotionDamp: { value: 1 },
  uScale: { value: 1 }
};

const _fairyBufferSize = new THREE.Vector2();
function updateFairyScale() {
  renderer.getDrawingBufferSize(_fairyBufferSize);
  fairyUniforms.uScale.value = (_fairyBufferSize.y * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
}

// Sentinel string, carried in both shaders' source so the shader-error hook can
// recognise *our* program without reaching into renderer internals.
const FAIRY_SHADER_SENTINEL = 'FAIRY_LIGHTS_V1';

const FAIRY_VERTEX_SHADER = `
  // ${FAIRY_SHADER_SENTINEL}
  uniform float uTime;
  uniform float uMotionDamp;
  uniform float uScale;

  attribute vec3 aColor;
  attribute float aSize;     // world-space diameter
  attribute float aOpacity;  // this cloud's base opacity for this light
  attribute vec2 aTwinkle;   // x: speed, y: phase
  attribute vec2 aDrift;     // x: speed, y: phase

  varying vec3 vColor;
  varying float vAlpha;
  varying float vEdge;

  void main() {
    // Same drift as the old JS loop, axis for axis.
    float d = aDrift.x;
    float p = aDrift.y;
    vec3 drifted = position + vec3(
      sin(uTime * d + p),
      cos(uTime * d * 0.8 + p),
      sin(uTime * d * 0.6 + p)
    ) * 0.4 * uMotionDamp;

    // ...and the same twinkle, including its asymmetry with the drift: damping
    // blends the flicker toward a steady 1 (no flicker) rather than toward off,
    // while the drift above is simply scaled down.
    float rawFlick = 0.6 + 0.4 * sin(uTime * aTwinkle.x + aTwinkle.y);
    float flick = uMotionDamp < 1.0 ? 1.0 - (1.0 - rawFlick) * uMotionDamp : rawFlick;

    vColor = aColor;
    vAlpha = aOpacity * flick;

    vec4 mvPosition = modelViewMatrix * vec4(drifted, 1.0);
    // max() only guards against a divide by ~0; nothing gets within 1.1 units.
    float size = aSize * uScale / max(-mvPosition.z, 0.05);
    gl_PointSize = size;
    vEdge = 1.0 / max(size, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FAIRY_FRAGMENT_SHADER = `
  // ${FAIRY_SHADER_SENTINEL}
  varying vec3 vColor;
  varying float vAlpha;
  varying float vEdge;

  void main() {
    // The meshes these replace were spheres, so the silhouette is a disc, not
    // the square a point sprite rasterizes by default. It has to be discard and
    // not just alpha 0: this material writes depth (see renderOrder below), so
    // a fully transparent corner would still punch a hole in whatever is behind
    // the sprite.
    vec2 offset = gl_PointCoord - vec2(0.5);
    float r = length(offset);
    if (r > 0.5) discard;
    // vEdge is one device pixel expressed in gl_PointCoord units: fading the
    // last pixel of the rim stands in for the MSAA that antialias: true used to
    // give the sphere's geometric edge, so the dots don't come out jagged.
    float alpha = vAlpha * (1.0 - smoothstep(0.5 - vEdge, 0.5, r));
    gl_FragColor = vec4(vColor, alpha);
  }
`;

let fairyMaterial = null;

function getFairyMaterial() {
  if (!fairyMaterial) {
    fairyMaterial = new THREE.ShaderMaterial({
      uniforms: fairyUniforms,
      vertexShader: FAIRY_VERTEX_SHADER,
      fragmentShader: FAIRY_FRAGMENT_SHADER,
      // Matching the old MeshBasicMaterial({ transparent: true }) exactly:
      // normal blending, depth test on, depth write on. Both clouds share the
      // one material — the only thing that differed between a bulb and a glow
      // was size and opacity, and both of those are attributes.
      transparent: true
    });
  }
  return fairyMaterial;
}

function buildFairyCloud(total) {
  const counts = fairyCounts(total);
  const n = counts.reduce((a, b) => a + b, 0);

  // Per-light values, shared by both clouds so a glow always sits exactly on
  // its bulb — the old code guaranteed that with glow.position.copy(bulb) every
  // frame; here they simply evaluate the same drift from the same numbers.
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const bulbOpacity = new Float32Array(n);
  const glowOpacity = new Float32Array(n);
  const twinkle = new Float32Array(n * 2);
  const drift = new Float32Array(n * 2);

  let i = 0;
  FAIRY_POPULATIONS.forEach((pop, gi) => {
    const c = fairyOutputColor(pop.color);
    for (let k = 0; k < counts[gi]; k++, i++) {
      // random position in a spherical shell around the viewer
      const r = pop.radiusMin + Math.random() * (pop.radiusMax - pop.radiusMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      position[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      position[i * 3 + 1] = r * Math.cos(phi);
      position[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;

      bulbOpacity[i] = 0.6 + Math.random() * 0.35;
      glowOpacity[i] = FAIRY_GLOW_OPACITY;
      twinkle[i * 2]     = 0.4 + Math.random() * 1.4;
      twinkle[i * 2 + 1] = Math.random() * Math.PI * 2;
      drift[i * 2]       = 0.05 + Math.random() * 0.12;
      drift[i * 2 + 1]   = Math.random() * Math.PI * 2;
    }
  });

  const material = getFairyMaterial();

  const makeCloud = (opacity, worldRadius, renderOrder) => {
    const geo = new THREE.BufferGeometry();
    const size = new Float32Array(n).fill(worldRadius * 2); // attribute is a diameter
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1));
    geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 2));
    geo.setAttribute('aDrift', new THREE.BufferAttribute(drift, 2));
    // Set by hand rather than computed lazily: the shader displaces every point
    // by up to 0.4 per axis, which a bounding sphere fitted to the *base*
    // positions doesn't know about. (The camera is inside the shell, so this
    // never actually culls — it just stops a future change from popping.)
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += 0.7;

    const points = new THREE.Points(geo, material);
    points.renderOrder = renderOrder;
    return points;
  };

  /* renderOrder, rather than trusting the default sort. three orders transparent
     objects back-to-front by the *object's* origin, and both clouds sit at the
     scene origin — 1.2 below the camera, not where any individual light is — so
     their sort key is meaningless here and can land either side of the cards'
     depending on which way you happen to be looking. Losing that coin toss puts
     the whole cloud in front: a light nearer than a card writes depth first, the
     card then fails the depth test across that disc, and you get a hole in the
     card with the sky showing through it. Drawing the lights last is both
     deterministic and what 240 individually-sorted meshes worked out to anyway.
     Glows after bulbs, matching the old add order — equal depths pass three's
     LessEqual depth func, so the halo lands over its bulb exactly as before. */
  const bulbs = makeCloud(bulbOpacity, FAIRY_BULB_RADIUS, 1);
  const glows = makeCloud(glowOpacity, FAIRY_GLOW_RADIUS, 2);
  fairyGroup.add(bulbs);
  fairyGroup.add(glows);

  updateFairyScale();
}

// The pre-Phase-3 implementation, kept as the fallback for a driver that can't
// compile the ShaderMaterial. Unchanged apart from taking its segment count
// from the live quality path, as it always did.
function createFloatingLights(count, color, radiusMin, radiusMax) {
  const segments = currentTier() === 'low' ? 5 : 8;
  const bulbGeo = new THREE.SphereGeometry(FAIRY_BULB_RADIUS, segments, segments);
  const glowGeo = new THREE.SphereGeometry(FAIRY_GLOW_RADIUS, segments, segments);

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
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: FAIRY_GLOW_OPACITY });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.copy(pos);
    bulb.userData.glow = glow;
    fairyGroup.add(glow);
  }
}

function buildFairyMeshes(total) {
  const counts = fairyCounts(total);
  FAIRY_POPULATIONS.forEach((pop, gi) => {
    createFloatingLights(counts[gi], pop.color, pop.radiusMin, pop.radiusMax);
  });
}

function clearFairyLights() {
  const materials = new Set();
  fairyGroup.children.slice().forEach((obj) => {
    fairyGroup.remove(obj);
    obj.geometry.dispose();
    materials.add(obj.material);
  });
  // The two clouds share one material and every mesh bulb/glow has its own, so
  // dedupe before disposing — disposing the shared one twice would decrement
  // three's program reference count past zero.
  materials.forEach((mat) => {
    if (mat !== fairyMaterial) mat.dispose(); // the cloud's material survives a rebuild
  });
}

/* 'points' is the shader cloud; 'meshes' is the fallback. */
let fairyMode = 'points';
let fairyCount = quality.fairyLights;

/* Rebuild the fairy lights at a new count, disposing what was there. This is
   the entry point applyQualityTier() below uses — the same shape as the star
   field's rebuild beside it, and the reason Phase 3 came before Phase 4:
   before this, the lights were built at module load and the quality path
   could not touch them at all, so a device the benchmark correctly called
   slow still paid for all 120. */
export function setFairyLightCount(total) {
  fairyCount = total;
  clearFairyLights();
  if (fairyMode === 'points') buildFairyCloud(total);
  else buildFairyMeshes(total);
}

/* How a failed shader compile is detected — and why not a try/catch around the
   constructor. three doesn't throw on a bad program: WebGLProgram logs the
   driver's error and leaves the material drawing nothing, and the check is
   lazy, deferred to the program's first use, so nothing to catch exists at
   construction time. What three does offer is renderer.debug.onShaderError, its
   public hook for exactly this. We install it permanently and identify our own
   program by looking for FAIRY_SHADER_SENTINEL in the failing shader's source
   (via gl.getShaderSource) rather than by matching against renderer internals,
   so it keeps working across a three upgrade — and it fires on the first real
   frame even if the probe below misses. The swap is deferred to a macrotask
   because the hook runs *inside* the renderer, mid-program-setup, and disposing
   the material it is currently binding is asking for trouble. */
let fairyShaderFailed = false;

function fallbackToMeshLights() {
  if (fairyMode === 'meshes') return;
  console.warn('Fairy-light shader failed to compile — falling back to meshes.');
  clearFairyLights();
  fairyMaterial?.dispose();
  fairyMaterial = null;
  fairyMode = 'meshes';
  buildFairyMeshes(fairyCount);
}

renderer.debug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {
  const src = (gl.getShaderSource(glVertexShader) || '') + (gl.getShaderSource(glFragmentShader) || '');
  if (src.includes(FAIRY_SHADER_SENTINEL)) {
    if (!fairyShaderFailed) {
      fairyShaderFailed = true;
      setTimeout(fallbackToMeshLights, 0);
    }
    return;
  }
  // Installing the hook suppresses three's own console.error for *every*
  // program, so anything that isn't ours still has to be reported.
  console.error('THREE.WebGLProgram: shader error\n', gl.getProgramInfoLog(program));
};

// Compile the cloud's program up front so a failure is caught before the first
// planet rather than showing an empty sky for a frame. The compile runs against
// a throwaway Scene holding just the two clouds — renderer.compile() walks
// whatever scene it is given, and dragging the sky, stars, cards and portals
// into a module-load compile is precisely the load-time cost Phase 2 removed.
// r160 links the program during compile() but defers the link-status check to
// the program's first getUniforms(), so nudge that too; both steps are
// best-effort, with the onShaderError hook above as the real safety net.
function probeFairyShader() {
  if (fairyMode !== 'points') return;
  const parked = fairyGroup.children.slice();
  try {
    const probe = new THREE.Scene();
    parked.forEach((obj) => probe.add(obj));
    renderer.compile(probe, camera);
    renderer.properties.get(fairyMaterial)?.currentProgram?.getUniforms?.();
  } catch (e) {
    console.warn('Fairy-light shader probe failed', e);
    fairyShaderFailed = true;
  }
  parked.forEach((obj) => fairyGroup.add(obj)); // back out of the probe scene
  if (fairyShaderFailed) fallbackToMeshLights();
}

setFairyLightCount(fairyCount);
probeFairyShader();

/* ============================================================
   MEMORY CARD CREATION (polaroid sprites)
============================================================ */
const cardGroup = new THREE.Group();
scene.add(cardGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/* ----- Ring layout -----
   Stars spread evenly around the viewer: one row at eye level up to
   ROW_CAPACITY, two rows past that. Both rows use the *same* angular step,
   so stars line up in columns and a partly-filled second row simply leaves
   its last slot empty instead of drifting out of phase with the row above.

   The layout is a function of how many stars are in the ring, not of each
   star's arrival order, so everything is re-spaced whenever that count
   changes (applyRingLayout below). A half-full moon therefore spreads
   across the whole circle instead of bunching up with a gap behind you, and
   deleting a star closes its gap rather than leaving a hole.

   What this replaces: 8 stars per level across 4 fixed heights, where levels
   0 and 2 landed on the *same* angles only 1.6 apart with cards 1.8 tall —
   so every level-2 card overlapped a level-0 card. That was the stacking. */
const RING_RADIUS = 8.2;
const ROW_CAPACITY = 18;            // stars in one row before a second row opens
const ONE_ROW_HEIGHT = 1.2;         // the camera's own eye level
const TWO_ROW_HEIGHTS = [2.3, 0.1]; // 2.2 apart for cards 1.8 tall → a 0.4 gap

// Widest a gap between neighbouring stars is allowed to get. Dividing the full
// circle by the count alone is even but goes hollow when a moon is only part
// full — 7 stars would sit 51° apart, one per screenful, and you'd spin all the
// way round to see them. Past this the ring stops wrapping and becomes an arc
// centred on where you're facing when you arrive, so a small collection reads
// as a small collection. A full moon's natural step is below this, so it
// still closes into a complete circle.
const MAX_ANGULAR_STEP = (26 * Math.PI) / 180;

function ringSlot(index, total, jitter) {
  const rows = total > ROW_CAPACITY ? 2 : 1;
  const heights = rows === 2 ? TWO_ROW_HEIGHTS : [ONE_ROW_HEIGHT];
  const perRow = Math.ceil(total / rows);

  const step = Math.min((Math.PI * 2) / perRow, MAX_ANGULAR_STEP);
  // column-major, so the rows stay balanced and vertically aligned
  const col = Math.floor(index / rows);
  const angle = (col - (perRow - 1) / 2) * step;
  const r = RING_RADIUS + jitter.r;

  return {
    pos: new THREE.Vector3(
      Math.sin(angle) * r,
      heights[index % rows] + jitter.y,
      Math.cos(angle) * r
    ),
    angle
  };
}

// Per-star offsets, rolled once at creation and reused on every re-layout, so
// the ring keeps a little hand-placed looseness without the stars twitching
// each time one is added or removed.
function makeStarJitter() {
  return {
    r: (Math.random() - 0.5) * 0.24,
    y: (Math.random() - 0.5) * 0.1,
    tilt: (Math.random() - 0.5) * 0.1
  };
}

// Re-spaces everything currently in the ring for the count it now holds.
function applyRingLayout() {
  const total = cardGroup.children.length;
  cardGroup.children.forEach((mesh, i) => {
    const { pos, angle } = ringSlot(i, total, mesh.userData.jitter);
    mesh.position.copy(pos);
    mesh.rotation.y = angle + Math.PI; // face the center of the ring
    mesh.userData.basePos = pos.clone();
    mesh.userData.baseRotY = mesh.rotation.y;
  });
}

/* ============================================================
   TEXTURE CACHE — in-memory Map<memoryId, CanvasTexture>, scoped to
   this page session. Re-entering a previously visited planet skips
   regenerating (canvas-drawing) unchanged memories' textures.
   NOTE (Phase 7): memory editing evicts the relevant entry via
   updateMemoryInScene() below, so a cache hit always reflects the
   memory's current saved content.
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

  mesh.userData.jitter = makeStarJitter();
  mesh.rotation.z = mesh.userData.jitter.tilt;
  mesh.userData.baseRotZ = mesh.rotation.z;
  mesh.userData.bobOffset = Math.random() * Math.PI * 2;
  mesh.userData.bobSpeed = 0.4 + Math.random() * 0.3;
  mesh.userData.memory = memory;

  cardGroup.add(mesh);
  memory.mesh = mesh;

  // Position comes from the ring's new total, so the stars already up there
  // shuffle over to make room evenly rather than this one landing on a slot
  // sized for a ring that no longer exists.
  applyRingLayout();

  document.getElementById('emptyHint').classList.add('hidden');
}

// Regenerates a memory's card texture in place after an edit (title, text,
// photo, audio, milestone, and relatedIds can all change what the card
// looks like -- e.g. the milestone star cutout from Phase 6) and swaps it
// onto the existing mesh, without touching ring position/index (content and
// layout are unrelated). Evicts the stale cache entry first: cacheTexture()
// always marks a texture cached, so getCachedTexture() must not keep
// returning the pre-edit drawing on a later re-render of this moon.
export function updateMemoryInScene(memory) {
  textureCache.delete(memory.id);
  if (!memory.mesh) return; // edited memory isn't on the viewed moon right now -- nothing to redraw
  const newTex = makePolaroidTexture(memory);
  // The old map was this memory's sole reference in the (now-evicted) cache
  // entry, so it's safe to dispose outright here, unlike disposeCardMesh's
  // conditional dispose (which must NOT dispose a still-cached texture that
  // other code may still be pointing at).
  memory.mesh.material.map?.dispose();
  memory.mesh.material.map = newTex;
  memory.mesh.material.needsUpdate = true;
  memory.mesh.userData.memory = memory;
  cacheTexture(memory.id, newTex);
}

/* ============================================================
   LOADING PLACEHOLDERS — shown at ring positions while a planet's
   memories are being fetched, so entering a planet never shows a
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

    mesh.userData.jitter = makeStarJitter();
    mesh.userData.baseRotZ = 0;
    mesh.userData.bobOffset = Math.random() * Math.PI * 2;
    mesh.userData.bobSpeed = 0.4 + Math.random() * 0.3;

    cardGroup.add(mesh);
    loadingPlaceholders.push(mesh);
  }
  applyRingLayout();
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
// placeholders) without touching `memories` — used both when leaving a planet
// and when travelling to another of its moons.
function clearRenderedStars() {
  cardGroup.children.slice().forEach((mesh) => {
    disposeCardMesh(mesh);
    cardGroup.remove(mesh);
    if (mesh.userData.memory) mesh.userData.memory.mesh = null;
  });
  loadingPlaceholders = [];
}

// Remove all memory cards from the scene and reset state, ready for a
// different planet's memories to be loaded in.
export function clearGalleryScene() {
  clearRenderedStars();
  memories.length = 0;
  setCurrentMoons([]);
  setCurrentMoonIndex(0);
  updatePortals();
  updateMoonLabel();
  document.getElementById('emptyHint').classList.remove('hidden');
}

// How many stars are actually in the ring right now — i.e. the viewed
// moon's, not the whole planet's.
export function renderedStarCount() {
  return cardGroup.children.length;
}

// Picks the subset of a planet's memories that belongs in the ring: the ones
// filed onto the viewed moon. Two fallbacks keep a planet from ever
// rendering an empty ring when it has stars to show:
//  - no moons at all (nothing has been filed yet) → render everything;
//  - a star with no moonId (predates moons, backfill not run) → treat it
//    as belonging to the oldest moon.
function starsOnViewedMoon(all, moons, moonIndex) {
  if (moons.length === 0) return all;
  const viewed = moons.find((p) => p.index === moonIndex);
  if (!viewed) return [];
  return all.filter((m) => (
    m.moonId ? m.moonId === viewed.id : viewed.index === 0
  ));
}

/* ============================================================
   MOON PORTALS — two markers sitting just outside the card ring,
   left and right of where you enter, for travelling between a
   planet's moons. They live in their own group so the ring's own
   bookkeeping (slot index, renderedStarCount) still counts stars only.
   The "next" portal is shown greyed/locked when no successor moon
   exists yet; "previous" only appears when there's an earlier moon
   and is never locked.
============================================================ */
const portalGroup = new THREE.Group();
scene.add(portalGroup);

// Nothing else in the scene reacts to lights — cards, fairy lights and the
// background sky are all MeshBasicMaterial — so this only shapes the portal
// moons, which are the one lit surface here.
//
// It sits above the middle of the ring, i.e. above the viewer, because both
// portals hang off to the sides: lighting from there catches the hemisphere
// each one turns toward you, with the terminator falling just below centre.
// A directional light aimed from one side left whichever moon faced away
// from it as a near-black disc. decay 0 keeps it from falling off over the
// 26 units out to the portals.
const portalSun = new THREE.PointLight(0xfff2dd, 2.4, 0, 0);
portalSun.position.set(0, 14, 0);
scene.add(portalSun);

/* Vertical budget, since it's tight: the top row of stars tops out around 13.7°
   of elevation and the camera's 55° vertical FOV reaches 27.5°, leaving a ~14°
   band of clear sky. The moon is sized and placed to sit fully inside it
   (15°–26°) so it's in view without tilting; its caption plate rides just above
   that, which is the one part you tilt up a few degrees to read. Below the
   moon was tried first and is worse — the plate lands inside the card band
   and gets occluded by the ring. */
const PORTAL_DISTANCE = 26;                        // well beyond the 8.2 card ring
const PORTAL_ELEVATION = (20.5 * Math.PI) / 180;
const PORTAL_BODY_RADIUS = 2.7;                    // ~11° across: a big distant world
const PORTAL_ANGLES = { prev: -Math.PI * (100 / 180), next: Math.PI * (100 / 180) };

function makePortalObject(kind) {
  const group = new THREE.Group();
  const angle = PORTAL_ANGLES[kind];
  group.position.set(
    Math.sin(angle) * PORTAL_DISTANCE,
    camera.position.y + PORTAL_DISTANCE * Math.tan(PORTAL_ELEVATION),
    Math.cos(angle) * PORTAL_DISTANCE
  );
  group.rotation.y = angle + Math.PI; // turns the caption plate to face the viewer
  group.visible = false;
  portalGroup.add(group);

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(PORTAL_BODY_RADIUS, 48, 32),
    new THREE.MeshLambertMaterial({ transparent: true })
  );
  body.userData.portal = kind;
  group.add(body);

  // thin shell of atmosphere, seen edge-on around the limb
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(PORTAL_BODY_RADIUS * 1.14, 32, 24),
    new THREE.MeshBasicMaterial({
      side: THREE.BackSide, transparent: true, opacity: 0.2, depthWrite: false
    })
  );
  group.add(halo);

  const labelWidth = PORTAL_BODY_RADIUS * 2.2;
  const label = new THREE.Mesh(
    // 2:1, matching makePortalLabelTexture's canvas, so the text isn't squashed
    new THREE.PlaneGeometry(labelWidth, labelWidth / 2),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
  );
  // Beside the moon, not above or below it. Stacking doesn't fit: the clear
  // sky between the top row of stars (13.7°) and the top of the view (27.5°)
  // is only about 14° tall, which the moon alone nearly fills — above put
  // the caption off-screen, below put it behind the ring. Sideways is free.
  // Local +x runs toward *decreasing* azimuth once the group is turned to face
  // the viewer, so the sign here keeps both captions on their inward side.
  label.position.x = (kind === 'next' ? 1 : -1) * (PORTAL_BODY_RADIUS + labelWidth / 2 + 0.3);
  label.userData.portal = kind;
  group.add(label);

  return {
    kind, group, body, halo, label,
    spin: kind === 'next' ? 0.012 : -0.009,
    locked: false,
    targetIndex: null,
    nudgeStart: 0
  };
}

const portals = { prev: makePortalObject('prev'), next: makePortalObject('next') };

function setPortalAppearance(portal, { caption, label, locked }) {
  const color = currentPlanet?.accentColor || '#ffd9a0';

  const oldSurface = portal.body.material.map;
  portal.body.material.map = makeMoonSurfaceTexture({ color, locked });
  // A locked moon is a ghost of a world, but still has to read as one — at
  // half opacity over a starfield it disappeared and left the caption floating.
  portal.body.material.opacity = locked ? 0.72 : 1;
  portal.body.material.needsUpdate = true;
  oldSurface?.dispose();

  const oldLabel = portal.label.material.map;
  portal.label.material.map = makePortalLabelTexture({ caption, label, locked });
  portal.label.material.needsUpdate = true;
  oldLabel?.dispose();

  // an unformed moon gets no atmosphere — it reads as a ghost of a world
  portal.halo.visible = !locked;
  portal.halo.material.color.set(color);
  portal.locked = locked;
}

// Rebuilds both portals from the current moon list and viewed index. A
// planet with no moon records at all shows neither: the ring isn't
// moon-filtered in that case (see starsOnViewedMoon), so there's nowhere
// to travel to.
function updatePortals() {
  if (currentMoons.length === 0) {
    portals.prev.group.visible = false;
    portals.next.group.visible = false;
    return;
  }

  const earlier = currentMoons.filter((p) => p.index < currentMoonIndex);
  const prev = earlier[earlier.length - 1];
  const next = currentMoons.find((p) => p.index > currentMoonIndex);

  portals.prev.group.visible = !!prev;
  if (prev) {
    portals.prev.targetIndex = prev.index;
    setPortalAppearance(portals.prev, {
      caption: 'previous moon', label: prev.name, locked: false
    });
  }

  portals.next.group.visible = true;
  portals.next.targetIndex = next ? next.index : null;
  setPortalAppearance(portals.next, next
    ? { caption: 'next moon', label: next.name, locked: false }
    : { caption: 'next moon', label: 'not formed yet', locked: true });
}

// Small "you're here" readout in the topbar — without it the portals tell you
// where you can go but not where you are. Hidden for a planet that only has
// the one moon, where there's nothing to disambiguate.
function updateMoonLabel() {
  const el = document.getElementById('moonLabel');
  if (!el) return;
  const pos = currentMoons.findIndex((p) => p.index === currentMoonIndex);
  if (currentMoons.length < 2 || pos === -1) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = `✦ ${currentMoons[pos].name} · moon ${pos + 1} of ${currentMoons.length}`;
  el.classList.remove('hidden');
}

// Swap which moon's stars are in the ring. `memories` (the planet's stars
// across every moon) is deliberately left alone — only the meshes change.
export function showMoon(moonIndex) {
  clearRenderedStars();
  setCurrentMoonIndex(moonIndex);

  starsOnViewedMoon(memories, currentMoons, moonIndex).forEach((mem) => {
    addMemoryToScene(mem);
    // a cache hit already has its final texture (photo decoded and all) —
    // no need to re-decode the image and regenerate it
    if (!getCachedTexture(mem.id)) loadPhotoImgFor(mem);
  });

  updatePortals();
  updateMoonLabel();
  document.getElementById('emptyHint').classList.toggle('hidden', renderedStarCount() > 0);
}

// Places a newly-created star. Which moon it belongs to is the server's
// call (it files new stars onto the planet's newest moon, creating the next
// one past the cap), so the moon list is refetched and the star only joins
// the ring if it landed on the moon being viewed. Returns the moon it
// landed on, or null if that couldn't be determined.
export async function placeNewStar(memory) {
  try {
    setCurrentMoons(await loadMoons(currentPlanetId));
  } catch (e) {
    console.warn('Could not refresh moons', e);
  }

  const viewed = currentMoons.find((p) => p.index === currentMoonIndex);
  // No moonId (a save the server never assigned) or no moons at all means
  // the ring isn't moon-filtered — show it either way.
  if (!memory.moonId || !viewed || memory.moonId === viewed.id) {
    addMemoryToScene(memory);
  }

  updatePortals();
  updateMoonLabel();
  return currentMoons.find((p) => p.id === memory.moonId) || null;
}

// Callback invoked with the target moon index when an unlocked portal is
// clicked. Wired up by planetPicker.js (which owns the transition) rather
// than imported from there, to avoid a circular import.
let onPortalClick = null;
export function setOnPortalClick(fn) {
  onPortalClick = fn;
}

function handlePortalClick(portal) {
  if (portal.locked) {
    // Nothing to travel to yet — acknowledge the click instead of ignoring it.
    portal.nudgeStart = performance.now();
    return;
  }
  if (onPortalClick) onPortalClick(portal.targetIndex);
}

// Load a planet's memories into the (already-cleared) scene. Every memory goes
// into the shared `memories` state, but only the viewed moon's are rendered.
export async function loadPlanetMemories(planetId) {
  let restored = [];
  let moons = [];
  try {
    [restored, moons] = await Promise.all([
      loadAllMemories(planetId),
      loadMoons(planetId)
    ]);
  } catch (e) {
    console.warn('Could not load memories', e);
    showStorageWarning('couldn\'t reach the gallery server — check that "npm start" is running, then reload.');
  }
  setCurrentMoons(moons);

  clearLoadingPlaceholders();
  restored.forEach((mem) => memories.push(mem));

  // A planet always opens on its oldest moon.
  showMoon(moons.length > 0 ? moons[0].index : 0);
}

// Removes a single memory's mesh from the scene (disposing its GPU
// resources) without touching the `memories` array.
export function removeMemoryFromScene(memory) {
  if (memory.mesh) {
    disposeCardMesh(memory.mesh);
    cardGroup.remove(memory.mesh);
    memory.mesh = null;
    applyRingLayout(); // close the gap rather than leaving a hole in the ring
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
  const portalTargets = Object.values(portals)
    .filter((p) => p.group.visible)
    .flatMap((p) => [p.body, p.label]);
  const intersects = raycaster.intersectObjects(cardGroup.children.concat(portalTargets));
  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    if (mesh.userData.portal) {
      handlePortalClick(portals[mesh.userData.portal]);
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
let TARGET_FPS = quality.targetFps;
let FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastFrameTime = 0;

/* ----- Why there are two pause flags and not one -----
   Two entirely independent things can mean "don't draw": the tab is hidden,
   and the planet view isn't the screen the user is looking at. They start and
   stop on their own schedules — hide the tab while sitting in the picker and
   both are true at once — so they get one boolean each. Collapsing them into a
   single flag means whichever reason clears last un-pauses the scene while the
   other still stands, which is exactly how a hidden tab ends up rendering a
   planet nobody is looking at. `animPaused` is the *derived* value: the loop
   and sceneStats() read it, updatePauseState() is the only thing that writes it.

   The view flag starts true. Before Plan 3 the scene rendered from module load
   — behind the opaque entry screen and behind the whole picker, which is a
   solar system in DOM, not this 3D scene. Nothing between load and entering a
   planet needs a frame, so nothing gets one. */
let pausedForHiddenTab = false;
let pausedForHiddenView = true;
let animPaused = true;

/* Moves the live renderer onto a tier. Everything touched here can change
   on a running context; `antialias` is the one setting that cannot (see the
   note at the top of this file), so a tier change that crosses that line
   only completes on the next load — which is why the entry screen's
   selector persists the choice as well as applying it, and says so.

   Both rebuilds dispose what they replace, which is this phase's acceptance
   check: renderer.info.memory.textures/.geometries has to come back to a
   comparable level after a tier change rather than creeping up by a star
   field and two point clouds every time one happens. */
let appliedTier = currentTier();

function applyQualityTier(tier) {
  if (tier === appliedTier) return; // nothing this module owns has changed
  appliedTier = tier;
  quality = tierSettings(tier);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
  TARGET_FPS = quality.targetFps;
  FRAME_INTERVAL = 1000 / TARGET_FPS;

  const oldStars = stars;
  stars = createStars(quality.distantStars);
  scene.add(stars);
  scene.remove(oldStars);
  oldStars.geometry.dispose();
  oldStars.material.dispose();

  // Phase 3 made this reachable at runtime; before it, the lights were built
  // at module load and a slow device kept all 120 of them.
  setFairyLightCount(quality.fairyLights);
  // Point size is in device pixels, so the new pixel ratio changes it.
  updateFairyScale();

  // The tier table also carries a card-texture size and hyperspace star
  // counts. Nothing reads them here on purpose: a card's texture is baked
  // when the card is built (Phase 6's job, in cards.js) and the hyperspace
  // canvas belongs to planetPicker.js (Phase 8's).

  // Rebuilding two point clouds and a star field costs a frame or two, and
  // the new tier deserves to be judged on its own frames rather than on the
  // hitch of arriving.
  resetTierSampling();
}

// The entry screen's selector and the rolling measurement below both reach
// the renderer through here. A subscription rather than a direct call so
// quality.js never has to import this module — it must stay ahead of the
// renderer's construction, and a cycle would put it behind.
onTierChange(applyQualityTier);

/* ----- Rolling downgrade, replacing the one-shot 60-frame benchmark -----
   A time-constant exponential moving average of frame time; if it stays bad
   for TIER_SUSTAIN_MS the tier steps down exactly one place, and the verdict
   is persisted so this machine never pays the learning cost again. It never
   steps back *up*: quality that oscillates reads far worse than quality that
   is one tier low, and a machine that recovers for two seconds has told you
   nothing about the next thirty.

   Why it can't fire during load. Sampling only happens below the pause check
   — a paused frame does no work and would benchmark the scene as
   blisteringly fast while drawing nothing — and since Phase 2 the loop only
   runs frames inside a planet at all. So "after load" now means "after the
   first planet is entered", and the expensive part of entering a planet
   (texture generation, image decodes, the hyperspace canvas still running)
   lands in exactly the first second of that. Hence TIER_WARMUP_MS of
   *rendered* time is discarded after every resume, not just the first: every
   planet entry has the same hitch, and none of them is evidence.

   Why the threshold is 1.8× the target interval (30ms against a 60fps
   target) and not the old benchmark's 22ms: the loop throttles with
   `now - lastFrameTime < FRAME_INTERVAL`, and on a display running at
   exactly the target rate the timestamp lands either side of that boundary
   by fractions of a millisecond, so a perfectly healthy machine skips the
   odd frame and averages ~25ms. A 22ms line would read that as failure and
   downgrade a machine that was keeping up. 30ms is below any real 60fps
   average and above that artifact. */
const TIER_WARMUP_MS = 4000;    // rendered time ignored after every resume
const TIER_SUSTAIN_MS = 2000;   // how long "bad" must hold before stepping down
const TIER_EMA_TAU_MS = 500;    // the average's time constant
const TIER_BAD_FACTOR = 1.8;    // multiple of the target frame interval that counts as bad

let tierWarmupLeft = TIER_WARMUP_MS;
let tierFrameAvg = 0;
let tierBadMs = 0;

function resetTierSampling() {
  tierWarmupLeft = TIER_WARMUP_MS;
  tierFrameAvg = 0;
  tierBadMs = 0;
}

function sampleFrameTime(frameDelta) {
  // A tier the user named by hand (the selector, or ?quality=) is never
  // quietly moved, and prefers-reduced-motion is already at the bottom.
  if (!autoTierAllowed()) return;
  const next = nextTierDown();
  if (!next) return;

  if (tierWarmupLeft > 0) {
    tierWarmupLeft -= frameDelta;
    return;
  }

  // Weighting by the frame's own duration rather than by frame count keeps
  // the average's memory measured in milliseconds, so it means the same
  // thing at 60fps and at 12.
  const alpha = Math.min(frameDelta / TIER_EMA_TAU_MS, 1);
  tierFrameAvg = tierFrameAvg ? tierFrameAvg + (frameDelta - tierFrameAvg) * alpha : frameDelta;

  if (tierFrameAvg > FRAME_INTERVAL * TIER_BAD_FACTOR) {
    tierBadMs += frameDelta;
    if (tierBadMs >= TIER_SUSTAIN_MS) {
      // → quality.js persists it and notifies → applyQualityTier above.
      recordMeasuredTier(next);
      resetTierSampling(); // belt and braces if the tier didn't actually move
    }
  } else {
    tierBadMs = 0;
  }
}

// Live renderer/scene counters for the perf HUD (perfHud.js, ?perf=1 only).
// An accessor rather than exporting the renderer itself, so the HUD can read
// what it needs without anything else gaining a handle on the WebGL context.
// `tier` is quality.js's label: the real tier name, suffixed with how it was
// arrived at unless that was simply the default — "(forced)" still means a
// ?quality= override specifically, as it did before Phase 4.
export function sceneStats() {
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    textures: renderer.info.memory.textures,
    geometries: renderer.info.memory.geometries,
    renderedStars: renderedStarCount(),
    tier: tierLabel(),
    paused: animPaused
  };
}

// Called at the end of every rendered frame with (frameDelta, now). One slot
// is enough for its only consumer, the perf HUD; Phase 8 grows this into a
// proper registry and moves the card-flip tween onto it, so mesh mutation and
// rendering finally share a cadence.
let onFrame = null;
export function setOnFrame(fn) {
  onFrame = fn;
}

// Recomputes animPaused from the two reasons above and handles the edges of
// the transition. Only ever called after one of the reasons changes.
function updatePauseState() {
  const paused = pausedForHiddenTab || pausedForHiddenView;
  if (paused === animPaused) return;
  animPaused = paused;

  if (paused) {
    // WebGLRenderer.render() resets renderer.info at the *start* of a render,
    // so simply not calling render() leaves the draw-call and triangle counters
    // frozen at whatever the last drawn frame cost. The perf HUD would go on
    // reporting a full scene's worth of draw calls for a scene that isn't being
    // drawn at all — the opposite of what this phase is for. Resetting once on
    // the way in makes "paused" read honestly as 0.
    renderer.info.reset();
    return;
  }

  lastFrameTime = 0; // reset so a long pause doesn't arrive as one huge delta

  // Entering a planet is the most expensive moment the scene has — textures
  // generated, photos decoded, a hyperspace canvas still animating over the
  // top — and this is the exact instant it starts. Throw away the next few
  // seconds of frames rather than letting the cost of arriving be mistaken
  // for the cost of being here.
  resetTierSampling();

  // Draw exactly one frame right now rather than waiting for the next rAF
  // tick. Resuming happens at the *midpoint* of the hyperspace whiteout, and
  // the ring needs to already be there when the whiteout clears; one frame's
  // wait is a visible blank flash on a machine throttled to 30fps. No onFrame
  // callback for this one — it's a catch-up draw, not a loop tick, and feeding
  // the HUD a frame with no delta would only muddy its average.
  renderer.render(scene, camera);
}

// Pause rendering when the tab is hidden to save CPU/GPU.
document.addEventListener('visibilitychange', () => {
  pausedForHiddenTab = document.hidden;
  updatePauseState();
});

/* Stop / start drawing because of *which screen is up*, independent of tab
   visibility. Called from planetPicker.js, which owns the hyperspace
   transition and therefore knows the exact moment the screen is covered:
   resume at the midpoint of entering a planet, pause at the midpoint of
   going back to the picker. Travelling between moons stays inside the planet
   view and deliberately touches neither. */
export function pauseScene() {
  pausedForHiddenView = true;
  updatePauseState();
}

export function resumeScene() {
  pausedForHiddenView = false;
  updatePauseState();
}

function animate(now = 0) {
  requestAnimationFrame(animate);
  // Bailing here rather than just before renderer.render() is the point: the
  // bob/spin/twinkle work below mutates hundreds of objects and is the larger
  // half of the cost. The rAF chain itself is kept alive so resuming is a flag
  // flip rather than a restart.
  if (animPaused) return;

  // Throttle to TARGET_FPS
  if (now - lastFrameTime < FRAME_INTERVAL) return;
  const frameDelta = lastFrameTime ? now - lastFrameTime : 0;
  lastFrameTime = now;

  // Ignore a stray huge gap (e.g. right after a visibilitychange resume)
  // so it doesn't skew the average toward a false downgrade.
  if (frameDelta > 0 && frameDelta < 200) sampleFrameTime(frameDelta);

  const t = clock.getElapsedTime();

  yaw += (targetYaw - yaw) * 0.08;
  pitch += (targetPitch - pitch) * 0.08;
  updateCameraFromAngles();

  // OS-level prefers-reduced-motion slows/pauses the ambient drift
  // animations below — 1 is full motion, near-0 is nearly still.
  const motionDamp = prefersReducedMotion() ? 0.12 : 1;

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

  // portal moons turn slowly on their axis; a locked one gets a brief
  // swell when clicked, so the click reads as heard rather than ignored
  Object.values(portals).forEach((portal) => {
    if (!portal.group.visible) return;
    portal.body.rotation.y += portal.spin * motionDamp;

    let swell = 1;
    if (portal.nudgeStart) {
      const e = (performance.now() - portal.nudgeStart) / 420;
      if (e >= 1) portal.nudgeStart = 0;
      else swell = 1 + Math.sin(e * Math.PI) * 0.07;
    }
    portal.group.scale.setScalar(swell);
  });

  // twinkle + drift floating lights. On the shader path this is the whole of
  // it: two uniform writes, and the GPU evaluates the same drift and twinkle
  // per point that the loop below used to evaluate per object on the CPU.
  if (fairyMode === 'points') {
    fairyUniforms.uTime.value = t;
    fairyUniforms.uMotionDamp.value = motionDamp;
  } else {
    // Fallback path only (a driver that couldn't compile the shader): the
    // original per-object loop, unchanged.
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
          obj.userData.glow.material.opacity = FAIRY_GLOW_OPACITY * flick;
          obj.userData.glow.position.copy(obj.position);
        }
      }
    });
  }

  // gentle star twinkle via scene rotation
  stars.rotation.y = t * 0.005 * motionDamp;

  renderer.render(scene, camera);

  // After the render, so the frame's draw-call/triangle counts are the ones
  // the HUD reports rather than the previous frame's.
  if (onFrame) onFrame(frameDelta, now);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
  // The fairy lights' point size is in device pixels, derived from the drawing
  // buffer height and the FOV — both of which just changed.
  updateFairyScale();
});
