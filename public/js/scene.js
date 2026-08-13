/* ============================================================
   THREE.JS SETUP — renderer/camera/lights/background/animate loop
   (relies on the global THREE set by index.html's <script src="lib/three.min.js">,
   vendored locally since Plan 3 Phase 7 — there is no CDN in this app)
============================================================ */
import {
  makePolaroidTexture,
  makeMoonSurfaceTexture,
  makeBlackHoleTexture,
  makePortalLabelTexture,
  makeCardCanvas,
  cardTextureSize,
  roundRect
} from './cards.js';
import { loadAllMemories, loadMemory, loadMoons } from './api.js';
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
// `label` is aliased because this file already uses that word for the portals'
// caption-plate meshes and for the string drawn on them.
import { label as themeLabel, groupingName, themeConfig, themeFlag, currentTheme, DEFAULT_THEME } from './theme.js';

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
   Plan 1 Phase 14: baked offline by scripts/build-backgrounds.js into image variants
   under public/assets/backgrounds/, loaded here instead of running the same
   canvas-drawing work in every browser on every page load. One is picked at random per
   session for some variety; the smaller dynamic star/fairy-light layers on top (below)
   still keep the sky feeling alive.

   WHICH FAMILY comes from theme.js (Plan 4 Phase 3), not from a list here -- solar
   gets the warm `nebula-*` skies, universe the cool banded `universe-*` ones. Only the
   *family* moved; the random-variant-per-load selection below is the same logic this
   file has always had. Reaching for the registry rather than branching on the theme
   name is the point: a third theme is a registry entry, not an edit to this file.

   The theme is fixed for the life of the page (theme.js's "fixed at load"), so the
   sky can never be the other theme's -- there is nothing to reload here on a theme
   change because a theme change is a reload. ----- */
const bgFamily = themeConfig().backgrounds;
// Degrade to the default theme's family rather than requesting "undefined" if a
// registry entry ever ships without a sky, matching theme.js's own posture that a
// bad theme record falls back instead of throwing mid-render.
const bgPaths = bgFamily && bgFamily.length ? bgFamily : themeConfig(DEFAULT_THEME).backgrounds;
const bgPath = bgPaths[Math.floor(Math.random() * bgPaths.length)];

// .webp, not .png: a fraction of the bytes for art that is generated rather than
// scanned. Plan 4 Phase 3 moved these to lossy q95 (~390kb each, smaller than the
// lossless skies Plan 3 Phase 7 shipped) after checking the failure mode lossy
// actually risks -- banding on the smooth nebula gradients -- rather than assuming
// it; see the WEBP_OPTIONS note in scripts/build-backgrounds.js. The PNGs stay in
// the repo as the lossless source the re-encode reads.
//
// The sky must stay fully OPAQUE (Plan 3 Phase 7): the encoder drops the alpha
// channel, and this material does not enable transparency. Don't composite anything
// behind it -- there is nothing back there.
const bgGeo = new THREE.SphereGeometry(60, 64, 64);
const bgTex = new THREE.TextureLoader().load(bgPath);
bgTex.colorSpace = THREE.SRGBColorSpace;
bgTex.minFilter = THREE.LinearMipmapLinearFilter;
bgTex.magFilter = THREE.LinearFilter;
bgTex.anisotropy = 4;
bgTex.wrapS = THREE.RepeatWrapping;
bgTex.mapping = THREE.EquirectangularReflectionMapping;
const bgMat = new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.BackSide, fog: false });
const bgMesh = new THREE.Mesh(bgGeo, bgMat);
scene.add(bgMesh);

/* ============================================================
   THEMED COLOUR RANGES FOR THE TWO RUNTIME STAR LAYERS (Plan 4 Phase 4)

   Both tables below are a *colour* change and nothing else — same counts,
   same geometry, same draw calls, same per-frame work. Phase 4's whole
   licence in this file is "a uniform change, not a structural one", and the
   acceptance test is that the low tier's average frame time does not move.

   Why the tables live here and not in theme.js's registry, unlike the sky
   family: these are renderer-shaped values (a THREE hex, a per-vertex
   attribute palette) that only this module can consume, and Phase 4's file
   set is scene.js / planetPicker.js / entryScreen.js. Both are keyed by
   theme name with a DEFAULT_THEME fallback, so a registry entry that never
   named a palette degrades to solar's rather than rendering colourless —
   the same posture themeConfig() takes.

   SOLAR'S ENTRIES ARE TODAY'S VALUES, UNCHANGED, and solar must keep coming
   out pixel-identical; see the one-colour branch in createStars() for how
   that is guaranteed by construction rather than by hoping the two paths
   agree.
============================================================ */

/* The distant star field's colour range. Repeats are the weighting — a
   palette is sampled uniformly, so listing a tone twice makes it twice as
   common, which reads more clearly at a glance than a parallel weights
   array.

   Solar is a single warm white, exactly as it has always been. Universe is
   the cool end of the same idea: mostly blue-white and cool blue with a
   little pale cyan and violet, and one warm tone left in — a sky of one
   temperature reads as a gradient rather than as stars. */
const STAR_COLOR_THEMES = {
  solar: [0xffeec2],
  universe: [
    0xdfe9ff, 0xdfe9ff, 0xdfe9ff, 0xdfe9ff,
    0xa9c6ff, 0xa9c6ff, 0xa9c6ff,
    0xbfe9f2, 0xbfe9f2,
    0xc9b8ff, 0xc9b8ff,
    0xffe6c8
  ]
};

