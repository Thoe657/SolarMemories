const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const archiver = require('archiver');
const { DATA_DIR, BACKUPS_DIR, BACKUP_KEEP_COUNT } = require('../config');
const { ensureDataFiles } = require('./storage');

// Thrown for a restore request that must not touch data/ at all: an
// unrecognised filename (would be path traversal) or a backup whose schema
// predates a rename this code doesn't know how to migrate on the fly.
class RestoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RestoreError';
    this.code = 'INVALID_BACKUP';
  }
}

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

// ISO-timestamped filenames sort chronologically as plain strings.
function listBackups() {
  ensureBackupsDir();
  return fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .sort();
}

// mtime of the most recent backup, or null if there are none.
function latestBackupTime() {
  const backups = listBackups();
  if (backups.length === 0) return null;
  const latest = backups[backups.length - 1];
  return fs.statSync(path.join(BACKUPS_DIR, latest)).mtimeMs;
}

function pruneBackups(keepCount) {
  const backups = listBackups();
  if (backups.length <= keepCount) return;
  backups
    .slice(0, backups.length - keepCount)
    .forEach((f) => fs.unlinkSync(path.join(BACKUPS_DIR, f)));
}

// Zips the entire data/ directory into backups/backup-<ISO-timestamp>.zip,
// then prunes older backups beyond keepCount. Resolves with the path to the
// new zip.
function createBackup(keepCount = BACKUP_KEEP_COUNT) {
  ensureBackupsDir();
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(BACKUPS_DIR, `backup-${timestamp}.zip`);
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      pruneBackups(keepCount);
      resolve(outFile);
    });
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(DATA_DIR, 'data');
    archive.finalize();
  });
}

/* ------------------------------------------------------------
   Minimal zip reader
   -----------------------------------------------------------
   `createBackup` above already depends on `archiver` to *write* zips;
   nothing in this project's dependency tree (checked node_modules —
   `archiver`'s own transitive deps only include `zip-stream`, a writer)
   reads them back. Rather than add a new dependency for something this
   small, this reads the standard zip central-directory format directly,
   using only Node's built-in `zlib` for decompression (archiver always
   writes DEFLATE, method 8, at level 9 — STORED, method 0, is also
   handled since archiver can emit it for zero-byte entries).
   Only ever pointed at zip files this app created itself via
   `createBackup`, never at arbitrary user-supplied zips.
------------------------------------------------------------ */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

// The End Of Central Directory record sits at the end of the file, but a
// variable-length comment field can follow it, so its offset isn't fixed —
// scan backward for the signature.
function findEndOfCentralDirectory(buf) {
  const minPos = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('not a valid zip file (no End Of Central Directory record found)');
}

// Returns every entry's metadata (name, compression method, sizes, and the
// offset of its local file header) from a zip file's central directory.
function readZipEntries(buf) {
  const eocdPos = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocdPos + 10);
  let pos = buf.readUInt32LE(eocdPos + 16);

  const entries = [];
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(pos) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('malformed zip central directory');
    }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset, isDir: name.endsWith('/') });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Reads and decompresses one entry's file data, given its central-directory
// metadata (jumps to its local file header to find where the data starts,
// since the local header's own name/extra field lengths can differ in
// theory, though archiver writes them identically).
function readZipEntryData(buf, entry) {
  const pos = entry.localHeaderOffset;
  if (buf.readUInt32LE(pos) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`malformed zip local file header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(pos + 26);
  const extraLen = buf.readUInt16LE(pos + 28);
  const dataStart = pos + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed; // stored, no compression
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`unsupported zip compression method ${entry.method} for ${entry.name}`);
}

// Extracts every entry under `prefix` (e.g. "data/") into destDir, with the
// prefix stripped. Refuses to write outside destDir even if an entry's name
// contains "../" — defense in depth, since these zips are otherwise trusted
// (this app's own backups), not arbitrary uploads.
function unzipInto(buf, entries, prefix, destDir) {
  const resolvedDest = path.resolve(destDir);
  entries.forEach((entry) => {
    if (!entry.name.startsWith(prefix)) return;
    const rel = entry.name.slice(prefix.length);
    if (!rel) return; // the prefix directory entry itself
    const destPath = path.resolve(destDir, rel);
    if (destPath !== resolvedDest && !destPath.startsWith(resolvedDest + path.sep)) {
      console.warn(`Skipping zip entry outside destination: ${entry.name}`);
      return;
    }
    if (entry.isDir) {
      fs.mkdirSync(destPath, { recursive: true });
      return;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, readZipEntryData(buf, entry));
  });
}

// Restores data/ from a previously-created backup zip. `filename` must be
// exactly one of listBackups()'s current entries -- rejecting anything else
// up front is what stops a crafted filename (e.g. containing "../") from
// ever reaching the filesystem as a path. Before overwriting anything, the
// *current* data/ is copied to data.bak-<timestamp>/ (same pattern as
// scripts/backfill-moons.js's automatic pre-write backup), so an accidental
// or regretted restore is itself recoverable.
function restoreBackup(filename) {
  const validNames = listBackups();
  if (!validNames.includes(filename)) {
    throw new RestoreError(`"${filename}" is not a known backup`);
  }

  const zipPath = path.join(BACKUPS_DIR, filename);
  const buf = fs.readFileSync(zipPath);
  const entries = readZipEntries(buf);

  // Phase 11 renamed the on-disk layout (galaxy -> planet, planet -> moon);
  // a backup taken before that migration still has a top-level "data/galaxies/"
  // directory (see that phase's note in docs/PLAN.md). Restoring it as-is
  // would silently repopulate data/ with the old schema, which the rest of
  // this app no longer understands -- refuse rather than guess.
  const isPreRenameSchema = entries.some((e) => e.name.startsWith('data/galaxies/'));
  if (isPreRenameSchema) {
    throw new RestoreError(
      `"${filename}" predates the galaxy->planet/moon rename and can't be restored automatically -- ` +
      `restore it by hand from data.bak-*/ if you need it`
    );
  }

  const preRestoreBackupDir = `${DATA_DIR}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.cpSync(DATA_DIR, preRestoreBackupDir, { recursive: true });

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  unzipInto(buf, entries, 'data/', DATA_DIR);

  // Guards against an old/partial backup missing a directory this version
  // of the app expects (e.g. moons/, added after some earlier backups).
  ensureDataFiles();

  return { preRestoreBackupDir };
}

module.exports = {
  ensureBackupsDir,
  listBackups,
  latestBackupTime,
  pruneBackups,
  createBackup,
  restoreBackup,
  RestoreError,
};
