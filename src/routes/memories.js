const express = require('express');
const { MEMORIES_FILE, MAX_DOC_SIZE, ALLOWED_TYPES } = require('../config');
const { readJSON, writeJSON, withWriteLock } = require('../lib/storage');

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
    const { id, galaxyId, type, title, date, text, photoData, audioData } = req.body || {};

    if (!id || !ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'invalid memory: id and a valid type are required' });
    }
    if (!galaxyId || typeof galaxyId !== 'string') {
      return res.status(400).json({ error: 'invalid memory: galaxyId is required' });
    }
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'invalid memory: title is required' });
    }

    const doc = {
      id: String(id),
      galaxyId: String(galaxyId),
      type,
      title: String(title).slice(0, 200),
      date: date ? String(date).slice(0, 32) : null,
      text: text ? String(text).slice(0, 20000) : null,
      photoData: photoData || null,
      audioData: audioData || null,
      createdAt: new Date().toISOString(),
    };

    const approxSize = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    if (approxSize > MAX_DOC_SIZE) {
      return res.status(413).json({ error: 'memory too large — try a smaller photo or audio clip' });
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