function starPalette() {
  return STAR_COLOR_THEMES[currentTheme()] || STAR_COLOR_THEMES[DEFAULT_THEME];
}

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

  const palette = starPalette();

  /* A single-colour palette takes the material-colour path this has always
     used, untouched — no colour attribute, no vertexColors, nothing for the
     "solar is unchanged" claim to be wrong about. A theme opts into the range
     by *having* more than one colour, the same way theme.js lets a theme opt
     into derived grouping names by having a non-empty pool, rather than by
     anything checking for a theme by name. */
  if (palette.length === 1) {
    const mat = new THREE.PointsMaterial({ color: palette[0], size: 0.06, transparent: true, opacity: 0.6 });
    return new THREE.Points(geo, mat);
  }

  /* Per-vertex colours, which is still ONE draw call and one more small
     attribute — the range costs count*3 floats built once per tier change,
     and nothing per frame.

     Colour space: unlike the fairy lights' ShaderMaterial (see
     fairyOutputColor below), this goes through three's built-in points
     shader, which *does* have the output stage. A `color` attribute is read
     as already being in the linear working space, and THREE.Color's
     constructor is exactly the sRGB→linear half — so writing its components
     straight in lands the same value the material-colour branch above hands
     to the same shader. The two branches differ in plumbing, not in result;
     that is why solar can be left on the old one for certainty without the
     new one being suspect. */
  const swatches = palette.map((hex) => new THREE.Color(hex));
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const c = swatches[Math.floor(Math.random() * swatches.length)];
    col[i * 3]     = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.06, transparent: true, opacity: 0.6, vertexColors: true });
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

/* One colour per population, per theme (Plan 4 Phase 4). Solar's three are
   the hexes this file has always used; universe steps the same three shells
   to the cool end — a blue, a blue-white and a soft violet, at the same
   lightness so the lights stay lights rather than becoming dim smudges over
   a near-black sky.

   THIS IS THE ONLY THING THE THEME CHANGES ABOUT THE FAIRY LIGHTS. The
   shares, radii, sizes, opacities, drift and twinkle are all untouched, and
   the colour is consumed at exactly the two places it was before —
   fairyOutputColor() on the shader path and createFloatingLights() on the
   mesh fallback — so both paths are themed by construction and neither
   gained a step. In particular nothing here reintroduces per-object
   animation: the shader still evaluates drift and twinkle on the GPU from
   uTime, and this only changes the constant each point carries. */
const FAIRY_COLOR_THEMES = {
  solar: [0xffd9a0, 0xffe8c0, 0xffcf9a],
  universe: [0x9ec8ff, 0xd8e8ff, 0xb7a4ff]
};

const fairyPalette = FAIRY_COLOR_THEMES[currentTheme()] || FAIRY_COLOR_THEMES[DEFAULT_THEME];

// The three populations, as *shares* of the total so a tier scales them
// together instead of one group vanishing first. At the high tier's 120 they
// come out at exactly the original 50 / 40 / 30 — that is the point, the high
// tier has to be untouched. (medium's 60 → 25/20/15; low's 24 → 10/8/6.)
const FAIRY_POPULATIONS = [
  { share: 50 / 120, radiusMin: 3, radiusMax: 7 },
  { share: 40 / 120, radiusMin: 6, radiusMax: 11 },
  { share: 30 / 120, radiusMin: 4, radiusMax: 9 }
].map((pop, i) => ({ ...pop, color: fairyPalette[i] }));

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
   SHARED CARD GEOMETRY (Plan 3 Phase 6) — every star in the ring, and
   every loading placeholder, is the same rectangle: 1.8 units tall at the
   card texture's aspect ratio. One PlaneGeometry serves all of them rather
   than one per mesh, so renderer.info.memory.geometries stops scaling with
   how many cards are on screen.

   Two things follow from that and are easy to undo by accident:
   - disposeCardMesh() and clearLoadingPlaceholders() must NOT dispose
     mesh.geometry any more. It belongs to this module, not to the mesh, and
     disposing it with the first card removed would take the whole ring's
     geometry down with it.
   - getMeshScreenRect() projects a card's corners from
     mesh.geometry.parameters. PlaneGeometry keeps `parameters` on the
     instance, so sharing one instance keeps that working — every card
     reports the same width/height, which is right, because they are the
     same size.

   The aspect comes from the tier's card texture rather than a literal, so
   the mesh's proportions cannot drift from the drawing's. All three tiers
   are 512:600 today, which makes refitCardGeometry() a no-op in practice;
   it exists so an edit to that table can't silently start stretching cards.
============================================================ */
const CARD_MESH_HEIGHT = 1.8;
let cardAspect = 0;
let cardGeometry = null;

// "Which size are the card textures currently being drawn at" — the thing a
// tier change has to be compared against, since that is the only tier setting
// baked into a drawing rather than read at draw time.
function cardTextureKey() {
  const { width, height } = cardTextureSize();
  return `${width}x${height}`;
}

function buildCardGeometry() {
  const { width, height } = cardTextureSize();
  cardAspect = width / height;
  cardGeometry = new THREE.PlaneGeometry(CARD_MESH_HEIGHT * cardAspect, CARD_MESH_HEIGHT);
}
buildCardGeometry();

function refitCardGeometry() {
  const { width, height } = cardTextureSize();
  if (width / height === cardAspect) return;
  const previous = cardGeometry;
  buildCardGeometry();
  // Everything in the ring — stars and placeholders alike — is pointed at the
  // one geometry, so they all move over together before the old one goes.
  cardGroup.children.forEach((mesh) => { mesh.geometry = cardGeometry; });
  previous.dispose();
}

