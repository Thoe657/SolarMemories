const path = require('path');
const express = require('express');

const { PORT, DATA_DIR, GALAXIES_DIR, MEMORIES_DIR, TRASH_MAX_AGE_MS, BACKUP_STALE_MS } = require('./src/config');
const { ensureDataFiles } = require('./src/lib/storage');
const { sweepDeleted } = require('./src/lib/archive');
const { latestBackupTime, createBackup } = require('./src/lib/zipBackup');
const galaxiesRouter = require('./src/routes/galaxies');
const memoriesRouter = require('./src/routes/memories');
const backupRouter = require('./src/routes/backup');

ensureDataFiles();
sweepDeleted(GALAXIES_DIR, TRASH_MAX_AGE_MS);
sweepDeleted(MEMORIES_DIR, TRASH_MAX_AGE_MS);

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/galaxies', galaxiesRouter);
app.use('/api/memories', memoriesRouter);
app.use('/api/backup', backupRouter);

app.listen(PORT, () => {
  console.log(`\nMaddi's Memories is running!`);
  console.log(`Data is stored in: ${DATA_DIR}`);
  console.log(`Open http://localhost:${PORT} in your browser.\n`);
});

// If the newest backup is stale (or there isn't one), back up in the
// background -- doesn't block startup or the first requests.
const latest = latestBackupTime();
if (latest === null || Date.now() - latest > BACKUP_STALE_MS) {
  createBackup()
    .then((file) => console.log(`Startup backup created: ${file}`))
    .catch((e) => console.error('Startup backup failed:', e.message));
}
