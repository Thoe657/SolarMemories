const express = require('express');
const { GALAXIES_DIR, MEMORIES_DIR, PLANETS_DIR, INDEX_FILE } = require('../config');
const { readJSON, writeJSON, withWriteLock, readRecord, writeRecord, readAllRecords } = require('../lib/storage');
const { archiveRecord } = require('../lib/archive');
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

// Soft delete: archives the galaxy and cascades to archive its (non-deleted)
// memories and planets too, instead of removing any files.
router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);

    await withWriteLock(() => {
      archiveRecord(GALAXIES_DIR, id);

      const index = readJSON(INDEX_FILE);
      const remaining = [];
      index.forEach((entry) => {
        if (entry.galaxyId === id) {
          archiveRecord(MEMORIES_DIR, entry.id);
        } else {
          remaining.push(entry);
        }
      });
      writeJSON(INDEX_FILE, remaining);

      // Planets aren't in index.json, so find this galaxy's via a full scan.
      readAllRecords(PLANETS_DIR)
        .filter((p) => p.galaxyId === id)
        .forEach((p) => archiveRecord(PLANETS_DIR, p.id));
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete galaxy' });
  }
});

// Lists a galaxy's (non-deleted) planets, sorted by index.
router.get('/:id/planets', (req, res) => {
  try {
    const id = String(req.params.id);
    const planets = readAllRecords(PLANETS_DIR)
      .filter((p) => p.galaxyId === id)
      .sort((a, b) => a.index - b.index)
      .map((p) => ({ id: p.id, index: p.index, name: p.name, starCount: p.starCount }));
    res.json({ planets });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load planets' });
  }
});

module.exports = router;