/* ============================================================
   TEXTURE CACHE — an LRU over Map<memoryId, CanvasTexture>, scoped to
   this page session. Re-entering a previously visited planet skips
   regenerating (canvas-drawing) unchanged memories' textures.
   NOTE (Phase 7): memory editing evicts the relevant entry via
   updateMemoryInScene() below, so a cache hit always reflects the
   memory's current saved content.

   Why it is bounded (Plan 3 Phase 6): it used to grow for every planet
   visited and never shrink, so a long session accumulated every card of
   every planet ever opened — 512×600×4 bytes of texture memory apiece at
   the high tier, ~1.2MB each before mipmaps. The cap is two full moons'
   worth (MOON_STAR_CAP is 28), which comfortably covers the ring plus the
   moon you just came from, so travelling back and forth between two
   adjacent moons still hits the cache every time.

   Eviction and the dispose contract. cacheTexture() marks a texture
   userData.cached, and disposeCardMesh() refuses to dispose anything
   carrying that flag — that is what stops a card leaving the ring from
   destroying a texture the cache is still handing out. An LRU inverts the
   risk: the *cache* now lets go of textures, and a texture it drops may
   still be on a mesh you are looking at. releaseCachedTexture() is the one
   place that resolves it, by handing ownership over rather than guessing:
   the flag is cleared (so the mesh's own teardown will dispose it, exactly
   as it does for an uncached texture), and the dispose happens here and now
   only if no mesh is holding it. A texture on screen is therefore never
   disposed out from under it, and one that isn't is never leaked.
============================================================ */
const TEXTURE_CACHE_LIMIT = 64;   // ~two full moons (MOON_STAR_CAP is 28)
const textureCache = new Map();

// Both slots a card texture can be sitting in: the live map, and the front
// face stashed by cardFlip.js while a card is flipped over (refreshMemoryTexture
// below writes to that one mid-flip, so it is a real reference, not a stale one).
function textureInUse(tex) {
  return cardGroup.children.some((mesh) => (
    mesh.material.map === tex || mesh.userData.frontMap === tex
  ));
}

function releaseCachedTexture(tex) {
  if (!tex) return;
  tex.userData.cached = false;
  if (!textureInUse(tex)) tex.dispose();
}

function getCachedTexture(id) {
  const tex = textureCache.get(id);
  // Re-insert on a hit: Map iterates in insertion order, so "oldest entry
  // first" is the same thing as "least recently used" only if a use moves the
  // entry to the back.
  if (tex) {
    textureCache.delete(id);
    textureCache.set(id, tex);
  }
  return tex;
}

function cacheTexture(id, tex) {
  tex.userData.cached = true;
  textureCache.delete(id); // so a re-cache lands at the back, not in place
  textureCache.set(id, tex);
  while (textureCache.size > TEXTURE_CACHE_LIMIT) {
    const [oldestId, oldestTex] = textureCache.entries().next().value;
    textureCache.delete(oldestId);
    releaseCachedTexture(oldestTex);
  }
}

// The only way an entry leaves the cache deliberately (an edit, a delete, a
// tier change). Going through here rather than textureCache.delete() is what
// keeps the eviction contract in one place — and stops the two cases where a
// bare delete orphaned a texture nothing would ever dispose: editing a memory
// that isn't on the viewed moon, and deleting one.
function dropCachedTexture(id) {
  const tex = textureCache.get(id);
  if (!tex) return;
  textureCache.delete(id);
  releaseCachedTexture(tex);
}

function clearTextureCache() {
  textureCache.forEach(releaseCachedTexture);
  textureCache.clear();
}

/* A card's map is only disposed if nothing that outlives the mesh owns it:
   an LRU entry (userData.cached, above) or the single shared loading-placeholder
   drawing (userData.shared, below). The geometry is shared by the whole ring and
   is never disposed here — see the SHARED CARD GEOMETRY note above. */
function disposeCardMesh(mesh) {
  const map = mesh.material.map;
  if (map && !map.userData?.cached && !map.userData?.shared) {
    map.dispose();
  }
  if (!mesh.material.userData?.shared) mesh.material.dispose();
}

/* A photo memory's texture isn't "final" until its image has decoded
   (refreshMemoryTexture regenerates + caches it then) — such a draw must never
   be cached, or a re-entry would get stuck without the photo for the session.
   Since Phase 5 that window is a network round trip and not a decode tick, and
   it opens *before* photoData exists at all: the ring's list data carries only
   hasPhoto. Testing photoData alone would therefore cache exactly the drawing
   this guard exists to keep out of the cache. */
function awaitingPhoto(memory) {
  return memory.type === 'photo' && (memory.photoData || memory.hasPhoto) && !memory.photoImg;
}

export function addMemoryToScene(memory) {
  const cached = getCachedTexture(memory.id);
  const stillAwaitingPhoto = awaitingPhoto(memory);
  const tex = cached || makePolaroidTexture(memory);
  if (!cached && !stillAwaitingPhoto) cacheTexture(memory.id, tex);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  // Shared geometry, per-card material: the material carries this card's own
  // texture, the rectangle it is stretched over is the same for every card.
  const mesh = new THREE.Mesh(cardGeometry, mat);

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

  // Ask for the photo from here rather than from showMoon(), so every way a
  // star reaches the ring gets one: moon travel, a restored delete, a save
  // that failed and fell back to showing the star anyway. A cache hit already
  // has its final texture (photo and all), and loadPhotoImgFor is a no-op for
  // anything that has its image already or has no photo to fetch. It must come
  // after memory.mesh is set — that is what the fetch queue checks to know the
  // card is still in the ring.
  if (!cached) loadPhotoImgFor(memory);

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
  dropCachedTexture(memory.id);
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
  // Same contract as addMemoryToScene: an edit that leaves the photo still
  // undecoded (the edit form hands back photoData without a decoded image)
  // has just drawn a card without its photo, and caching that would keep the
  // photo off this card for the rest of the session.
  if (!awaitingPhoto(memory)) cacheTexture(memory.id, newTex);
  loadPhotoImgFor(memory);
}

