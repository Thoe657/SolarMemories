#!/usr/bin/env node
// Plan 3 Phase 1 measurement harness, offline half: reports what entering a
// planet costs the client today, from data/ alone -- no server, no browser.
// For each planet it rebuilds exactly what GET /api/memories?planet=<id>
// would answer (the index, filtered by planet and sorted by createdAt, see
// src/routes/memories.js) and measures the serialized payload, plus how much
// of it is base64 media that the ring never looks at until a card is opened.
// This is the script that produced finding 6 in docs/PLAN.md.
//
// READ-ONLY. It only ever reads data/ -- nothing here writes, moves or
// deletes, and there is no --dry-run because there is nothing to run for real.
const fs = require('fs');
const { DATA_DIR, PLANETS_DIR, INDEX_FILE } = require('../src/config');
const { readJSON, readAllRecords } = require('../src/lib/storage');

// 1024-based, and said so in the output: docs/PLAN.md's finding 6 quotes
// Theo at 7.21MB (1024-based) and index.json at 7.58MB (1000-based) -- the
// same bytes, measured two different ways. One convention here, plus exact
// byte counts, so a later phase can't be misread as a regression.
function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function formatPercent(part, whole) {
  if (!whole) return '-';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

// The bytes photoData/audioData occupy in the response, quotes and escapes
// included -- that's what actually goes over the wire.
function mediaBytes(memories) {
  return memories.reduce((sum, m) => {
    let n = 0;
    if (typeof m.photoData === 'string') n += Buffer.byteLength(JSON.stringify(m.photoData));
    if (typeof m.audioData === 'string') n += Buffer.byteLength(JSON.stringify(m.audioData));
    return sum + n;
  }, 0);
}

// Same shape the route responds with, so the byte count is the real one and
// not an estimate: filter by planet, sort oldest-first, wrap in { memories }.
function payloadBytes(memories) {
  const sorted = memories.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return Buffer.byteLength(JSON.stringify({ memories: sorted }));
}

function buildReport() {
  // Only non-deleted memories are ever added to the index, so every entry
  // here is a star the ring would draw.
  const index = readJSON(INDEX_FILE);
  const planets = readAllRecords(PLANETS_DIR).filter((p) => !p.deletedAt);

  const byPlanet = new Map();
  index.forEach((m) => {
    const key = m.planetId || '(none)';
    if (!byPlanet.has(key)) byPlanet.set(key, []);
    byPlanet.get(key).push(m);
  });

  const rows = planets.map((p) => {
    const memories = byPlanet.get(p.id) || [];
    byPlanet.delete(p.id);
    return {
      name: p.name,
      id: p.id,
      stars: memories.length,
      payload: payloadBytes(memories),
      media: mediaBytes(memories),
    };
  });

  // Index entries pointing at a planet that no longer has a record (deleted
  // planet, half-finished cascade). Worth seeing rather than silently dropping.
  byPlanet.forEach((memories, planetId) => {
    rows.push({
      name: '(orphaned)',
      id: planetId,
      stars: memories.length,
      payload: payloadBytes(memories),
      media: mediaBytes(memories),
    });
  });

  rows.sort((a, b) => b.payload - a.payload);
  return rows;
}

function main() {
  const rows = buildReport();
  const indexSize = fs.existsSync(INDEX_FILE) ? fs.statSync(INDEX_FILE).size : 0;

  const totals = rows.reduce((t, r) => ({
    stars: t.stars + r.stars,
    payload: t.payload + r.payload,
    media: t.media + r.media,
  }), { stars: 0, payload: 0, media: 0 });

  const cols = [26, 32, 6, 10, 10, 8];
  const line = (cells) => cells
    .map((c, i) => (i === 0 || i === 1 ? String(c).slice(0, cols[i]).padEnd(cols[i]) : String(c).padStart(cols[i])))
    .join(' ')
    .trimEnd();

  console.log(`Payload report (source: ${INDEX_FILE}, read-only):`);
  console.log('What GET /api/memories?planet=<id> ships to the client today.');
  console.log('Sizes are 1024-based (1MB = 1048576 bytes).\n');
  console.log(line(['planet', 'id', 'stars', 'payload', 'media', 'media%']));
  console.log('-'.repeat(cols.reduce((n, c) => n + c + 1, -1)));
  rows.forEach((r) => {
    console.log(line([
      r.name,
      r.id,
      r.stars,
      formatBytes(r.payload),
      formatBytes(r.media),
      formatPercent(r.media, r.payload),
    ]));
  });
  console.log('-'.repeat(cols.reduce((n, c) => n + c + 1, -1)));
  console.log(line([
    'TOTAL',
    `${rows.length} planet(s)`,
    totals.stars,
    formatBytes(totals.payload),
    formatBytes(totals.media),
    formatPercent(totals.media, totals.payload),
  ]));

  console.log(`\n${INDEX_FILE}`);
  console.log(`  ${formatBytes(indexSize)} on disk -- ${indexSize} bytes, i.e. ${(indexSize / 1e6).toFixed(2)}MB 1000-based`);
  console.log(`  data dir: ${DATA_DIR}`);
}

main();
