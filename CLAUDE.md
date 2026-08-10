# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SolarMemories ("Maddi's Memories") — a local personal app for storing memories (photos,
letters, audio) about favourite people. Each person is a "planet"; memories orbit as
"stars"/cards in a Three.js 3D scene, arranged in rings by planet and grouped into
"moons" of up to 28 stars each. In the outer solar-system picker screen
(`planetPicker.js`), each person is shown as a small clickable planet icon orbiting the
sun (maddi) — a separate concept from a planet's internal stars/moons.

(As of Phase 11: this used to be "galaxy" for a person and "planet" for a star-grouping
— renamed because the picker is a solar system with maddi as the sun, so the people
orbiting it should be planets, and their star-groupings should be moons of those
planets. This also retired Phase 1's "world" workaround: the picker's own icons had
borrowed that name only because "planet" was taken by the star-groupings at the time.)

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
  see below — the *filenames* stay "galaxies.json" even post-Phase-11, since they're
  real files already on disk from before any renaming existed) into the current
  one-file-per-record layout; only needed once per install.
- `node scripts/backfill-moons.js --dry-run` previews bucketing any existing memories
  that predate the `moons` record type (no `moonId`) into retroactive moons; a
  real run (no `--dry-run`) backs up `data/` to `data.bak-<timestamp>/` first. Only
  needed once, and only if memories existed before Phase 2 landed.
- `node scripts/rename-to-planets-moons.js --dry-run` previews the one-time Phase 11
  data migration (`galaxy` → `planet`, old `planet` → `moon`, both the directory layout
  and the `galaxyId`/`planetId` fields on every record); already run for real against
  this install's data. Only relevant again if restoring from a pre-Phase-11 backup.
- `node scripts/build-backgrounds.js` regenerates the baked nebula background PNGs
  under `public/assets/backgrounds/`; only needed to change that art, not for normal
  use. Requires the `canvas` devDependency (native, not needed by `npm start`).

## Verifying changes cheaply

Verification cost here is dominated by **screenshots and `read_page` dumps, not by the
server**. `npm start` is a few dozen tokens; a screenshot is a couple of thousand, and
because it stays in the context window it is re-sent on every later turn of the session —
so ten screenshots cost far more than ten times one. Minimise usage at all times, without
compromising the project. In practice:

- **Check once per phase, not once per edit.** Batch related changes, then verify. The
  per-phase rule under "Development plan" is the intended cadence; don't run the app
  after every individual edit.
- **Reach for text before pixels.** Console messages, network requests, `curl` against an
  API route, and server logs answer "did it throw / is the data right" for a fraction of
  the cost. A screenshot cannot answer those questions any better.
- **Screenshot only for genuinely visual questions**, and say so before doing it. This
  project has a real class of bug that is invisible in a diff — the portal `PointLight`
  and the caption-beside-the-moon constraints above exist because "the code looks right"
  and "the moon isn't a black disc" are different questions. Ring/portal geometry, card
  flip, hyperspace, and layout work earn one look; validator, storage, routing, and
  data-flow changes do not.
- **One screenshot, not a series.** If a second is genuinely needed, prefer `zoom` on the
  region in question over another full-frame capture.
- Prefer scoped `read_page` (`ref_id`/`depth`/`filter: interactive`) over a full tree
  dump, for the same reason.

## Architecture

Modular, no build step: backend under `src/`, frontend as native ES modules under
`public/js/` + `public/css/styles.css`, `public/index.html` is markup-only. `server.js`
is a thin entrypoint (config, middleware, mount routes, listen, startup backup check).

### Backend (`src/`)
- `config.js` — `PORT`, `DATA_DIR`, per-record dirs, `MAX_DOC_SIZE`, `ALLOWED_TYPES`,
  `MOON_STAR_CAP` (28), trash/backup timing constants. Also `LEGACY_PLANETS_FILE`
  (`data/galaxies.json` — the *filename* keeps its pre-Phase-11 name; see `scripts/
  migrate.js` below) alongside the current `MEMORIES_FILE` for the same legacy layer.
