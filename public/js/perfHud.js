/* ============================================================
   PERF HUD (Plan 3 Phase 1) — a small fixed-corner readout of what
   the scene actually costs, plus window.__perf() returning the same
   snapshot as a plain object.

   Only reached via a dynamic import from main.js when the page is
   opened with ?perf=1, so a normal load never fetches this module,
   never registers the frame callback, and never puts an element in
   the DOM. The object form is the point: the whole plan's
   verification budget is dominated by screenshots, and one line of
   JSON in the console answers "did that phase help" for a few dozen
   tokens.
============================================================ */
import { setOnFrame, sceneStats } from './scene.js';

// A HUD that measures a frame rate mustn't cost one. Frame samples are
// accumulated every frame (cheap arithmetic), but the DOM is only written
// four times a second — laying out and painting text over a compositing
// WebGL canvas at 60Hz would show up in the very numbers being reported.
const DOM_INTERVAL_MS = 250;
const AVG_WINDOW = 60; // frames the rolling average covers — ~1s at 60fps

const el = document.createElement('div');
el.className = 'perf-hud';
el.id = 'perfHud';
el.textContent = 'perf · waiting for a frame…';
document.body.appendChild(el);

let frameMs = 0;
let samples = [];
let samplesTotal = 0;
let sinceDomWrite = 0;
let lastFrameAt = 0;

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Chromium-only and gated behind cross-origin isolation in some builds, so
// treat it as optional rather than assuming it's there.
function heapMB() {
  const mem = performance.memory;
  if (!mem || typeof mem.usedJSHeapSize !== 'number') return null;
  return round1(mem.usedJSHeapSize / (1024 * 1024));
}

// The field names here are the plan's stable contract — later phases' notes
// quote them, so rename nothing without updating docs/PLAN.md too.
function snapshot() {
  const stats = sceneStats();
  const avgFrameMs = samples.length ? samplesTotal / samples.length : 0;
  return {
    frameMs: round1(frameMs),
    fps: frameMs > 0 ? round1(1000 / frameMs) : 0,
    avgFrameMs: round1(avgFrameMs),
    avgFps: avgFrameMs > 0 ? round1(1000 / avgFrameMs) : 0,
    calls: stats.calls,
    triangles: stats.triangles,
    textures: stats.textures,
    geometries: stats.geometries,
    tier: stats.tier,
    renderedStars: stats.renderedStars,
    heapMB: heapMB(),
    paused: stats.paused
  };
}

function drawHud() {
  const s = snapshot();
  el.textContent = [
    `tier   ${s.tier}${s.paused ? ' · paused' : ''}`,
    `frame  ${s.frameMs}ms  ${s.fps}fps`,
    `avg    ${s.avgFrameMs}ms  ${s.avgFps}fps`,
    `calls  ${s.calls}  tris ${s.triangles}`,
    `tex    ${s.textures}  geo ${s.geometries}`,
    `stars  ${s.renderedStars}  heap ${s.heapMB === null ? 'n/a' : `${s.heapMB}MB`}`
  ].join('\n');
}

setOnFrame((frameDelta) => {
  lastFrameAt = performance.now();

  // The very first frame reports a delta of 0 (there was no previous frame to
  // measure against) — counting it would drag the average down for a while.
  if (frameDelta > 0) {
    frameMs = frameDelta;
    samples.push(frameDelta);
    samplesTotal += frameDelta;
    if (samples.length > AVG_WINDOW) samplesTotal -= samples.shift();
  }

  sinceDomWrite += frameDelta;
  if (sinceDomWrite < DOM_INTERVAL_MS) return;
  sinceDomWrite = 0;
  drawHud();
});

// Frames are the normal clock, but they stop entirely when the scene is
// paused (a hidden tab today; Phase 2 adds "the planet view isn't on screen"),
// which would otherwise leave a stale readout sitting there looking live. This
// only redraws when no frame has arrived recently, so it costs nothing while
// the scene is running — and it exists only under ?perf=1 either way.
setInterval(() => {
  if (performance.now() - lastFrameAt > DOM_INTERVAL_MS * 2) drawHud();
}, DOM_INTERVAL_MS * 2);

window.__perf = snapshot;
console.info('perf HUD on — call window.__perf() for a snapshot object');
