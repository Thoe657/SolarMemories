const fs = require('fs');
const path = require('path');
const { DATA_DIR, PLANETS_DIR, MEMORIES_DIR, MOONS_DIR, INDEX_FILE, SETTINGS_FILE } = require('../config');

// --- tiny JSON "database" helpers ---

function ensureDataFiles() {
  [DATA_DIR, PLANETS_DIR, MEMORIES_DIR, MOONS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, '[]', 'utf8');
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, '{}', 'utf8');
  }
}

// defaultValue covers both a missing file and unparseable JSON — every
// caller so far reads an array (INDEX_FILE) except SETTINGS_FILE, which is
// a single object, so a corrupt settings.json must not come back as [].
function readJSON(file, defaultValue = []) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw || JSON.stringify(defaultValue));
  } catch (e) {
    console.error(`Failed to read ${file}:`, e.message);
    return defaultValue;
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

// --- one-file-per-record helpers ---

function recordPath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function readRecord(dir, id) {
  const file = recordPath(dir, id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Failed to read ${file}:`, e.message);
    return null;
  }
}

function writeRecord(dir, id, data) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeJSON(recordPath(dir, id), data);
}

function deleteRecord(dir, id) {
  const file = recordPath(dir, id);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function readAllRecords(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch (e) {
        console.error(`Failed to read ${path.join(dir, f)}:`, e.message);
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  ensureDataFiles,
  readJSON,
  writeJSON,
  withWriteLock,
  readRecord,
  writeRecord,
  deleteRecord,
  readAllRecords,
};