/* ============================================================
   LOADING PLACEHOLDERS — shown at ring positions while a planet's
   memories are being fetched, so entering a planet never shows a
   flash of empty ring on a slow connection.
============================================================ */
const LOADING_PLACEHOLDER_COUNT = 4;
let loadingPlaceholders = [];

/* All four placeholders are the same blank card, so they are one texture and
   one material between them, not four of each — the whole point of a
   placeholder is that there is nothing to tell apart. Both are marked
   userData.shared, which is what stops disposeCardMesh() (clearRenderedStars
   runs it over every child of cardGroup, placeholders included) from
   destroying a drawing the other three are still using. */
let placeholderTexture = null;
let placeholderTextureKey = '';
let placeholderMaterial = null;

function makePlaceholderTexture() {
  // Card-shaped, at the tier's card size and in the card's reference space,
  // so its rounded corners land exactly where a real card's do.
  const { canvas, ctx, W, H } = makeCardCanvas();
  ctx.fillStyle = 'rgba(210, 200, 190, 0.22)';
  roundRect(ctx, 0, 0, W, H, 14);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // No mip chain for this one (Plan 3 Phase 6's filtering audit): it is a
  // single flat translucent rectangle, so every level of the pyramid would be
  // the same colour as the last, for a third more memory and a full mipmap
  // generation on upload. minFilter has to come down with it — the default
  // LinearMipmapLinearFilter on a texture with no mipmaps is an incomplete
  // texture, which samples black.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.userData.shared = true;
  return tex;
}

function getPlaceholderMaterial() {
  const key = cardTextureKey();
  // A tier change between two planet loads leaves the previous drawing at the
  // wrong size. Redrawing it *here* is what makes disposing the old one safe:
  // this runs only from showLoadingPlaceholders(), and the ring has always
  // just been cleared by then, so no mesh is still showing it.
  if (placeholderTexture && placeholderTextureKey !== key) {
    placeholderTexture.dispose();
    placeholderTexture = null;
  }
  if (!placeholderTexture) {
    placeholderTexture = makePlaceholderTexture();
    placeholderTextureKey = key;
    if (placeholderMaterial) {
      placeholderMaterial.map = placeholderTexture;
      placeholderMaterial.needsUpdate = true;
    }
  }
  if (!placeholderMaterial) {
    placeholderMaterial = new THREE.MeshBasicMaterial({
      map: placeholderTexture, transparent: true, side: THREE.DoubleSide
    });
    placeholderMaterial.userData.shared = true;
  }
  return placeholderMaterial;
}

