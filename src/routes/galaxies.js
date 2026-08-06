const express = require('express');
const { GALAXIES_FILE, MEMORIES_FILE } = require('../config');
const { readJSON, writeJSON, withWriteLock } = require('../lib/storage');
const { validateGalaxy } = require('../lib/validate');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const galaxies = readJSON(GALAXIES_FILE)
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(({ _id, ...rest }) => rest);
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
      const galaxies = readJSON(GALAXIES_FILE);
      const existingIdx = galaxies.findIndex((g) => g.id === doc.id);
      if (existingIdx === -1) {
        galaxies.push(doc);
      } else {
        // keep original createdAt on update
        doc.createdAt = galaxies[existingIdx].createdAt;
        galaxies[existingIdx] = doc;
      }
      writeJSON(GALAXIES_FILE, galaxies);
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
      const galaxies = readJSON(GALAXIES_FILE).filter((g) => g.id !== id);
      writeJSON(GALAXIES_FILE, galaxies);

      const memories = readJSON(MEMORIES_FILE).filter((m) => m.galaxyId !== id);
      writeJSON(MEMORIES_FILE, memories);
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete galaxy' });
  }
});

module.exports = router;
