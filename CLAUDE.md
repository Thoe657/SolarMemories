# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SolarMemories ("Maddi's Memories") — a local personal app for storing memories (photos,
letters, audio) about favourite people. Each person is a "galaxy"; memories orbit as
"stars"/cards in a Three.js 3D scene, arranged in rings by galaxy. In the outer
solar-system picker screen (`galaxyPicker.js`), each galaxy is itself shown as a small
clickable "world" icon — a separate concept from a galaxy's internal stars/cards.

## Commands

```bash
npm start          # node server.js — serves the app at http://localhost:3000
```

- There is no lint script and no test suite (`npm test` is a stub that errors).
- `./start.command` is the packaged launcher: it runs `./node/node server.js` using a
  bundled Node binary (for running the app without a system-wide Node install). Both
  `node/` and `start.command` need `chmod +x` before first use on macOS.
- `DATA_DIR` env var overrides where JSON data is stored (defaults to `./data`).
- `node scripts/migrate.js --dry-run` previews migrating the legacy flat
  `data/galaxies.json`/`data/memories.json` files (kept as an inert `.bak` reference,
  see below) into the current one-file-per-record layout; only needed once per install.
- `node scripts/backfill-planets.js --dry-run` previews bucketing any existing memories
  that predate the `planets` record type (no `planetId`) into retroactive planets; a
  real run (no `--dry-run`) backs up `data/` to `data.bak-<timestamp>/` first. Only
  needed once, and only if memories existed before Phase 2 landed.
- `node scripts/build-backgrounds.js` regenerates the baked nebula background PNGs
  under `public/assets/backgrounds/`; only needed to change that art, not for normal
  use. Requires the `canvas` devDependency (native, not needed by `npm start`).

## Architecture

Modular, no build step: backend under `src/`, frontend as native ES modules under
`public/js/` + `public/css/styles.css`, `public/index.html` is markup-only. `server.js`
is a thin entrypoint (config, middleware, mount routes, listen, startup backup check).

### Backend (`src/`)
- `config.js` — `PORT`, `DATA_DIR`, per-record dirs, `MAX_DOC_SIZE`, `ALLOWED_TYPES`,
  `PLANET_STAR_CAP` (28), trash/backup timing constants.
