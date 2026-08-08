#!/usr/bin/env node
// One-time backfill for Phase 2 ("planets" record type): existing memories
// predate planetId and have none. Buckets each galaxy's existing memories
// missing a planetId into retroactive planets of PLANET_STAR_CAP each,
// oldest-first by createdAt, continuing after any planets that galaxy
// already has. Run with --dry-run to preview without writing; a real run
// first copies the whole data/ directory to data.bak-<timestamp>/.
const fs = require('fs');
const crypto = require('crypto');
const {
  DATA_DIR,
  MEMORIES_DIR,
  PLANETS_DIR,
  INDEX_FILE,
  PLANET_STAR_CAP,
} = require('../src/config');
const { readAllRecords, writeRecord, readJSON, writeJSON } = require('../src/lib/storage');
const { validatePlanet } = require('../src/lib/validate');
const { randomPlanetName } = require('../src/lib/planetNames');

function buildPlan() {
  const memories = readAllRecords(MEMORIES_DIR).filter((m) => !m.planetId);
  const byGalaxy = new Map();
  memories.forEach((m) => {
    if (!byGalaxy.has(m.galaxyId)) byGalaxy.set(m.galaxyId, []);
    byGalaxy.get(m.galaxyId).push(m);
  });

  const existingPlanets = readAllRecords(PLANETS_DIR);
  const plan = [];

  byGalaxy.forEach((galaxyMemories, galaxyId) => {
    galaxyMemories.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const galaxyExistingPlanets = existingPlanets.filter((p) => p.galaxyId === galaxyId);
    let nextIndex = galaxyExistingPlanets.length > 0
      ? Math.max(...galaxyExistingPlanets.map((p) => p.index)) + 1
      : 0;

    const chunks = [];
    for (let i = 0; i < galaxyMemories.length; i += PLANET_STAR_CAP) {
      chunks.push(galaxyMemories.slice(i, i + PLANET_STAR_CAP));
    }

    // Names are navigation labels in the ring, so keep them distinct within
    // this galaxy — both from planets it already has and from each other.
    const takenNames = galaxyExistingPlanets.map((p) => p.name);

    const planets = chunks.map((chunk) => {
      const name = randomPlanetName(takenNames);
      takenNames.push(name);
      const { ok, doc } = validatePlanet({
        id: `planet-${crypto.randomUUID()}`,
        galaxyId,
        index: nextIndex++,
        name,
        starCount: chunk.length,
      });
      if (!ok) throw new Error('failed to build backfill planet');
      return { planet: doc, memories: chunk };
    });

    plan.push({ galaxyId, planets });
  });

  return { memories, byGalaxy, plan };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { memories, byGalaxy, plan } = buildPlan();
  const totalPlanets = plan.reduce((n, g) => n + g.planets.length, 0);

  console.log(`Backfill plan (source: ${MEMORIES_DIR}):`);
  console.log(`  ${memories.length} memories missing planetId, across ${byGalaxy.size} galaxies`);
  console.log(`  -> ${totalPlanets} planet(s) to create`);
  plan.forEach(({ galaxyId, planets }) => {
    console.log(`  galaxy ${galaxyId}:`);
    planets.forEach(({ planet, memories: chunk }) => {
      console.log(`    planet "${planet.name}" (index ${planet.index}): ${chunk.length} star(s)`);
    });
  });

  if (dryRun) {
    console.log('\n--dry-run: no files were written.');
    return;
  }

  if (totalPlanets === 0) {
    console.log('\nNothing to backfill.');
    return;
  }

  const backupDir = `${DATA_DIR}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.cpSync(DATA_DIR, backupDir, { recursive: true });
  console.log(`Backed up ${DATA_DIR} -> ${backupDir}`);

  const index = readJSON(INDEX_FILE);

  plan.forEach(({ planets }) => {
    planets.forEach(({ planet, memories: chunk }) => {
      writeRecord(PLANETS_DIR, planet.id, planet);
      chunk.forEach((m) => {
        writeRecord(MEMORIES_DIR, m.id, { ...m, planetId: planet.id });
        const idx = index.findIndex((entry) => entry.id === m.id);
        if (idx !== -1) index[idx] = { ...index[idx], planetId: planet.id };
      });
    });
  });

  writeJSON(INDEX_FILE, index);

  console.log(`\nWrote ${totalPlanets} planet file(s) and updated ${memories.length} memory file(s) + the index.`);
}

main();
