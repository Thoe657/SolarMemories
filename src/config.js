const path = require('path');

const PORT = 3000;

// All data is stored as JSON files inside this folder on the PC.
// Change DATA_DIR if you want it somewhere else (e.g. a Dropbox/iCloud folder for backup).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const GALAXIES_FILE = path.join(DATA_DIR, 'galaxies.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

const MAX_DOC_SIZE = 8 * 1024 * 1024; // 8MB safety margin
const ALLOWED_TYPES = ['photo', 'letter', 'audio'];

module.exports = {
  PORT,
  DATA_DIR,
  GALAXIES_FILE,
  MEMORIES_FILE,
  MAX_DOC_SIZE,
  ALLOWED_TYPES,
};
