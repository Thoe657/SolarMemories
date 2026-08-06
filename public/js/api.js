/* ============================================================
   PERSISTENT STORAGE
   -----------------------------------------------------------
   This gallery is served by a small local Node server which stores
   data as JSON files in a local "data" folder. The gallery just
   calls /api/memories and /api/galaxies on the same origin.
============================================================ */

export const MEMORIES_URL = '/api/memories';
export const GALAXIES_URL = '/api/galaxies';

export async function tryRestoreStorage() {
  try {
    const resp = await fetch(GALAXIES_URL);
    return resp.ok ? 'remote' : 'offline';
  } catch (e) {
    console.warn('Gallery server not reachable', e);
    return 'offline';
  }
}

export async function loadGalaxies() {
  const resp = await fetch(GALAXIES_URL);
  if (!resp.ok) {
    throw new Error(`load failed (${resp.status})`);
  }
  const body = await resp.json();
  return body.galaxies || [];
}

export async function createGalaxyRemote(galaxy) {
  const resp = await fetch(GALAXIES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(galaxy)
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `create failed (${resp.status})`);
  }
}

export async function deleteGalaxyRemote(id) {
  const resp = await fetch(`${GALAXIES_URL}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `delete failed (${resp.status})`);
  }
}

export async function persistMemory(memory, galaxyId) {
  const payload = {
    id: String(memory.id),
    galaxyId,
    type: memory.type,
    title: memory.title,
    date: memory.date,
    text: memory.text,
    photoData: memory.photoData || null,
    audioData: memory.audioData || null
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
}

export async function loadAllMemories(galaxyId) {
  const resp = await fetch(`${MEMORIES_URL}?galaxy=${encodeURIComponent(galaxyId)}`);
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
    audioData: entry.audioData || null
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

export async function loadTrashedMemories(galaxyId) {
  const resp = await fetch(`${MEMORIES_URL}/trash?galaxy=${encodeURIComponent(galaxyId)}`);
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
