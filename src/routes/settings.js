const os = require('os');
const { execFile } = require('child_process');
const express = require('express');
const { SETTINGS_FILE, DATA_DIR } = require('../config');
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

// Reveals data/ in the OS file browser — always the server's own resolved
// DATA_DIR, never a client-supplied path. explorer.exe on Windows routinely
// exits nonzero even when the window opened fine, so this doesn't wait on
// or report the exec result; opening the folder is best-effort chrome, not
// something with a meaningful failure mode for a local single-user app.
router.get('/reveal-data', (req, res) => {
  const platform = os.platform();
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [DATA_DIR], () => {});
  res.json({ ok: true });
});

// Quits the app. Responds first so the confirming click gets an answer,
// then exits shortly after so the response has time to flush.
router.post('/quit', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 200);
});

module.exports = router;
