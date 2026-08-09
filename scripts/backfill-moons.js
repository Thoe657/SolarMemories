#!/usr/bin/env node
// One-time backfill for Phase 2 ("moons" record type): existing memories
// predate moonId and have none. Buckets each planet's existing memories
// missing a moonId into retroactive moons of MOON_STAR_CAP each,
// oldest-first by createdAt, continuing after any moons that planet
// already has. Run with --dry-run to preview without writing; a real run
// first copies the whole data/ directory to data.bak-<timestamp>/.
const fs = require('fs');
const crypto = require('crypto');
const {
  DATA_DIR,
  MEMORIES_DIR,
  MOONS_DIR,
  INDEX_FILE,
  MOON_STAR_CAP,
} = require('../src/config');
const { readAllRecords, writeRecord, readJSON, writeJSON } = require('../src/lib/storage');
const { validateMoon } = require('../src/lib/validate');
const { randomMoonName } = require('../src/lib/moonNames');

function buildPlan() {
  const memories = readAllRecords(MEMORIES_DIR).filter((m) => !m.moonId);
  const byPlanet = new Map();
  memories.forEach((m) => {
    if (!byPlanet.has(m.planetId)) byPlanet.set(m.planetId, []);
    byPlanet.get(m.planetId).push(m);
  });

  const existingMoons = readAllRecords(MOONS_DIR);
  const plan = [];

  byPlanet.forEach((planetMemories, planetId) => {
    planetMemories.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const planetExistingMoons = existingMoons.filter((p) => p.planetId === planetId);
    let nextIndex = planetExistingMoons.length > 0
      ? Math.max(...planetExistingMoons.map((p) => p.index)) + 1
      : 0;

    const chunks = [];
    for (let i = 0; i < planetMemories.length; i += MOON_STAR_CAP) {
      chunks.push(planetMemories.slice(i, i + MOON_STAR_CAP));
    }

    // Names are navigation labels in the ring, so keep them distinct within
    // this planet — both from moons it already has and from each other.
    const takenNames = planetExistingMoons.map((p) => p.name);

    const moons = chunks.map((chunk) => {
      const name = randomMoonName(takenNames);
      takenNames.push(name);
      const { ok, doc } = validateMoon({
        id: `moon-${crypto.randomUUID()}`,
        planetId,
        index: nextIndex++,
        name,
        starCount: chunk.length,
      });
      if (!ok) throw new Error('failed to build backfill moon');
      return { moon: doc, memories: chunk };
    });

    plan.push({ planetId, moons });
  });

  return { memories, byPlanet, plan };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { memories, byPlanet, plan } = buildPlan();
  const totalMoons = plan.reduce((n, g) => n + g.moons.length, 0);

  console.log(`Backfill plan (source: ${MEMORIES_DIR}):`);
  console.log(`  ${memories.length} memories missing moonId, across ${byPlanet.size} planets`);
  console.log(`  -> ${totalMoons} moon(s) to create`);
  plan.forEach(({ planetId, moons }) => {
    console.log(`  planet ${planetId}:`);
    moons.forEach(({ moon, memories: chunk }) => {
      console.log(`    moon "${moon.name}" (index ${moon.index}): ${chunk.length} star(s)`);
    });
  });

  if (dryRun) {
    console.log('\n--dry-run: no files were written.');
    return;
  }

  if (totalMoons === 0) {
    console.log('\nNothing to backfill.');
    return;
  }

  const backupDir = `${DATA_DIR}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.cpSync(DATA_DIR, backupDir, { recursive: true });
  console.log(`Backed up ${DATA_DIR} -> ${backupDir}`);

  const index = readJSON(INDEX_FILE);

  plan.forEach(({ moons }) => {
    moons.forEach(({ moon, memories: chunk }) => {
      writeRecord(MOONS_DIR, moon.id, moon);
      chunk.forEach((m) => {
        writeRecord(MEMORIES_DIR, m.id, { ...m, moonId: moon.id });
        const idx = index.findIndex((entry) => entry.id === m.id);
        if (idx !== -1) index[idx] = { ...index[idx], moonId: moon.id };
      });
    });
  });

  writeJSON(INDEX_FILE, index);

  console.log(`\nWrote ${totalMoons} moon file(s) and updated ${memories.length} memory file(s) + the index.`);
}

main();
