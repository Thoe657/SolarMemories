const express = require('express');
const { GALAXIES_FILE, MEMORIES_FILE } = require('../config');
const { readJSON, writeJSON, withWriteLock } = require('../lib/storage');

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
    const { id, name, accentColor, ring } = req.body || {};
    if (!id || !name || typeof name !== 'string') {
      return res.status(400).json({ error: 'invalid galaxy: id and name are required' });
    }
    const ringNum = Number.isInteger(ring) && ring >= 1 && ring <= 3 ? ring : 1;
    const doc = {
      id: String(id),
      name: String(name).slice(0, 60),
      accentColor: accentColor ? String(accentColor).slice(0, 20) : '#ffd9a0',
      ring: ringNum,
      createdAt: new Date().toISOString(),
    };

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