- `lib/storage.js` — one-file-per-record JSON storage: `data/galaxies/<id>.json`,
  `data/memories/<id>.json`, `data/planets/<id>.json`, plus `data/index.json` (a
  denormalized list mirroring full memory records, including `photoData`/`audioData`,
  so the ring view doesn't need a per-card fetch). Atomic writes (`.tmp` + rename) and a
  `withWriteLock` promise chain for concurrent-request safety, same as before.
- `lib/validate.js` — pure `validateGalaxy`/`validateMemory`/`validatePlanet` functions
  (`{ ok, doc, errors }`), no Express dependency. Validates required fields, `ring`
  clamped 1-3, `photoData`/`audioData` must be well-formed data URLs of the right media
  type, `date` must parse, and payload size is checked against the *decoded* byte length
  of any base64 payload.
- `lib/planetNames.js` — pool of 24 astronomical names, picked uniformly at random each
  time a new planet is created (no cross-galaxy uniqueness tracking).
- `lib/archive.js` — soft delete: `archiveRecord`/`restoreRecord`/`purgeRecord` move
  records into a `deleted/` subfolder of their normal dir (e.g. `memories/deleted/<id>.json`)
  instead of removing files; `sweepDeleted` permanently purges anything older than
  `TRASH_MAX_AGE_MS` (30 days), run once on server start.
- `lib/zipBackup.js` — zips all of `data/` into `backups/backup-<ISO-timestamp>.zip`,
  keeping the most recent `BACKUP_KEEP_COUNT` (10); `server.js` triggers one on startup
  if the newest is stale or missing.
- `routes/galaxies.js`, `routes/memories.js`, `routes/backup.js` — route handlers.
  Memories routes: `GET /` (reads the index), `GET /trash`, `GET /:id` (full record),
  `POST /` (also assigns the memory to the galaxy's newest planet, creating the next one
  past `PLANET_STAR_CAP`; re-POSTing an existing id preserves its `planetId`, same as
  `createdAt`), `POST /:id/restore`, `DELETE /:id` (soft delete), `DELETE /:id/forever`.
  Galaxies routes also have `GET /:id/planets` (list, sorted by index). Galaxy delete
  cascades: archives the galaxy and archives its (non-deleted) memories and planets too.

### Frontend (`public/`)
`public/js/main.js` is the module entrypoint (imported via `<script type="module">`),
wiring the others together, calling `init()`, and wiring the quiet-mode toggle. Modules:
`state.js` (shared mutable app state — `memories`, `currentGalaxy*`, `storageMode`,
`galaxiesCache`, `currentPlanets`/`currentPlanetIndex` — with setters since ES module
bindings can only be reassigned by their own module), `util.js` (`escapeHtml`, storage-status helpers), `api.js` (`fetch()`
wrappers), `cards.js` (polaroid + card-back canvas textures), `scene.js` (Three.js
renderer/camera/lights/background/animate loop, card meshes, camera drag controls —
exposes a `setOnCardClick` callback rather than importing the click-handling module
directly, to avoid a circular import; also owns the in-memory per-session texture
cache and the adaptive-quality frame-time benchmark — see below), `galaxyPicker.js`
(solar system rendering, hyperspace transition, new/edit-galaxy forms, starfield
parallax + shooting stars), `memoryForm.js` (add-memory form, photo/audio
compression), `entryScreen.js` (one-time nebula start screen, 2D canvas, gates the
already-initializing picker, starts ambient audio on Enter — a valid user gesture),
`cardFlip.js` (click a card → it flips in 3D, then a DOM panel fades in with the full
content, replacing the old disconnected read-overlay modal), `audioManager.js`
(looping Web Audio ambient pad + short UI blips, quiet-mode toggle persisted via
`localStorage`, and the shared `shouldDampenMotion()`/`prefersReducedMotion()` reads
that `scene.js` uses to slow ambient animation and force low quality respectively).

Two perf/asset notes:
- `scene.js` caches each memory's generated `CanvasTexture` in an in-memory
  `Map<memoryId, texture>` for the page session, so re-entering a previously visited
  galaxy skips regenerating unchanged cards' textures. This has no invalidation
  logic — fine today since there's no way to edit an existing memory's content, but
  **must** be added when memory editing is built (scoped as Phase 7 in
  [docs/PLAN.md](docs/PLAN.md)).
- The starry background is a handful of pre-baked PNGs (`public/assets/backgrounds/`,
  generated by `scripts/build-backgrounds.js`) loaded via `THREE.TextureLoader` and
  picked at random per session, rather than drawn on a canvas at runtime. Pixel ratio,
  the distant twinkling-star count, and target FPS adapt at runtime based on a
  frame-time benchmark over the first ~60 frames (`scene.js`'s `applyLowQuality()`),
  replacing an old `hardwareConcurrency`/user-agent heuristic; `prefers-reduced-motion`
  short-circuits straight to the low-quality path regardless of that benchmark.

Data schema:
- galaxy: `{ id, name, accentColor, ring (1-3), deletedAt, createdAt }`
- memory: `{ id, galaxyId, type ('photo'|'letter'|'audio'), title, date, text, photoData, audioData, milestone, relatedIds, planetId, deletedAt, createdAt }`
- planet: `{ id, galaxyId, index, name, starCount, deletedAt, createdAt }` — a galaxy's
  memories are grouped onto planets of up to `PLANET_STAR_CAP` (28) each, server-assigned
  at memory-creation time.

Planets and the ring: `state.memories` holds **every** star in the open galaxy (so
related-memory links and the related-memory picker reach across planets), but `scene.js`
renders only the *viewed* planet's — `loadGalaxyMemories()` fetches the galaxy's planets
alongside its memories, defaults `currentPlanetIndex` to the oldest planet, and filters
by `planetId`. Two deliberate fallbacks stop a galaxy ever showing an empty ring when it
has stars: a galaxy with no planet records renders everything, and a star with no
`planetId` (predates planets / backfill never run) is treated as belonging to the oldest
planet. Anything counting what's *on screen* must use `scene.js`'s `renderedStarCount()`,
not `memories.length`. There's no way to change the viewed planet yet — that's Phase 4.

## Data safety

`data/` holds real personal photos/letters/audio and is gitignored — never assume it's
disposable. `docs/` and `node/` are also gitignored (present locally, not tracked).
`backups/` (zipped snapshots of `data/`) is a sibling of `data/`, also not tracked.

## Development plan

Phases 0–14 (file structure split, validation, per-record storage, archive-not-delete,
backups, and a run of feature/perf phases) are complete and merged to `main`.
[docs/PLAN_ARCHIVE.md](docs/PLAN_ARCHIVE.md) is the condensed record of what each phase
built, key decisions, and what was tested.

[docs/PLAN_NEXT.md](docs/PLAN_NEXT.md) lists candidate future work (PWA/service worker,
native macOS packaging, entry-screen Exit button, PIN/passcode lock, PDF keepsake
export, manual card reordering) that is **not yet scoped** — brainstorm/discuss before
turning any item there into a real phase; don't treat it as pre-approved.

[docs/PLAN.md](docs/PLAN.md) is the active, scoped plan currently being executed
(phases 1–10, "Galaxy scaling — stars & planets" plus four items later scoped in from
PLAN_NEXT.md: memory editing, restore-from-backup UI, touch controls, inline undo
toast). Phases 1 (rename), 2 (planets data model, backend-only) and 3 (frontend: render
only the viewed planet) are done; Phase 4 (planet navigation portal) is next. Once all
its phases are complete, fold it into PLAN_ARCHIVE.md the same way the previous PLAN.md
was.

The ground rules below (applied throughout the completed plan) are worth reusing
whenever an item from PLAN_NEXT.md — or any other new structural/feature work — gets
scoped into a real plan:
- Work directly on `main`, one phase at a time, committing each phase separately — no
  per-phase branches (phases 0–14 used one branch per phase; that convention was
  dropped starting with the "Galaxy scaling" plan). Don't combine phases or skip ahead.
- Restate the phase's plan and file list before writing code; stop and ask if anything is
  ambiguous, especially anything touching `data/`.
- Any phase that writes to `data/` must first copy it to `data.bak-<timestamp>/`.
- After each phase, run `npm start`, manually exercise the affected behavior, and report
  what was actually tested.
- If a phase's diff touches more than ~5 files outside its designated area, stop and flag it.
