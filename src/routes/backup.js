const express = require('express');
const path = require('path');
const { createBackup } = require('../lib/zipBackup');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const file = await createBackup();
    res.status(201).json({ ok: true, file: path.basename(file) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create backup' });
  }
});

module.exports = router;