- `lib/storage.js` — one-file-per-record JSON storage: `data/planets/<id>.json`,
  `data/memories/<id>.json`, `data/moons/<id>.json`, plus `data/index.json` (a
  denormalized list mirroring full memory records, including `photoData`/`audioData`,
  so the ring view doesn't need a per-card fetch). Atomic writes (`.tmp` + rename) and a
  `withWriteLock` promise chain for concurrent-request safety, same as before.
- `lib/validate.js` — pure `validatePlanet`/`validateMemory`/`validateMoon` functions
  (`{ ok, doc, errors }`), no Express dependency. Validates required fields, `ring`
  clamped 1-3, `photoData`/`audioData` must be well-formed data URLs of the right media
  type, `date` must parse, and payload size is checked against the *decoded* byte length
  of any base64 payload.
- `lib/moonNames.js` — pool of 28 real moon names (Europa, Titan, Phobos, Enceladus,
  Charon, ...). `randomMoonName(taken)` picks uniformly at random from the names not in
  `taken`; callers pass the names already used *on that planet*, since Phase 4 made
  these names the navigation labels on the portals. Past 28 moons on one planet the pool
  is exhausted and repeats resume. Still no cross-planet uniqueness tracking — repeats
  between planets are fine. (Pre-Phase-11 this pool held planets/dwarf-planets/
  exoplanets, back when these records were themselves called "planets" — the Phase 11
  data migration re-rolled any existing record whose name wasn't a real moon name.)
- `lib/archive.js` — soft delete: `archiveRecord`/`restoreRecord`/`purgeRecord` move
  records into a `deleted/` subfolder of their normal dir (e.g. `memories/deleted/<id>.json`)
  instead of removing files; `sweepDeleted` permanently purges anything older than
  `TRASH_MAX_AGE_MS` (30 days), run once on server start.
- `lib/zipBackup.js` — zips all of `data/` into `backups/backup-<ISO-timestamp>.zip`,
  keeping the most recent `BACKUP_KEEP_COUNT` (10); `server.js` triggers one on startup
  if the newest is stale or missing.
- `routes/planets.js`, `routes/memories.js`, `routes/backup.js` — route handlers.
  Memories routes: `GET /` (reads the index), `GET /trash`, `GET /:id` (full record),
  `POST /` (also assigns the memory to the planet's newest moon, creating the next one
  past `MOON_STAR_CAP`; re-POSTing an existing id preserves its `moonId`, same as
  `createdAt`; responds `{ ok, moonId }` so the client can tell whether the new star
  belongs in the ring it's currently looking at), `POST /:id/restore`, `DELETE /:id`
  (soft delete), `DELETE /:id/forever`.
  Planets routes also have `GET /:id/moons` (list, sorted by index). Planet delete
  cascades: archives the planet and archives its (non-deleted) memories and moons too.

### Frontend (`public/`)
`public/js/main.js` is the module entrypoint (imported via `<script type="module">`),
wiring the others together and calling `init()`. Modules:
`state.js` (shared mutable app state — `memories`, `currentPlanet*`, `storageMode`,
`planetsCache`, `currentMoons`/`currentMoonIndex` — with setters since ES module
bindings can only be reassigned by their own module), `util.js` (`escapeHtml`,
storage-status helpers, the shared bottom-center `showToast`), `api.js` (`fetch()`
wrappers), `cards.js` (polaroid + card-back + moon-portal canvas textures),
`scene.js` (Three.js renderer/camera/lights/background/animate loop, card meshes,
moon portals, camera drag controls — exposes `setOnCardClick`/`setOnPortalClick`
callbacks rather than importing the handling modules directly, to avoid circular
imports; also owns the in-memory per-session texture cache and the adaptive-quality
frame-time benchmark — see below), `planetPicker.js`
(solar system rendering, hyperspace transition, new/edit-planet forms, starfield
parallax + shooting stars), `memoryForm.js` (add-memory form, photo/audio
compression), `entryScreen.js` (one-time nebula start screen, 2D canvas, gates the
already-initializing picker), `cardFlip.js` (click a card → it flips in 3D, then a DOM
panel fades in with the full content, replacing the old disconnected read-overlay
modal), `motionPreference.js` (the sole remaining export, `prefersReducedMotion()`,
reads the OS-level `prefers-reduced-motion` media query — `scene.js` uses it to slow
ambient animation and force low quality, `planetPicker.js` to pick the shorter
hyperspace preset; there is no in-app audio or quiet-mode toggle — removed entirely
since it didn't fit the app's feel).

Two perf/asset notes:
- `scene.js` caches each memory's generated `CanvasTexture` in an in-memory
  `Map<memoryId, texture>` for the page session, so re-entering a previously visited
  planet skips regenerating unchanged cards' textures. This has no invalidation
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
- planet: `{ id, name, accentColor, ring (1-3), deletedAt, createdAt }`
- memory: `{ id, planetId, type ('photo'|'letter'|'audio'), title, date, text, photoData, audioData, milestone, relatedIds, moonId, deletedAt, createdAt }`
- moon: `{ id, planetId, index, name, starCount, deletedAt, createdAt }` — a planet's
  memories are grouped onto moons of up to `MOON_STAR_CAP` (28) each, server-assigned
  at memory-creation time.

Moons and the ring: `state.memories` holds **every** star on the open planet (so
related-memory links and the related-memory picker reach across moons), but `scene.js`
renders only the *viewed* moon's — `loadPlanetMemories()` fetches the planet's moons
alongside its memories, defaults `currentMoonIndex` to the oldest moon, and filters
by `moonId`. Two deliberate fallbacks stop a planet ever showing an empty ring when it
has stars: a planet with no moon records renders everything, and a star with no
`moonId` (predates moons / backfill never run) is treated as belonging to the oldest
moon. Anything counting what's *on screen* must use `scene.js`'s `renderedStarCount()`,
not `memories.length`.

Navigating between moons (Phase 4) goes through `scene.js`'s `showMoon(index)`, which
rebuilds the ring's meshes and leaves `memories` alone. The two portals are whole worlds
hanging 26 units out at ±100° and ~20° of elevation — a lit `MeshLambertMaterial` sphere,
an atmosphere shell, and a caption plate beside it — each a `THREE.Group` under
`portalGroup`, outside `cardGroup`, so ring slot indexing and `renderedStarCount()` keep
counting stars only. The `pointerup` raycast collects the visible portals' sphere and
caption meshes alongside `cardGroup.children` and routes portal hits to
`setOnPortalClick`'s callback (wired up in `planetPicker.js`, which owns the hyperspace
transition). A "next" portal with no successor moon renders as a grey, padlocked ghost
of a world and does nothing but swell when clicked.

Two things about the portals are load-bearing and easy to undo by accident. Their light is
a `PointLight` above the viewer, not a directional one: both portals hang off to the
sides, and any single direction leaves one of them a black disc. And the caption sits
*beside* its moon because it doesn't fit above or below — the clear sky between the top
row of stars (~13.7° elevation) and the top of the 55° FOV (27.5°) is only ~14° tall, and
the moon nearly fills it; above puts the caption off-screen, below puts it behind the
card ring.

Ring layout (`ringSlot`/`applyRingLayout` in `scene.js`) is a function of how many stars
are in the ring, not of arrival order, so everything is re-spaced whenever that count
changes — adding closes ranks, deleting closes the gap. One row at eye level up to
`ROW_CAPACITY` (18), two rows past that sharing a single angular step so stars line up in
columns. `MAX_ANGULAR_STEP` (26°) stops a part-full moon from going hollow: below it the
ring closes into a full circle, above it the stars form an arc centred on where you're
facing. Don't reintroduce a fixed per-index slot grid — the old one put levels 0 and 2 on
the same angles 1.6 apart with cards 1.8 tall, so they always overlapped.

Because the server decides which moon a new star lands on, `memoryForm.js` waits for
`POST /api/memories` to answer before drawing anything: `scene.js`'s `placeNewStar()`
refetches the moon list and only adds the mesh when the star landed on the viewed
moon, otherwise it toasts where it went. Don't go back to rendering the new star
optimistically — that's the bug it fixes.

The picker's own planet icons (`.planet`/`.planet-body`/`.planet-label` in
`planetPicker.js`/`styles.css`) are unrelated to the ring's moon portals despite sharing
the word "planet" in their class names — one is the outer solar-system view, the other
is inside a planet's own gallery. Don't confuse `.planet-label` (a picker icon's caption)
with `#moonLabel`/`.moon-label` (the topbar's "which moon am I on" readout).

## Data safety

`data/` holds real personal photos/letters/audio and is gitignored — never assume it's
disposable. `docs/` and `node/` are also gitignored (present locally, not tracked).
`backups/` (zipped snapshots of `data/`) is a sibling of `data/`, also not tracked.

Need a planet with more than one moon to test against? Use `data.test-fixture/`
(gitignored, synthetic, migrated to the current planet/moon schema as of Phase 11 —
see its README) — copy it over a **separate checkout's** `data/`. Do not reach for the
`DATA_DIR` env var to isolate test writes: on 2026-08-08 an override reported the right
path at startup and the seeded records landed in the real `data/` anyway. Take the
`data.bak-<timestamp>/` copy before any phase that writes to `data/` — that's what made
that mishap recoverable.

**Renaming code without renaming data is its own hazard.** Phase 11 briefly had the
code's `PLANETS_DIR` constant (meant for the new top-level records) pointing at the same
on-disk `data/planets/` folder that, pre-migration, held the *old* planet-meaning-moon
records — so a server started against real data before the migration ran read the wrong
directory (harmless, since it was a read-only GET, but exactly why the migration ran
against a testbed copy first and the real run happened only after that passed). If a
future rename ever collides two record types onto the same directory name again, migrate
the data (or at least back it up) *before* pointing the renamed code at real `data/`.

The separate checkout that works cleanly (used for Phases 4–5, real `data/` verified
untouched afterwards): `git worktree add --detach <scratch>/testbed HEAD`, copy
`data.test-fixture/` to `<scratch>/testbed/data`, junction `node_modules` in, and patch
that copy's `src/config.js` `PORT` to something other than 3000 so it can run alongside
the real app. `DATA_DIR` resolves from `src/config.js`'s own `__dirname`, so the testbed
server reads and writes only its own `data/` regardless of cwd. Tear it down with
`git worktree remove --force`.

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
toast; plus phases 11–12, scoped 2026-08-09 from user feedback on Phase 4's portals).
All twelve phases are now done: 1 (rename to "star"), 2 (moons data model,
backend-only), 3 (frontend: render only the viewed moon), 4 (moon navigation portals),
5 (hyperspace escalation), 6 (milestone star-shaped visual), 7 (memory editing), 8
(restore-from-backup UI), 9 (touch controls), 10 (inline undo toast on delete), 11
(terminology: galaxy → planet, [old] planet → moon, including the on-disk data), and 12
(moons visible in the picker, as low-opacity orbiting satellite dots scaled to each
planet's moon count). Now that all its phases are complete, docs/PLAN.md is ready to be
folded into PLAN_ARCHIVE.md the same way the previous PLAN.md was — not done yet, left
for the user to review first.

The ground rules below (applied throughout the completed plan) are worth reusing
whenever an item from PLAN_NEXT.md — or any other new structural/feature work — gets
scoped into a real plan:
- Work directly on `main`, one phase at a time, committing each phase separately — no
  per-phase branches (phases 0–14 used one branch per phase; that convention was
  dropped starting with the "Galaxy scaling" plan). Don't combine phases or skip ahead.
- Restate the phase's plan and file list before writing code; stop and ask if anything is
  ambiguous, especially anything touching `data/`.
- Any phase that writes to `data/` must first copy it to `data.bak-<timestamp>/`.
- After each phase — not after each edit — run `npm start`, manually exercise the affected
  behavior, and report what was actually tested. Do it the cheap way described under
  "Verifying changes cheaply": text signals first, a screenshot only when the question is
  genuinely visual.
- If a phase's diff touches more than ~5 files outside its designated area, stop and flag it.
