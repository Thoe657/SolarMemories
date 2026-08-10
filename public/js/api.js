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
    photoData: entry.photoData || null,
    photoImg: null,
    audioData: entry.audioData || null,
    milestone: !!entry.milestone,
    relatedIds: Array.isArray(entry.relatedIds) ? entry.relatedIds.map(String) : [],
    moonId: entry.moonId || null
  }));
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
