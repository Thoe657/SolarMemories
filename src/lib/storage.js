const fs = require('fs');
const { DATA_DIR, GALAXIES_FILE, MEMORIES_FILE } = require('../config');

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

module.exports = {
  ensureDataFiles,
  readJSON,
  writeJSON,
  withWriteLock,
};
