const express = require('express');
const { MEMORIES_FILE } = require('../config');
const { readJSON, writeJSON, withWriteLock } = require('../lib/storage');
const { validateMemory } = require('../lib/validate');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const galaxyId = req.query.galaxy ? String(req.query.galaxy) : null;
    let memories = readJSON(MEMORIES_FILE);
    if (galaxyId) {
      memories = memories.filter((m) => m.galaxyId === galaxyId);
    }
    memories = memories
      .slice()
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map(({ _id, ...rest }) => rest);
    res.json({ memories });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to load memories' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { ok, doc, errors } = validateMemory(req.body);
    if (!ok) {
      return res.status(400).json({ error: errors[0] });
    }

    await withWriteLock(() => {
      const memories = readJSON(MEMORIES_FILE);
      const existingIdx = memories.findIndex((m) => m.id === doc.id);
      if (existingIdx === -1) {
        memories.push(doc);
      } else {
        doc.createdAt = memories[existingIdx].createdAt;
        memories[existingIdx] = doc;
      }
      writeJSON(MEMORIES_FILE, memories);
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
      const memories = readJSON(MEMORIES_FILE).filter((m) => m.id !== id);
      writeJSON(MEMORIES_FILE, memories);
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to delete memory' });
  }
});

module.exports = router;
