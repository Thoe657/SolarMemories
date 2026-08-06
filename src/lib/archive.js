const path = require('path');
const { readRecord, writeRecord, deleteRecord, readAllRecords } = require('./storage');

// "Deleted" records live in a `deleted/` subfolder of the record's normal
// directory (e.g. memories/deleted/<id>.json), keeping the primary listing
// fast and purge-sweeps a simple directory scan.
function deletedDir(dir) {
  return path.join(dir, 'deleted');
}

// Moves record `id` from `dir` to `dir/deleted`, stamping deletedAt.
// Returns the archived record, or null if it didn't exist in `dir`.
function archiveRecord(dir, id) {
  const record = readRecord(dir, id);
  if (!record) return null;
  const archived = { ...record, deletedAt: new Date().toISOString() };
  writeRecord(deletedDir(dir), id, archived);
  deleteRecord(dir, id);
  return archived;
}

// Moves record `id` from `dir/deleted` back to `dir`, clearing deletedAt.
// Returns the restored record, or null if it wasn't in the trash.
function restoreRecord(dir, id) {
  const record = readRecord(deletedDir(dir), id);
  if (!record) return null;
  const restored = { ...record, deletedAt: null };
  writeRecord(dir, id, restored);
  deleteRecord(deletedDir(dir), id);
  return restored;
}

// Permanently removes record `id` from `dir/deleted`.
function purgeRecord(dir, id) {
  deleteRecord(deletedDir(dir), id);
}

function listDeleted(dir) {
  return readAllRecords(deletedDir(dir));
}

// Permanently removes archived records whose deletedAt is older than
// `maxAgeMs`. Intended to run once on server start.
function sweepDeleted(dir, maxAgeMs) {
  const now = Date.now();
  listDeleted(dir).forEach((record) => {
    const deletedAt = record.deletedAt ? new Date(record.deletedAt).getTime() : null;
    if (deletedAt !== null && !isNaN(deletedAt) && now - deletedAt > maxAgeMs) {
      purgeRecord(dir, record.id);
    }
  });
}

module.exports = {
  deletedDir,
  archiveRecord,
  restoreRecord,
  purgeRecord,
  listDeleted,
  sweepDeleted,
};
