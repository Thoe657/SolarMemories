/* ============================================================
   STATE — shared mutable app state, imported (read) freely by
   other modules. Only this module reassigns the non-array
   values below; other modules call the setters.
============================================================ */
export const memories = []; // {id, type, title, date, text, photoData, audioData, mesh}

export let currentPlanetId = null;
export let currentPlanetName = '';
export let currentPlanet = null; // full planet object {id, name, accentColor, ring}
export let storageMode = 'connecting'; // 'remote' | 'offline'
export let planetsCache = [];

// The open planet's moons, sorted by index: [{id, index, name, starCount}].
// `memories` holds *all* of the planet's stars (so related-memory links and the
// related-memory picker still reach across moons); only what gets rendered
// into the ring is narrowed to the viewed moon.
export let currentMoons = [];
// Which moon's stars are currently rendered. A planet always opens on its
// oldest moon; portal navigation (Phase 4) moves this.
export let currentMoonIndex = 0;

export function setCurrentPlanet(planet) {
  currentPlanetId = planet ? planet.id : null;
  currentPlanetName = planet ? planet.name : '';
  currentPlanet = planet;
}

export function setStorageMode(mode) {
  storageMode = mode;
}

export function setPlanetsCache(list) {
  planetsCache = list;
}

export function setCurrentMoons(list) {
  currentMoons = Array.isArray(list) ? list : [];
}

export function setCurrentMoonIndex(index) {
  currentMoonIndex = index;
}
