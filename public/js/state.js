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

// Applies an edit's content fields onto the matching entry in `memories`,
// in place (mutating the existing object rather than replacing it at its
// array index) -- so every other live reference to it (a rendered mesh's
// userData.memory, another memory's relatedIds chip lookup, the
// relatedSearch picker's results) picks up the change immediately, with no
// re-fetch. `id`/`moonId` are deliberately left untouched: an edit must
// never move a memory to a different moon. Returns the updated entry, or
// null if it isn't currently loaded (shouldn't happen -- edits only ever
// target a memory already in `memories`).
export function updateMemoryInState(edited) {
  const existing = memories.find((m) => String(m.id) === String(edited.id));
  if (!existing) return null;
  existing.type = edited.type;
  existing.title = edited.title;
  existing.date = edited.date;
  existing.text = edited.text;
  existing.photoData = edited.photoData;
  existing.photoImg = edited.photoImg;
  existing.audioData = edited.audioData;
  existing.milestone = edited.milestone;
  existing.relatedIds = edited.relatedIds;
  return existing;
}
