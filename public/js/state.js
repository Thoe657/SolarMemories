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
