const express = require('express');
const { MEMORIES_DIR, INDEX_FILE } = require('../config');
const {
  readJSON,
  writeJSON,
  withWriteLock,
  readRecord,
  writeRecord,
} = require('../lib/storage');
const { archiveRecord, restoreRecord, purgeRecord, listDeleted } = require('../lib/archive');
const { validateMemory } = require('../lib/validate');

const router = express.Router();

function toIndexEntry(doc) {
  return { ...doc, milestone: doc.milestone || false };
}

// Reads the index rather than every memory file. The index mirrors full
// records (including photoData/audioData) so the ring view keeps working
// unchanged. Only non-deleted memories are ever added to the index.
router.get('/', (req, res) => {
  try {
    const galaxyId = req.query.galaxy ? String(req.query.galaxy) : null;
    let memories = readJSON(INDEX_FILE);
    if (galaxyId) {
      memories = memories.filter((m) => m.galaxyId === galaxyId);
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
    const galaxyId = req.query.galaxy ? String(req.query.galaxy) : null;
    let memories = listDeleted(MEMORIES_DIR);
    if (galaxyId) {
      memories = memories.filter((m) => m.galaxyId === galaxyId);
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
        doc.createdAt = existing.createdAt;
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

    res.status(201).json({ ok: true });
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
