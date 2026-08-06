const express = require('express');
const { MEMORIES_DIR, INDEX_FILE } = require('../config');
const {
  readJSON,
  writeJSON,
  withWriteLock,
  readRecord,
  writeRecord,
  deleteRecord,
} = require('../lib/storage');
const { validateMemory } = require('../lib/validate');

const router = express.Router();

// Reads the index rather than every memory file. The index mirrors full
// records (including photoData/audioData) so the ring view keeps working
// unchanged.
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

      // The index mirrors the full record (including photoData/audioData)
      // so the ring view can render photo thumbnails and the read view can
      // show text/audio without an extra per-card fetch.
      const indexEntry = { ...doc, milestone: doc.milestone || false };
      const index = readJSON(INDEX_FILE);
      const idx = index.findIndex((m) => m.id === doc.id);
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

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    await withWriteLock(() => {
      deleteRecord(MEMORIES_DIR, id);
      const index = readJSON(INDEX_FILE).filter((m) => m.id !== id);
      writeJSON(INDEX_FILE, index);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete memory' });
  }
});

module.exports = router;