export function showLoadingPlaceholders() {
  const mat = getPlaceholderMaterial();
  for (let i = 0; i < LOADING_PLACEHOLDER_COUNT; i++) {
    const mesh = new THREE.Mesh(cardGeometry, mat);

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
  // Nothing is disposed here any more: the geometry, the texture and the
  // material are all shared and all outlive these four meshes (see above).
  // The next planet load reuses them as they stand.
  loadingPlaceholders.forEach((mesh) => cardGroup.remove(mesh));
  loadingPlaceholders = [];
}

function refreshMemoryTexture(memory) {
  // The one guard against a photo landing on a card that has left the ring:
  // clearRenderedStars() nulls every rendered memory's `mesh`, so a fetch or
  // decode that finishes after moon travel has nothing to write onto and
  // simply stops here.
  if (!memory.mesh) return;
  const newTex = makePolaroidTexture(memory);

  /* While a card is flipping or open, cardFlip.js owns material.map — the
     back-of-card texture is on there and the stashed userData.frontMap is what
     goes back on the way out — so hand the new drawing to *that* instead of
     the live map. Writing it straight to material.map would show the photo on
     the back of the card mid-flip and then have closeCard restore the
     photoless front over the top of it. Before Phase 5 this race was one
     decode tick wide and effectively unreachable; a network fetch makes it
     seconds wide, and opening a card the moment it appears is exactly what
     someone does when the ring is still filling in. */
  if (memory.mesh.userData.flipping) {
    const oldFront = memory.mesh.userData.frontMap;
    if (oldFront && !oldFront.userData?.cached) oldFront.dispose();
    memory.mesh.userData.frontMap = newTex;
    cacheTexture(memory.id, newTex);
    return;
  }

  const oldMap = memory.mesh.material.map;
  if (oldMap && !oldMap.userData?.cached) oldMap.dispose();
  memory.mesh.material.map = newTex;
  memory.mesh.material.needsUpdate = true;
  cacheTexture(memory.id, newTex);
}

/* ============================================================
   LAZY PHOTO FETCH (Plan 3 Phase 5)

   The ring's memories arrive slim — everything except photoData/audioData,
   plus hasPhoto/hasAudio — so entering a planet costs a few KB instead of
   every moon's media (7.21MB for a 4-star planet, measured). A card's photo
   is then fetched one record at a time, for the viewed moon only, and lands
   on the existing loadPhotoImgFor → refreshMemoryTexture path, which already
   knew how to redraw a card once its image showed up.

   Three things this has to get right:
   - Concurrency. A full 28-star moon would otherwise open 28 requests at
     once and hand the browser's connection pool a queue the user's next
     action has to wait behind. Four at a time keeps the ring filling in
     visibly from the start without saturating anything.
   - Stale work. Travelling to another moon calls clearRenderedStars(), which
     nulls every rendered memory's `mesh`. refreshMemoryTexture stops there on
     its own, but a download that nobody will draw still holds one of the four
     slots the moon you *are* looking at needs, so the whole lot is aborted
     and the queue emptied.
   - Doing it once. photoData/photoImg persist on the memory object, so coming
     back to a moon redraws from what is already in hand; `photoFetchPending`
     covers the window before that where a second request for the same card
     could be queued behind the first.
============================================================ */
const PHOTO_FETCH_CONCURRENCY = 4;

const photoFetchQueue = [];             // memories waiting for a slot
const photoFetchPending = new Set();    // ids queued or in flight, so nothing is asked for twice
const photoFetchControllers = new Set();
let photoFetchActive = 0;
// Bumped by cancelPhotoFetches(). An aborted request's .finally() still runs,
// a turn or two after the new moon has already queued its own cards — without
// this it would clear a pending flag belonging to that new queue and let the
// same card be asked for twice.
let photoFetchEpoch = 0;

function pumpPhotoFetches() {
  while (photoFetchActive < PHOTO_FETCH_CONCURRENCY && photoFetchQueue.length > 0) {
    const memory = photoFetchQueue.shift();
    // Left the ring while it sat in the queue — don't spend a request on it.
    if (!memory.mesh) {
      photoFetchPending.delete(memory.id);
      continue;
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) photoFetchControllers.add(controller);
    const epoch = photoFetchEpoch;
    photoFetchActive++;

    // 'photo' — the photo and nothing else. Asking for the whole record here
    // was measured pulling 7.56MB to draw a 4-card ring, because one of those
    // memories carries a 6.9MB audio clip: the card needs its picture, and
    // nothing wants the recording until the card is opened. That single query
    // parameter is the difference between this phase working and not.
    loadMemory(memory.id, controller?.signal, 'photo')
      .then((full) => {
        if (full.photoData) memory.photoData = full.photoData;
        decodePhotoInto(memory);
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return; // we cancelled it; not a failure
        // Left deliberately quiet beyond the console: one card without its
        // photo is a much smaller thing than a toast over the whole ring, and
        // re-entering the moon retries (nothing was cached, so the card is
        // still marked as awaiting its photo).
        console.warn('Could not load a card photo', e);
      })
      .finally(() => {
        if (controller) photoFetchControllers.delete(controller);
        if (epoch === photoFetchEpoch) photoFetchPending.delete(memory.id);
        photoFetchActive--;
        pumpPhotoFetches();
      });
  }
}

// Drop everything outstanding. Called from clearRenderedStars(), i.e. exactly
// when the meshes these were for stop existing.
function cancelPhotoFetches() {
  photoFetchEpoch++;
  photoFetchQueue.length = 0;
  photoFetchControllers.forEach((c) => c.abort());
  photoFetchControllers.clear();
  photoFetchPending.clear();
}

function decodePhotoInto(memory) {
  if (!memory.photoData) return;
  const img = new Image();
  img.onload = () => {
    memory.photoImg = img;
    refreshMemoryTexture(memory);
  };
  img.src = memory.photoData;
}

// "Make sure this card ends up showing its photo." Three states: the image is
// already decoded (nothing to do), the bytes are in hand but not decoded, or
// neither — in which case the record says whether there is a photo to go and
// get at all.
function loadPhotoImgFor(memory) {
  if (memory.photoImg) return;
  if (memory.photoData) {
    decodePhotoInto(memory);
    return;
  }
  if (memory.type !== 'photo' || !memory.hasPhoto) return;
  if (photoFetchPending.has(memory.id)) return;
  photoFetchPending.add(memory.id);
  photoFetchQueue.push(memory);
  pumpPhotoFetches();
}

// Tear down every mesh currently in the ring (stars and any loading
// placeholders) without touching `memories` — used both when leaving a planet
// and when travelling to another of its moons.
function clearRenderedStars() {
  cancelPhotoFetches();
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

/* SOLAR ONLY, from Plan 4 Phase 7 on. Nothing else in the scene reacts to
   lights — cards, fairy lights and the background sky are all
   MeshBasicMaterial — so this only shapes the portal moons, which are the one
   lit surface here. In `universe` the portals are unlit black-hole billboards
   and this light (along with the AmbientLight and HemisphereLight above)
   illuminates nothing at all. It is still constructed in both themes: it costs
   one uniform on a scene that has no lit material to apply it to, and making
   the light rig conditional would put a second, subtler theme branch on the
   renderer's setup for no measurable gain.

   It sits above the middle of the ring, i.e. above the viewer, because both
   portals hang off to the sides: lighting from there catches the hemisphere
   each one turns toward you, with the terminator falling just below centre.
   A directional light aimed from one side left whichever moon faced away
   from it as a near-black disc. decay 0 keeps it from falling off over the
   26 units out to the portals. That black-disc constraint is what makes this
   a PointLight rather than a DirectionalLight, and it now applies to `solar`
   alone — a billboard has no unlit hemisphere to leave in shadow. */
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

/* Plan 4 Phase 7. In `universe` the portal stops being a lit sphere and
   becomes an unlit disc: a black hole is genuinely disc-shaped, so a flat quad
   is the honest geometry here rather than a shortcut, where a sphere wearing a
   black-hole costume would just look like a planet in a costume.

   "Billboard" here means the same static facing the caption plate has always
   used, not a per-frame lookAt. The camera never translates — it is set once
   at (0, 1.2, 0) and only ever rotates — so facing the viewer is a fixed
   orientation, and the group's existing `rotation.y = angle + Math.PI` already
   provides it. The disc hangs ~9.7 units above eye level at 26 out, so it is
   seen about 20.5° off head-on and foreshortens by cos(20.5°) ≈ 6%. That is
   left uncorrected on purpose: it is the same ~7% the caption plate already
   accepts, and a 6% squash on an accretion disc reads as the disc being
   tilted, which is what one looks like anyway. */
const BLACK_HOLE_PORTALS = themeFlag('blackHolePortals');

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

  /* Branched at construction, not built-then-replaced: these two objects are
     made exactly once for the life of the page (moon changes only swap maps),
     so there is no teardown path to lean on and nothing should be allocated
     that the active theme will never draw. */
  const body = BLACK_HOLE_PORTALS
    ? new THREE.Mesh(
      // Square: makeBlackHoleTexture is 1:1 and the disc must not be ovalled
      // by its own quad. Sized off the same radius the sphere used, with room
      // around it for the accretion ring and bloom, which live inside the
      // texture rather than in extra geometry.
      new THREE.PlaneGeometry(PORTAL_BODY_RADIUS * 2.6, PORTAL_BODY_RADIUS * 2.6),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
    )
    : new THREE.Mesh(
      new THREE.SphereGeometry(PORTAL_BODY_RADIUS, 48, 32),
      new THREE.MeshLambertMaterial({ transparent: true })
    );
  body.userData.portal = kind;
  group.add(body);

  // thin shell of atmosphere, seen edge-on around the limb. Solar only — the
  // black hole's glow is painted into its texture, and a BackSide sphere
  // around a flat disc would just be a bubble with nothing in it.
  const halo = BLACK_HOLE_PORTALS ? null : new THREE.Mesh(
    new THREE.SphereGeometry(PORTAL_BODY_RADIUS * 1.14, 32, 24),
    new THREE.MeshBasicMaterial({
      side: THREE.BackSide, transparent: true, opacity: 0.2, depthWrite: false
    })
  );
  if (halo) group.add(halo);

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
  // Clearing the body's actual half-width, which is not the same in the two
  // themes: the sphere is PORTAL_BODY_RADIUS across its radius, the disc's quad
  // is 1.3x that, because the ring and bloom are painted inside the texture.
  // Measuring off the geometry rather than the constant keeps the same gap.
  const bodyHalfWidth = BLACK_HOLE_PORTALS ? PORTAL_BODY_RADIUS * 1.3 : PORTAL_BODY_RADIUS;
  label.position.x = (kind === 'next' ? 1 : -1) * (bodyHalfWidth + labelWidth / 2 + 0.3);
  label.userData.portal = kind;
  group.add(label);

  return {
    kind, group, body, halo, label,
    spin: kind === 'next' ? 0.012 : -0.009,
    /* Which axis that spin turns. A sphere rotates on its own vertical axis;
       a flat disc cannot — turning a quad about Y swings it edge-on and it
       vanishes. Z is the view axis for a viewer-facing quad, so the accretion
       ring turns in its own plane, which is the one rotation a black hole
       actually shows you. */
    spinAxis: BLACK_HOLE_PORTALS ? 'z' : 'y',
    locked: false,
    targetIndex: null,
    nudgeStart: 0
  };
}

const portals = { prev: makePortalObject('prev'), next: makePortalObject('next') };

function setPortalAppearance(portal, { caption, label, locked }) {
  const color = currentPlanet?.accentColor || '#ffd9a0';

  /* Same swap-and-dispose lifecycle in both themes, and deliberately NOT the
     LRU: textureInUse() only scans cardGroup.children, and portals live under
     portalGroup, so a portal texture in that cache could be disposed while
     still bound to a live material. A fresh texture per call, the old one
     dropped here, is what keeps that impossible. */
  const oldSurface = portal.body.material.map;
  portal.body.material.map = BLACK_HOLE_PORTALS
    ? makeBlackHoleTexture({ color, locked })
    : makeMoonSurfaceTexture({ color, locked });
  /* A locked moon is a ghost of a world, but still has to read as one — at
     half opacity over a starfield it disappeared and left the caption
     floating. The black hole needs no such fade: it says "not formed yet" by
     having no accretion ring, so it stays fully opaque and keeps its edge. */
  portal.body.material.opacity = (locked && !BLACK_HOLE_PORTALS) ? 0.72 : 1;
  portal.body.material.needsUpdate = true;
  oldSurface?.dispose();

  const oldLabel = portal.label.material.map;
  portal.label.material.map = makePortalLabelTexture({ caption, label, locked });
  portal.label.material.needsUpdate = true;
  oldLabel?.dispose();

  // an unformed moon gets no atmosphere — it reads as a ghost of a world.
  // Null in universe, where the glow is painted into the disc's own texture.
  if (portal.halo) {
    portal.halo.visible = !locked;
    portal.halo.material.color.set(color);
  }
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

  /* Both halves of a portal's plate are themed (Plan 4 Phase 2): the caption
     is a themed string, and the name under it is groupingName() — the moon's
     own stored name in solar, a nebula derived from its `index` in universe.
     Nothing is stored either way; `moon.name` on disk is untouched.

     These strings are passed straight into makePortalLabelTexture, which
     bakes a fresh canvas every call and caches nothing, so the plate cannot
     come back carrying the other theme's wording. The theme is also fixed for
     the life of the page (theme.js's "fixed at load"), so a plate rebuilt on
     a later moon jump is rebuilt against the same theme as the first one. */
  portals.prev.group.visible = !!prev;
  if (prev) {
    portals.prev.targetIndex = prev.index;
    setPortalAppearance(portals.prev, {
      caption: themeLabel('previousMoon'), label: groupingName(prev.index, prev.name), locked: false
    });
  }

  portals.next.group.visible = true;
  portals.next.targetIndex = next ? next.index : null;
  // "not formed yet" is not themed: a grouping that doesn't exist yet hasn't
  // formed in either vocabulary, so it stays one literal.
  setPortalAppearance(portals.next, next
    ? { caption: themeLabel('nextMoon'), label: groupingName(next.index, next.name), locked: false }
    : { caption: themeLabel('nextMoon'), label: 'not formed yet', locked: true });
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
  // Themed the same way the portal plates are, and from the same pair of
  // inputs, so the readout and the portal you just came through agree.
  const viewed = currentMoons[pos];
  el.textContent = `✦ ${groupingName(viewed.index, viewed.name)} · ${themeLabel('moon')} ${pos + 1} of ${currentMoons.length}`;
  el.classList.remove('hidden');
}

// Swap which moon's stars are in the ring. `memories` (the planet's stars
// across every moon) is deliberately left alone — only the meshes change.
export function showMoon(moonIndex) {
  clearRenderedStars();
  setCurrentMoonIndex(moonIndex);

  // addMemoryToScene asks for each card's photo itself (only for cards that
  // need one, and only once), so this stays a plain add — the ring is the only
  // thing whose photos are ever fetched, which is what keeps the other moons'
  // media off the wire.
  starsOnViewedMoon(memories, currentMoons, moonIndex).forEach(addMemoryToScene);

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
  // After the mesh has left cardGroup, so the LRU's "is anything still showing
  // this?" check sees the truth and frees the texture instead of stranding it.
  dropCachedTexture(memory.id);
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

/* One pointerdown listener, not two. There used to be a second one further
   down recording the press position for the click-vs-drag test; they were on
   the same element, fired on the same event, and only differed in what they
   stored. Both jobs live here now — starting a look-around drag, and
   remembering where the press began. */
let downPos = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
  if (dragLocked) return;
  isDragging = true;
  prevX = e.clientX;
  prevY = e.clientY;
});

