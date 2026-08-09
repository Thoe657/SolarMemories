const express = require('express');
const { PLANETS_DIR, MEMORIES_DIR, MOONS_DIR, INDEX_FILE } = require('../config');
const { readJSON, writeJSON, withWriteLock, readRecord, writeRecord, readAllRecords } = require('../lib/storage');
const { archiveRecord } = require('../lib/archive');
const { validatePlanet } = require('../lib/validate');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const planets = readAllRecords(PLANETS_DIR)
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ planets });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load planets' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { ok, doc, errors } = validatePlanet(req.body);
    if (!ok) {
      return res.status(400).json({ error: errors[0] });
    }

    await withWriteLock(() => {
      const existing = readRecord(PLANETS_DIR, doc.id);
      if (existing) {
        // keep original createdAt on update
        doc.createdAt = existing.createdAt;
      }
      writeRecord(PLANETS_DIR, doc.id, doc);
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to save planet' });
  }
});

// Soft delete: archives the planet and cascades to archive its (non-deleted)
// memories and moons too, instead of removing any files.
router.delete('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);

    await withWriteLock(() => {
      archiveRecord(PLANETS_DIR, id);

      const index = readJSON(INDEX_FILE);
      const remaining = [];
      index.forEach((entry) => {
        if (entry.planetId === id) {
          archiveRecord(MEMORIES_DIR, entry.id);
        } else {
          remaining.push(entry);
        }
      });
      writeJSON(INDEX_FILE, remaining);

      // Moons aren't in index.json, so find this planet's via a full scan.
      readAllRecords(MOONS_DIR)
        .filter((p) => p.planetId === id)
        .forEach((p) => archiveRecord(MOONS_DIR, p.id));
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete planet' });
  }
});

// Lists a planet's (non-deleted) moons, sorted by index.
router.get('/:id/moons', (req, res) => {
  try {
    const id = String(req.params.id);
    const moons = readAllRecords(MOONS_DIR)
      .filter((p) => p.planetId === id)
      .sort((a, b) => a.index - b.index)
      .map((p) => ({ id: p.id, index: p.index, name: p.name, starCount: p.starCount }));
    res.json({ moons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load moons' });
  }
});

module.exports = router;
