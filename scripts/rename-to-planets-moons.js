#!/usr/bin/env node
// One-time Phase 11 data migration: renames the on-disk layout to match the
// "galaxy -> planet, [old] planet -> moon" terminology rename. Run with
// --dry-run to preview without writing.
//
// SEQUENCING: the destination name for the top-level rename ("planets") is
// currently occupied by the old star-grouping records. Everything here reads
// the old "planets" directory (star groupings, now moons) fully into memory
// and deletes it *before* the old "galaxies" directory is moved into that
// now-vacated "planets" path -- doing it in the other order, or writing new
// planet records into data/planets/ before removing the old occupant, risks
// deleting freshly-written data along with the directory being cleared.
//
// Field renames are built as fresh objects, never sequential in-place key
// renames -- a memory record has both `galaxyId` and (old) `planetId` on it
// at once, and renaming one into the other's name first would clobber it:
//   - old star-grouping record: galaxyId -> planetId
//   - memory record (+ index.json entries): galaxyId -> planetId,
//     old planetId -> moonId
//   - top-level galaxy record: no field rename needed (id/name/accentColor/
//     ring/deletedAt/createdAt don't reference the concept by name)
//
// Star-grouping names drawn from the old (planet/exoplanet) pool no longer
// fit now that they're moons -- any name not in the new MOON_NAMES pool is
// re-rolled, avoiding names already used on the same planet. These are
// server-generated names the user never chose, so nothing of theirs is lost.
const fs = require('fs');
const path = require('path');
const {
  DATA_DIR,
  PLANETS_DIR,
  MOONS_DIR,
  MEMORIES_DIR,
  INDEX_FILE,
} = require('../src/config');
const { MOON_NAMES, randomMoonName } = require('../src/lib/moonNames');

const OLD_TOP_DIR = path.join(DATA_DIR, 'galaxies');  // -> PLANETS_DIR
const OLD_GROUP_DIR = path.join(DATA_DIR, 'planets'); // -> MOONS_DIR (must be read + vacated first)

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
}

function readJsonRecord(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function writeJsonRecord(dir, file, data) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

// Reads every record (top-level + deleted/) from `dir` before anything is
// deleted, so the whole tree can be safely removed afterward.
function readAllWithDeleted(dir) {
  const top = listJsonFiles(dir).map((file) => ({ file, deleted: false, rec: readJsonRecord(dir, file) }));
  const deletedDir = path.join(dir, 'deleted');
  const deleted = listJsonFiles(deletedDir).map((file) => ({ file, deleted: true, rec: readJsonRecord(deletedDir, file) }));
  return [...top, ...deleted];
}

function renameGroupFields(rec) {
  const { galaxyId, ...rest } = rec;
  return galaxyId !== undefined ? { ...rest, planetId: galaxyId } : rec;
}

function renameMemoryFields(rec) {
  const { galaxyId, planetId, ...rest } = rec;
  const out = { ...rest };
  if (galaxyId !== undefined) out.planetId = galaxyId;
  if (planetId !== undefined) out.moonId = planetId;
  return out;
}

// Moves a whole directory tree via rename (atomic, cheap); falls back to
// copy+remove if the rename fails, since OneDrive-synced folders on Windows
// can transiently lock files mid-sync and reject a plain rename.
function moveDirTree(from, to) {
  if (!fs.existsSync(from)) return;
  try {
    fs.renameSync(from, to);
  } catch (e) {
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function planMoonRename(entries) {
  const takenByPlanet = new Map(); // planetId -> names already assigned during this run
  return entries.map(({ file, deleted, rec }) => {
    const renamed = renameGroupFields(rec);
    let finalRec = renamed;
    if (!MOON_NAMES.includes(renamed.name)) {
      const planetId = renamed.planetId;
      const taken = takenByPlanet.get(planetId) || [];
      const newName = randomMoonName(taken);
      takenByPlanet.set(planetId, [...taken, newName]);
      finalRec = { ...renamed, name: newName };
    }
    return { file, deleted, before: rec, after: finalRec };
  });
}

function main() {
  const dryRun = process.argv.includes('--dry-run');

  const groupEntries = readAllWithDeleted(OLD_GROUP_DIR);
  const moonPlan = planMoonRename(groupEntries);

  const topLevelCount = listJsonFiles(OLD_TOP_DIR).length + listJsonFiles(path.join(OLD_TOP_DIR, 'deleted')).length;

  const memoryEntries = readAllWithDeleted(MEMORIES_DIR);
  const index = fs.existsSync(INDEX_FILE) ? JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8') || '[]') : [];

  console.log('Rename plan (Phase 11: galaxy -> planet, planet -> moon):');
  console.log(`  ${topLevelCount} galaxy record(s) -> ${PLANETS_DIR} (directory move, no field changes)`);
  console.log(`  ${moonPlan.length} old planet (star-grouping) record(s) -> ${MOONS_DIR}`);
  moonPlan.forEach(({ before, after, deleted }) => {
    const renamedNote = before.name !== after.name ? ` [name re-rolled: "${before.name}" -> "${after.name}"]` : '';
    console.log(`    ${deleted ? '(deleted) ' : ''}${before.id}: galaxyId ${before.galaxyId} -> planetId ${after.planetId}${renamedNote}`);
  });
  console.log(`  ${memoryEntries.length} memory record(s): galaxyId -> planetId, planetId -> moonId`);
  console.log(`  ${index.length} index.json entries: same field rename`);

  if (memoryEntries[0]) {
    const before = memoryEntries[0].rec;
    console.log(`  sample memory: ${JSON.stringify(before)}\n    -> ${JSON.stringify(renameMemoryFields(before))}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no files were written or moved.');
    return;
  }

  // Data safety: back up the whole data/ dir before any write, mirroring
  // backfill-moons.js's convention.
  const backupDir = `${DATA_DIR}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.cpSync(DATA_DIR, backupDir, { recursive: true });
  console.log(`Backed up ${DATA_DIR} -> ${backupDir}`);

  // 1) Vacate the "planets" path: everything from it is already captured in
  // moonPlan, so the old directory (including its deleted/ subfolder) can go.
  fs.rmSync(OLD_GROUP_DIR, { recursive: true, force: true });

  // 2) Claim the now-free "planets" path for the top-level (ex-galaxy)
  // records. Pure directory move -- no field changes needed on these.
  moveDirTree(OLD_TOP_DIR, PLANETS_DIR);

  // 3) Write the transformed moon records into their new home.
  moonPlan.forEach(({ file, deleted, after }) => {
    writeJsonRecord(deleted ? path.join(MOONS_DIR, 'deleted') : MOONS_DIR, file, after);
  });

  // 4) Rewrite memory records in place (directory doesn't move, just fields).
  memoryEntries.forEach(({ file, deleted, rec }) => {
    const dir = deleted ? path.join(MEMORIES_DIR, 'deleted') : MEMORIES_DIR;
    writeJsonRecord(dir, file, renameMemoryFields(rec));
  });

  // 5) Rewrite the index.
  const newIndex = index.map(renameMemoryFields);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(newIndex, null, 2), 'utf8');

  console.log(`\nDone. ${topLevelCount} planet record(s), ${moonPlan.length} moon record(s), ${memoryEntries.length} memory record(s), ${newIndex.length} index entries.`);
}

main();