window.addEventListener('pointerup', () => { isDragging = false; });

/* pointermove does no work beyond recording where the pointer is; the camera
   is moved once per frame from what it recorded.

   A gaming mouse polls at 1000Hz and the browser will happily deliver events
   at that rate (coalesced or not), so the old handler ran its arithmetic up to
   ~16 times per frame at 60fps and ~33 at the low tier's 30 — and every one of
   those but the last was overwritten before anything was drawn. Accumulating
   the delta and applying it in the frame callback below gives identical camera
   motion, because the deltas are summed rather than sampled: drag speed and
   the 0.004 rad/px feel are unchanged. */
let pendingDragDX = 0;
let pendingDragDY = 0;

window.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (!isDragging || dragLocked) return;
  pendingDragDX += e.clientX - prevX;
  pendingDragDY += e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;
});

// Drains a frame's worth of accumulated pointer movement into the camera
// angles. Called from animate() before the camera is updated.
function applyPendingDrag() {
  if (pendingDragDX === 0 && pendingDragDY === 0) return;
  targetYaw -= pendingDragDX * 0.004;
  targetPitch += pendingDragDY * 0.004;
  targetPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, targetPitch));
  pendingDragDX = 0;
  pendingDragDY = 0;
}

// Callback invoked with (memory, mesh) when a card is clicked (only if not
// dragged much). The caller (cardFlip.js) wires this up to the flip + read
// panel.
let onCardClick = null;
export function setOnCardClick(fn) {
  onCardClick = fn;
}

