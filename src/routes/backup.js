const fs = require('fs');
const express = require('express');
const path = require('path');
const { createBackup, listBackups, restoreBackup } = require('../lib/zipBackup');
const { withWriteLock } = require('../lib/storage');
const { BACKUPS_DIR } = require('../config');

const router = express.Router();

// Newest first, filename + mtime -- the frontend renders this as the
// restore-from-backup list.
router.get('/', (req, res) => {
  try {
    const backups = listBackups()
      .map((filename) => ({
        filename,
        mtime: fs.statSync(path.join(BACKUPS_DIR, filename)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ backups });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to list backups' });
  }
});

router.post('/', async (req, res) => {
  try {
    const file = await createBackup();
    res.status(201).json({ ok: true, file: path.basename(file) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create backup' });
  }
});

// Wrapped in withWriteLock since this mutates data/ wholesale, the same
// concurrency guard every other write path in the app goes through.
router.post('/:filename/restore', async (req, res) => {
  try {
    await withWriteLock(() => restoreBackup(req.params.filename));
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'INVALID_BACKUP') {
      return res.status(400).json({ error: e.message });
    }
    console.error(e);
    res.status(500).json({ error: 'failed to restore backup' });
  }
});

module.exports = router;
