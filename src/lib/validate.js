const { MAX_DOC_SIZE, ALLOWED_TYPES } = require('../config');

const PHOTO_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/;
const AUDIO_DATA_URL_RE = /^data:audio\/[a-z0-9.+-]+;base64,/;

// Decoded byte length of the base64 payload portion of a data URL.
function decodedDataUrlSize(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';
  return Buffer.byteLength(base64, 'base64');
}

function validateGalaxy(body) {
  const errors = [];
  const { id, name, accentColor, ring } = body || {};

  if (!id || !name || typeof name !== 'string') {
    errors.push('invalid galaxy: id and name are required');
    return { ok: false, doc: null, errors };
  }

  const ringNum = Number.isInteger(ring) && ring >= 1 && ring <= 3 ? ring : 1;
  const doc = {
    id: String(id),
    name: String(name).slice(0, 60),
    accentColor: accentColor ? String(accentColor).slice(0, 20) : '#ffd9a0',
    ring: ringNum,
    createdAt: new Date().toISOString(),
  };

  return { ok: true, doc, errors };
}

function validateMemory(body) {
  const errors = [];
  const { id, galaxyId, type, title, date, text, photoData, audioData } = body || {};

  if (!id || !ALLOWED_TYPES.includes(type)) {
    errors.push('invalid memory: id and a valid type are required');
  }
  if (!galaxyId || typeof galaxyId !== 'string') {
    errors.push('invalid memory: galaxyId is required');
  }
  if (!title || typeof title !== 'string') {
    errors.push('invalid memory: title is required');
  }
  if (photoData && !PHOTO_DATA_URL_RE.test(photoData)) {
    errors.push('invalid memory: photoData must be an image data URL');
  }
  if (audioData && !AUDIO_DATA_URL_RE.test(audioData)) {
    errors.push('invalid memory: audioData must be an audio data URL');
  }
  if (date && isNaN(new Date(date).getTime())) {
    errors.push('invalid memory: date is not a valid date');
  }

  if (errors.length > 0) {
    return { ok: false, doc: null, errors };
  }

  const doc = {
    id: String(id),
    galaxyId: String(galaxyId),
    type,
    title: String(title).slice(0, 200),
    date: date ? String(date).slice(0, 32) : null,
    text: text ? String(text).slice(0, 20000) : null,
    photoData: photoData || null,
    audioData: audioData || null,
    createdAt: new Date().toISOString(),
  };

  // Re-check size against the decoded (actual binary) payload, not the
  // inflated base64/JSON representation.
  let decodedSize = Buffer.byteLength(
    JSON.stringify({ ...doc, photoData: null, audioData: null }),
    'utf8'
  );
  if (doc.photoData) decodedSize += decodedDataUrlSize(doc.photoData);
  if (doc.audioData) decodedSize += decodedDataUrlSize(doc.audioData);

  if (decodedSize > MAX_DOC_SIZE) {
    errors.push('memory too large — try a smaller photo or audio clip');
    return { ok: false, doc: null, errors };
  }

  return { ok: true, doc, errors };
}

module.exports = { validateGalaxy, validateMemory };