/* Click to open a memory (only if not dragged much). The press position this
   compares against is recorded by the single pointerdown listener above. */
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

// How early a frame may arrive and still be drawn. Sized to swallow vsync
// quantisation without being large enough to let a whole extra frame through
// at any plausible refresh rate — see the throttle in animate() for why a
// zero-tolerance comparison is the wrong shape.
const THROTTLE_TOLERANCE_MS = 4;

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
let appliedCardTextureKey = cardTextureKey();

/* What a tier change does to card textures — the one tier setting that is
   baked into a drawing instead of read every frame.

   Cards already in the ring keep the texture they were drawn with. Redrawing
   a whole moon's canvases is precisely the kind of hitch a downgrade is
   trying to escape, and a downgrade fires when the machine is already
   struggling; the ring is rebuilt from scratch at the next moon jump or
   planet entry anyway, which is seconds away and is a moment that already
   costs this.

   What must not survive is the *cache*. Leaving 512×600 entries in it would
   hand the low tier a full-size texture on the next re-entry and quietly undo
   the saving it just chose. Clearing it means everything drawn from here on
   is at the new size — and releaseCachedTexture() still refuses to dispose
   anything a mesh is currently showing, so the cards on screen are unharmed
   by the clear. The placeholder redraws itself lazily (see
   getPlaceholderMaterial), and the geometry only moves if the *ratio*
   changed, which no tier does today. */
