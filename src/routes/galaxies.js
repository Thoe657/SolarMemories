const express = require('express');
const { GALAXIES_DIR, MEMORIES_DIR, INDEX_FILE } = require('../config');
const {
  readJSON,
  writeJSON,
  withWriteLock,
  readRecord,
  writeRecord,
  deleteRecord,
  readAllRecords,
} = require('../lib/storage');
const { validateGalaxy } = require('../lib/validate');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const galaxies = readAllRecords(GALAXIES_DIR)
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ galaxies });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load galaxies' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { ok, doc, errors } = validateGalaxy(req.body);
    if (!ok) {
      return res.status(400).json({ error: errors[0] });
    }

    await withWriteLock(() => {
      const existing = readRecord(GALAXIES_DIR, doc.id);
      if (existing) {
        // keep original createdAt on update
        doc.createdAt = existing.createdAt;
      }
      writeRecord(GALAXIES_DIR, doc.id, doc);
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to save galaxy' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);

    await withWriteLock(() => {
      deleteRecord(GALAXIES_DIR, id);

      // cascade: drop this galaxy's memories too
      const index = readJSON(INDEX_FILE);
      const remaining = [];
      index.forEach((entry) => {
        if (entry.galaxyId === id) {
          deleteRecord(MEMORIES_DIR, entry.id);
        } else {
          remaining.push(entry);
        }
      });
      writeJSON(INDEX_FILE, remaining);
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete galaxy' });
  }
});

module.exports = router;
