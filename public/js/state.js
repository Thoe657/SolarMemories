/* ============================================================
   STATE — shared mutable app state, imported (read) freely by
   other modules. Only this module reassigns the non-array
   values below; other modules call the setters.
============================================================ */
export const memories = []; // {id, type, title, date, text, photoData, audioData, mesh}

export let currentGalaxyId = null;
export let currentGalaxyName = '';
export let currentGalaxy = null; // full galaxy object {id, name, accentColor, ring}
export let storageMode = 'connecting'; // 'remote' | 'offline'
export let galaxiesCache = [];

// The open galaxy's planets, sorted by index: [{id, index, name, starCount}].
// `memories` holds *all* of the galaxy's stars (so related-memory links and the
// related-memory picker still reach across planets); only what gets rendered
// into the ring is narrowed to the viewed planet.
export let currentPlanets = [];
// Which planet's stars are currently rendered. A galaxy always opens on its
// oldest planet; Phase 4 will let this move.
export let currentPlanetIndex = 0;

export function setCurrentGalaxy(galaxy) {
  currentGalaxyId = galaxy ? galaxy.id : null;
  currentGalaxyName = galaxy ? galaxy.name : '';
  currentGalaxy = galaxy;
}

export function setStorageMode(mode) {
  storageMode = mode;
}

export function setGalaxiesCache(list) {
  galaxiesCache = list;
}

export function setCurrentPlanets(list) {
  currentPlanets = Array.isArray(list) ? list : [];
}

export function setCurrentPlanetIndex(index) {
  currentPlanetIndex = index;
}