function applyCardTextureTier() {
  const key = cardTextureKey();
  if (key === appliedCardTextureKey) return;
  appliedCardTextureKey = key;
  clearTextureCache();
  refitCardGeometry();
}

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

  // Card textures are tier-sized too, as of Phase 6, and they are the one
  // tier setting that is *baked* rather than read per frame — so this is
  // where the stale ones are dealt with. (The hyperspace star counts in the
  // table are still nobody's yet; that canvas belongs to planetPicker.js and
  // to Phase 8.)
  applyCardTextureTier();

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

   Why the threshold is 1.5× the target interval (25ms against a 60fps
   target): it used to be 1.8×, sized around a throttle that lost every other
   frame to vsync jitter and so read ~25ms on a machine that was actually
   fine. With that fixed (see animate()) a healthy machine averages ~16.7ms
   and the slack is no longer needed, so the line can sit where it means
   something: a sustained 40fps is a tier this machine isn't holding. Don't
   tighten it much further — 1.25× (21ms) is inside the range a 50Hz display
   or a modest hitch reaches without the tier being wrong. */
const TIER_WARMUP_MS = 4000;    // rendered time ignored after every resume
const TIER_SUSTAIN_MS = 2000;   // how long "bad" must hold before stepping down
const TIER_EMA_TAU_MS = 500;    // the average's time constant
const TIER_BAD_FACTOR = 1.5;    // multiple of the target frame interval that counts as bad

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

/* ----- Frame callbacks -----
   Called at the end of every *rendered* frame with (frameDelta, now).

   Why anything that animates the scene belongs here rather than on its own
   requestAnimationFrame: this loop is throttled to the tier's target FPS and,
   since Phase 2, does not run at all while the scene is paused. A parallel rAF
   chain ignores both. The card flip used to be exactly that — at the low tier
   it computed its tween roughly twice per frame that was actually drawn, so
   half the work it did was overwritten before anyone saw it, and it would have
   gone on mutating meshes for a scene that had stopped rendering.

   Iterating a copy so a callback can remove itself mid-frame — which the flip
   tween does on its last frame — without the loop skipping its neighbour. */
const frameCallbacks = new Set();

export function addFrameCallback(fn) {
  frameCallbacks.add(fn);
  return () => frameCallbacks.delete(fn);
}

export function removeFrameCallback(fn) {
  frameCallbacks.delete(fn);
}

// Kept for perfHud.js, which owns one slot and replaces rather than adds.
// Phase 1 shipped this shape and the HUD is outside Phase 8's scope.
let hudFrameCallback = null;
export function setOnFrame(fn) {
  if (hudFrameCallback) frameCallbacks.delete(hudFrameCallback);
  hudFrameCallback = fn;
  if (fn) frameCallbacks.add(fn);
}

/* Notified when the scene stops rendering, so anything mid-animation on the
   frame registry can finish itself off instead of being stranded.

   This exists because of a hazard the registry created. The card-flip tween
   used to run on its own requestAnimationFrame and completed regardless of
   what the scene was doing; on the registry it only advances while frames are
   being drawn. The topbar's "planets" button is live during a flip, and it
   pauses the scene — so a click there mid-flip would leave the tween frozen,
   its promise unsettled, and setDragLocked(true) never undone, which is a
   camera that no longer responds until the page is reloaded. Listeners here
   are expected to jump straight to their end state: nothing is on screen at
   this point, so there is nothing to animate, only bookkeeping to settle. */
const sceneStopListeners = new Set();

export function onSceneStop(fn) {
  sceneStopListeners.add(fn);
  return () => sceneStopListeners.delete(fn);
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
    // Let anything animating on the frame registry settle: it will get no more
    // frames, and a half-finished tween holds locks nothing will release.
    sceneStopListeners.forEach((fn) => fn());
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

  /* ----- Throttle to TARGET_FPS -----
     The tolerance is the whole point and must not be removed. rAF fires on
     the display's vsync, so the elapsed time arrives quantised to multiples
     of the refresh interval; comparing it against FRAME_INTERVAL exactly
     means a target that *equals* a vsync multiple loses every other frame to
     sub-millisecond jitter, and the loop then runs at the next multiple down.
     That is how the 30fps low tier used to render at 20 (60Hz display: the
     tick at 33.33ms misses the 33.33ms line, so the frame waits for 50ms),
     and how a 60fps target used to average ~50fps on a healthy machine.
     Accepting a frame that is up to THROTTLE_TOLERANCE_MS early costs at most
     one early frame and makes the cap land on the rate it names.

     Overshoot is deliberate on refresh rates that aren't a multiple of the
     target: a 144Hz display renders at 13.9ms (~72fps) rather than dropping
     to 20.8ms (~48fps). Slightly over the cap beats visibly under it. */
  if (now - lastFrameTime < FRAME_INTERVAL - THROTTLE_TOLERANCE_MS) return;
  const frameDelta = lastFrameTime ? now - lastFrameTime : 0;
  lastFrameTime = now;

  // Ignore a stray huge gap (e.g. right after a visibilitychange resume)
  // so it doesn't skew the average toward a false downgrade.
  if (frameDelta > 0 && frameDelta < 200) sampleFrameTime(frameDelta);

  const t = clock.getElapsedTime();

  // A frame's worth of pointer movement, summed, applied once.
  applyPendingDrag();

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
    // See spinAxis in makePortalObject: a sphere turns on its vertical axis, a
    // viewer-facing disc turns in its own plane (Y would swing it edge-on).
    portal.body.rotation[portal.spinAxis] += portal.spin * motionDamp;

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
  if (frameCallbacks.size > 0) {
    for (const fn of Array.from(frameCallbacks)) fn(frameDelta, now);
  }
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
