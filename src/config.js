const path = require('path');

const PORT = 3000;

// All data is stored as JSON files inside this folder on the PC.
// Change DATA_DIR if you want it somewhere else (e.g. a Dropbox/iCloud folder for backup).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// Legacy flat files (pre Phase 2). No longer read/written by the server —
// scripts/migrate.js reads these as its migration source and leaves them
// in place as an inert backup.
const GALAXIES_FILE = path.join(DATA_DIR, 'galaxies.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

// Current one-file-per-record layout.
const GALAXIES_DIR = path.join(DATA_DIR, 'galaxies');
const MEMORIES_DIR = path.join(DATA_DIR, 'memories');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

const MAX_DOC_SIZE = 8 * 1024 * 1024; // 8MB safety margin
const ALLOWED_TYPES = ['photo', 'letter', 'audio'];

// How long a soft-deleted record stays in `deleted/` before being purged.
const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

module.exports = {
  PORT,
  DATA_DIR,
  GALAXIES_FILE,
  MEMORIES_FILE,
  GALAXIES_DIR,
  MEMORIES_DIR,
  INDEX_FILE,
  MAX_DOC_SIZE,
  ALLOWED_TYPES,
  TRASH_MAX_AGE_MS,
};
