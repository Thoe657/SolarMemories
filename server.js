const path = require('path');
const express = require('express');

const { PORT, DATA_DIR, PLANETS_DIR, MEMORIES_DIR, MOONS_DIR, TRASH_MAX_AGE_MS, BACKUP_STALE_MS } = require('./src/config');
const { ensureDataFiles } = require('./src/lib/storage');
const { sweepDeleted } = require('./src/lib/archive');
const { latestBackupTime, createBackup } = require('./src/lib/zipBackup');
const planetsRouter = require('./src/routes/planets');
const memoriesRouter = require('./src/routes/memories');
const backupRouter = require('./src/routes/backup');

ensureDataFiles();
sweepDeleted(PLANETS_DIR, TRASH_MAX_AGE_MS);
sweepDeleted(MEMORIES_DIR, TRASH_MAX_AGE_MS);
sweepDeleted(MOONS_DIR, TRASH_MAX_AGE_MS);

const app = express();
app.use(express.json({ limit: '12mb' }));
/* Long-lived caching for the two folders whose contents never change in place:
   assets/ (the baked skies) and lib/ (the vendored three.js). Together that is
   ~1.2MB that a warm load was re-validating on every single start -- three
   conditional requests before the first frame, each a round trip, for files
   that are only ever *replaced*, never edited. `immutable` is what stops the
   revalidation; without it a browser still asks "has this changed?" and waits
   for the 304.

   Anything that changes in place -- index.html, the ES modules under js/, the
   stylesheet -- deliberately keeps the default no-cache-header behaviour, so
   editing a module and reloading shows the edit. Nothing here is fingerprinted,
   so a sky or a three.js upgrade needs a new filename (assets/ is versioned by
   name already: nebula-1/2/3, and three.min.js carries its version in
   package.json). Changing one in place would leave a year-old copy in the
   browser's cache with no way to invalidate it. */
const IMMUTABLE = { maxAge: '365d', immutable: true };
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), IMMUTABLE));
app.use('/lib', express.static(path.join(__dirname, 'public', 'lib'), IMMUTABLE));

// Everything else keeps the default headers, so an edited module shows up on reload.
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/planets', planetsRouter);
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
