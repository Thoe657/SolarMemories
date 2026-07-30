const path = require('path');
const fs = require('fs');
const express = require('express');

const PORT = 3000;

// All data is stored as JSON files inside this folder on the PC.
// Change DATA_DIR if you want it somewhere else (e.g. a Dropbox/iCloud folder for backup).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const GALAXIES_FILE = path.join(DATA_DIR, 'galaxies.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

const MAX_DOC_SIZE = 8 * 1024 * 1024; // 8MB safety margin
const ALLOWED_TYPES = ['photo', 'letter', 'audio'];

// --- tiny JSON "database" helpers ---

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(GALAXIES_FILE)) {
    fs.writeFileSync(GALAXIES_FILE, '[]', 'utf8');
  }
  if (!fs.existsSync(MEMORIES_FILE)) {
    fs.writeFileSync(MEMORIES_FILE, '[]', 'utf8');
  }
}

function readJSON(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error(`Failed to read ${file}:`, e.message);
    return [];
  }
}

// Write atomically: write to a temp file then rename, so a crash mid-write
// can't corrupt the data file.
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// Very simple write queue so concurrent requests don't clobber each other's
// read-modify-write cycles.
let writeQueue = Promise.resolve();
function withWriteLock(fn) {
  writeQueue = writeQueue.then(fn, fn);
  return writeQueue;
}

// --- app setup ---

ensureDataFiles();

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/galaxies', (req, res) => {
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

app.post('/api/galaxies', async (req, res) => {
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

app.delete('/api/galaxies/:id', async (req, res) => {
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

app.get('/api/memories', (req, res) => {
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

app.post('/api/memories', async (req, res) => {
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

app.delete('/api/memories/:id', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`\nMaddi's Memories is running!`);
  console.log(`Data is stored in: ${DATA_DIR}`);
  console.log(`Open http://localhost:${PORT} in your browser.\n`);
});