/* ============================================================
   PERSISTENT STORAGE
   -----------------------------------------------------------
   This gallery is served by a small local Node server which stores
   data as JSON files in a local "data" folder. The gallery just
   calls /api/memories and /api/planets on the same origin.
============================================================ */

export const MEMORIES_URL = '/api/memories';
export const PLANETS_URL = '/api/planets';

export async function tryRestoreStorage() {
  try {
    const resp = await fetch(PLANETS_URL);
    return resp.ok ? 'remote' : 'offline';
  } catch (e) {
    console.warn('Gallery server not reachable', e);
    return 'offline';
  }
}

export async function loadPlanets() {
  const resp = await fetch(PLANETS_URL);
  if (!resp.ok) {
    throw new Error(`load failed (${resp.status})`);
  }
  const body = await resp.json();
  // moonCount (Phase 12) drives the picker's satellite dots; default to 0
  // for safety if an older server response ever lacks the field.
  return (body.planets || []).map(p => ({ ...p, moonCount: p.moonCount || 0 }));
}

export async function createPlanetRemote(planet) {
  const resp = await fetch(PLANETS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(planet)
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `create failed (${resp.status})`);
  }
}

export async function deletePlanetRemote(id) {
  const resp = await fetch(`${PLANETS_URL}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `delete failed (${resp.status})`);
  }
}

// A planet's moons (star groupings), sorted by index — oldest first.
export async function loadMoons(planetId) {
  const resp = await fetch(`${PLANETS_URL}/${encodeURIComponent(planetId)}/moons`);
  if (!resp.ok) {
    throw new Error(`load failed (${resp.status})`);
  }
  const body = await resp.json();
  return body.moons || [];
}

export async function persistMemory(memory, planetId) {
  const payload = {
    id: String(memory.id),
    planetId,
    type: memory.type,
    title: memory.title,
    date: memory.date,
    text: memory.text,
    photoData: memory.photoData || null,
    audioData: memory.audioData || null,
    milestone: !!memory.milestone,
    relatedIds: Array.isArray(memory.relatedIds) ? memory.relatedIds.map(String) : []
  };
  const resp = await fetch(MEMORIES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `save failed (${resp.status})`);
  }
  // Carries back the moon the server filed this star onto.
  return resp.json().catch(() => ({}));
}

export async function loadAllMemories(planetId) {
  const resp = await fetch(`${MEMORIES_URL}?planet=${encodeURIComponent(planetId)}`);
  if (!resp.ok) {
    throw new Error(`load failed (${resp.status})`);
  }
  const body = await resp.json();
  return (body.memories || []).map(entry => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    date: entry.date,
    text: entry.text,
    // Slim by default since Plan 3 Phase 5: this endpoint no longer ships the
    // base64 media, only whether it exists, so entering a planet costs a few
    // KB of JSON instead of every moon's photos and audio. The bytes come
    // later and one record at a time, through loadMemory() below.
    //
    // The photoData/audioData fallbacks stay because ?full=1 still answers
    // with them inline; hasPhoto/hasAudio are derived from the payload in that
    // case so the rest of the app only ever has to consult one flag.
    photoData: entry.photoData || null,
    photoImg: null,
    audioData: entry.audioData || null,
    hasPhoto: entry.hasPhoto !== undefined ? !!entry.hasPhoto : !!entry.photoData,
    hasAudio: entry.hasAudio !== undefined ? !!entry.hasAudio : !!entry.audioData,
    milestone: !!entry.milestone,
    relatedIds: Array.isArray(entry.relatedIds) ? entry.relatedIds.map(String) : [],
    moonId: entry.moonId || null
  }));
}

// One memory's *full* record, media included — the counterpart to the slim
// list above. Throws rather than returning a half-record, because the edit
// path has to be able to tell "couldn't load it" apart from "it has no photo"
// — saving the second when the first is true would strip the photo off a real
// memory.
//
// `media` narrows the response to a single payload ('photo' or 'audio').
// The ring uses it for photos; without it, fetching a card's photo also pulls
// down that memory's audio, and one real recording here is 6.9MB against
// 80-300KB for a photo — which handed back the entire saving this phase
// exists for. Opening a card (cardFlip.js) and pre-filling an edit
// (memoryForm.js) both genuinely want everything, so they pass no `media`.
//
// The optional `signal` is scene.js's: travelling to another moon aborts the
// photo fetches queued for the moon you just left, so they stop competing for
// connections with the one you're now looking at.
export async function loadMemory(id, signal, media = null) {
  const query = media ? `?media=${encodeURIComponent(media)}` : '';
  const resp = await fetch(`${MEMORIES_URL}/${encodeURIComponent(id)}${query}`, { signal });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `load failed (${resp.status})`);
  }
  const body = await resp.json();
  if (!body.memory) throw new Error('memory not found');
  return body.memory;
}

export async function deleteMemory(id) {
  const resp = await fetch(`${MEMORIES_URL}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `delete failed (${resp.status})`);
  }
}

export async function loadTrashedMemories(planetId) {
  const resp = await fetch(`${MEMORIES_URL}/trash?planet=${encodeURIComponent(planetId)}`);
  if (!resp.ok) {
    throw new Error(`load failed (${resp.status})`);
  }
  const body = await resp.json();
  return body.memories || [];
}

export async function restoreMemory(id) {
  const resp = await fetch(`${MEMORIES_URL}/${encodeURIComponent(id)}/restore`, {
    method: 'POST'
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `restore failed (${resp.status})`);
  }
}

export async function deleteMemoryForever(id) {
  const resp = await fetch(`${MEMORIES_URL}/${encodeURIComponent(id)}/forever`, {
    method: 'DELETE'
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `delete failed (${resp.status})`);
  }
}

export async function createBackupRemote() {
  const resp = await fetch('/api/backup', { method: 'POST' });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `backup failed (${resp.status})`);
  }
  return resp.json();
}

// Available backups, newest first (each { filename, mtime }).
export async function listBackupsRemote() {
  const resp = await fetch('/api/backup');
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `load failed (${resp.status})`);
  }
  const body = await resp.json();
  return body.backups || [];
}

// The owner's stored name, or '' if it hasn't been set yet (first run).
export async function getSettings() {
  const resp = await fetch('/api/settings');
  if (!resp.ok) {
    throw new Error(`load failed (${resp.status})`);
  }
  const body = await resp.json();
  return body.ownerName || '';
}

export async function saveSettings(ownerName) {
  const resp = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerName })
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || `save failed (${resp.status})`);
  }
  const body = await resp.json();
  return body.ownerName;
}

export async function revealDataFolder() {
  const resp = await fetch('/api/settings/reveal-data');
  if (!resp.ok) {
    throw new Error(`reveal failed (${resp.status})`);
  }
}

export async function quitApp() {
  await fetch('/api/settings/quit', { method: 'POST' }).catch(() => {
    // The server may close the connection while exiting before the
    // response finishes — that's the expected shape of a successful quit.
  });
}

export async function restoreBackupRemote(filename) {
  const resp = await fetch(`/api/backup/${encodeURIComponent(filename)}/restore`, {
    method: 'POST'
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `restore failed (${resp.status})`);
  }
  return resp.json().catch(() => ({}));
}
