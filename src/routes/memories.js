const crypto = require('crypto');
const express = require('express');
const { MEMORIES_DIR, MOONS_DIR, MOON_STAR_CAP, INDEX_FILE } = require('../config');
const {
  readJSON,
  writeJSON,
  withWriteLock,
  readRecord,
  writeRecord,
  readAllRecords,
} = require('../lib/storage');
const { archiveRecord, restoreRecord, purgeRecord, listDeleted } = require('../lib/archive');
const { validateMemory, validateMoon } = require('../lib/validate');
const { randomMoonName } = require('../lib/moonNames');

const router = express.Router();

function toIndexEntry(doc) {
  return { ...doc, milestone: doc.milestone || false };
}

// Finds the planet's newest moon and files the new star onto it if it has
// room, otherwise creates the next moon (random pool name). Returns the
// assigned moon's id. Must be called from inside withWriteLock.
function assignMoon(planetId) {
  const moons = readAllRecords(MOONS_DIR).filter((p) => p.planetId === planetId && !p.deletedAt);
  const newest = moons.slice().sort((a, b) => b.index - a.index)[0];

  if (newest && newest.starCount < MOON_STAR_CAP) {
    const updated = { ...newest, starCount: newest.starCount + 1 };
    writeRecord(MOONS_DIR, updated.id, updated);
    return updated.id;
  }

  const { ok, doc } = validateMoon({
    id: `moon-${crypto.randomUUID()}`,
    planetId,
    index: newest ? newest.index + 1 : 0,
    name: randomMoonName(moons.map((p) => p.name)),
    starCount: 1,
  });
  if (!ok) throw new Error('failed to create moon');
  writeRecord(MOONS_DIR, doc.id, doc);
  return doc.id;
}

// Reads the index rather than every memory file. The index mirrors full
// records (including photoData/audioData) so the ring view keeps working
// unchanged. Only non-deleted memories are ever added to the index.
router.get('/', (req, res) => {
  try {
    const planetId = req.query.planet ? String(req.query.planet) : null;
    let memories = readJSON(INDEX_FILE);
    if (planetId) {
      memories = memories.filter((m) => m.planetId === planetId);
    }
    memories = memories.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ memories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load memories' });
  }
});

// Must be registered before GET /:id, or Express would match "trash" as an id.
router.get('/trash', (req, res) => {
  try {
    const planetId = req.query.planet ? String(req.query.planet) : null;
    let memories = listDeleted(MEMORIES_DIR);
    if (planetId) {
      memories = memories.filter((m) => m.planetId === planetId);
    }
    memories = memories.slice().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    res.json({ memories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load trash' });
  }
});

// Full record, including photoData/audioData.
router.get('/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const memory = readRecord(MEMORIES_DIR, id);
    if (!memory) {
      return res.status(404).json({ error: 'memory not found' });
    }
    res.json({ memory });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load memory' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { ok, doc, errors } = validateMemory(req.body);
    if (!ok) {
      return res.status(400).json({ error: errors[0] });
    }

    await withWriteLock(() => {
      const existing = readRecord(MEMORIES_DIR, doc.id);
      if (existing) {
        // Preserve identity fields set at creation time -- an edit (Phase 7)
        // re-POSTs the same id and must not get reshuffled onto whatever
        // moon happens to be active now.
        doc.createdAt = existing.createdAt;
        doc.moonId = existing.moonId || null;
      } else {
        doc.moonId = assignMoon(doc.planetId);
      }
      writeRecord(MEMORIES_DIR, doc.id, doc);

      const index = readJSON(INDEX_FILE);
      const idx = index.findIndex((m) => m.id === doc.id);
      const indexEntry = toIndexEntry(doc);
      if (idx === -1) {
        index.push(indexEntry);
      } else {
        index[idx] = indexEntry;
      }
      writeJSON(INDEX_FILE, index);
    });

    // The client needs to know which moon the star was filed onto: it only
    // renders it into the ring if that's the moon currently being viewed.
    res.status(201).json({ ok: true, moonId: doc.moonId || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to save memory' });
  }
});

// Restores a trashed memory back into the normal gallery.
router.post('/:id/restore', async (req, res) => {
  try {
    const id = String(req.params.id);

    const restored = await withWriteLock(() => {
      const record = restoreRecord(MEMORIES_DIR, id);
      if (!record) return null;

      const index = readJSON(INDEX_FILE);
      const idx = index.findIndex((m) => m.id === id);
      const indexEntry = toIndexEntry(record);
      if (idx === -1) {
        index.push(indexEntry);
      } else {
        index[idx] = indexEntry;
      }
      writeJSON(INDEX_FILE, index);
      return record;
    });

    if (!restored) {
      return res.status(404).json({ error: 'memory not found in trash' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to restore memory' });
  }
});

// Soft delete: moves the memory into the trash instead of removing it.
router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    await withWriteLock(() => {
      archiveRecord(MEMORIES_DIR, id);
      const index = readJSON(INDEX_FILE).filter((m) => m.id !== id);
      writeJSON(INDEX_FILE, index);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete memory' });
  }
});

// Permanently removes a memory that's already in the trash.
router.delete('/:id/forever', async (req, res) => {
  try {
    const id = String(req.params.id);
    await withWriteLock(() => {
      purgeRecord(MEMORIES_DIR, id);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to permanently delete memory' });
  }
});

module.exports = router;
