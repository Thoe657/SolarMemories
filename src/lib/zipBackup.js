const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { DATA_DIR, BACKUPS_DIR, BACKUP_KEEP_COUNT } = require('../config');

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

module.exports = {
  ensureBackupsDir,
  listBackups,
  latestBackupTime,
  pruneBackups,
  createBackup,
};
