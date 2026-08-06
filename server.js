const path = require('path');
const express = require('express');

const { PORT, DATA_DIR, GALAXIES_DIR, MEMORIES_DIR, TRASH_MAX_AGE_MS } = require('./src/config');
const { ensureDataFiles } = require('./src/lib/storage');
const { sweepDeleted } = require('./src/lib/archive');
const galaxiesRouter = require('./src/routes/galaxies');
const memoriesRouter = require('./src/routes/memories');

ensureDataFiles();
sweepDeleted(GALAXIES_DIR, TRASH_MAX_AGE_MS);
sweepDeleted(MEMORIES_DIR, TRASH_MAX_AGE_MS);

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/galaxies', galaxiesRouter);
app.use('/api/memories', memoriesRouter);

app.listen(PORT, () => {
  console.log(`\nMaddi's Memories is running!`);
  console.log(`Data is stored in: ${DATA_DIR}`);
  console.log(`Open http://localhost:${PORT} in your browser.\n`);
});
