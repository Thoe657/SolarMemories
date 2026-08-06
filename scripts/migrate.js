#!/usr/bin/env node
// Migrates data/galaxies.json + data/memories.json (the old flat-file
// layout) into the one-file-per-record layout: data/galaxies/<id>.json,
// data/memories/<id>.json, and data/index.json (mirrors the full memory
// records, including photoData/audioData, so the ring view and read view
// keep working without an extra per-card fetch). Run with --dry-run to
// preview without writing.
const fs = require('fs');
const path = require('path');
const {
  DATA_DIR,
  GALAXIES_FILE,
  MEMORIES_FILE,
  GALAXIES_DIR,
  MEMORIES_DIR,
  INDEX_FILE,
} = require('../src/config');

function readJSONFlat(file) {
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
  } catch (e) {
    console.error(`Failed to read ${file}:`, e.message);
    return [];
  }
}

function writeJSONAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function buildIndexEntry(m) {
  return { ...m, milestone: m.milestone || false };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');

  const galaxies = readJSONFlat(GALAXIES_FILE);
  const memories = readJSONFlat(MEMORIES_FILE);
  const indexEntries = memories.map(buildIndexEntry);

  console.log(`Migration plan (source: ${GALAXIES_FILE}, ${MEMORIES_FILE}):`);
  console.log(`  ${galaxies.length} galaxies -> ${GALAXIES_DIR}\\<id>.json`);
  console.log(`  ${memories.length} memories -> ${MEMORIES_DIR}\\<id>.json (full record)`);
  console.log(`  ${indexEntries.length} index entries -> ${INDEX_FILE}`);
  if (galaxies.length) {
    console.log(`  sample galaxy: ${JSON.stringify(galaxies[0])}`);
  }
  if (indexEntries.length) {
    console.log(`  sample index entry: ${JSON.stringify(indexEntries[0])}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no files were written.');
    return;
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(GALAXIES_DIR)) fs.mkdirSync(GALAXIES_DIR, { recursive: true });
  if (!fs.existsSync(MEMORIES_DIR)) fs.mkdirSync(MEMORIES_DIR, { recursive: true });

  // Back up the old flat files before writing anything new. The originals
  // are left in place too -- removing them later is a manual step.
  if (fs.existsSync(GALAXIES_FILE)) {
    fs.copyFileSync(GALAXIES_FILE, GALAXIES_FILE + '.bak');
    console.log(`Backed up ${GALAXIES_FILE} -> ${GALAXIES_FILE}.bak`);
  }
  if (fs.existsSync(MEMORIES_FILE)) {
    fs.copyFileSync(MEMORIES_FILE, MEMORIES_FILE + '.bak');
    console.log(`Backed up ${MEMORIES_FILE} -> ${MEMORIES_FILE}.bak`);
  }

  galaxies.forEach((g) => {
    writeJSONAtomic(path.join(GALAXIES_DIR, `${g.id}.json`), g);
  });
  memories.forEach((m) => {
    writeJSONAtomic(path.join(MEMORIES_DIR, `${m.id}.json`), m);
  });
  writeJSONAtomic(INDEX_FILE, indexEntries);

  console.log(`\nWrote ${galaxies.length} galaxy file(s), ${memories.length} memory file(s), and the index.`);
}

main();
