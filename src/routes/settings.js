const express = require('express');
const { SETTINGS_FILE } = require('../config');
const { readJSON, writeJSON, withWriteLock } = require('../lib/storage');
const { validateSettings } = require('../lib/validate');

const router = express.Router();

router.get('/', (req, res) => {
  const settings = readJSON(SETTINGS_FILE);
  res.json({ ownerName: settings.ownerName || '' });
});

router.put('/', async (req, res) => {
  const { ok, doc, errors } = validateSettings(req.body);
  if (!ok) {
    return res.status(400).json({ error: errors.join('; ') });
  }
  await withWriteLock(() => writeJSON(SETTINGS_FILE, doc));
  res.json({ ok: true, ownerName: doc.ownerName });
});

module.exports = router;
