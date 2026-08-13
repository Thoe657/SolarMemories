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

**Two themes, since Plan 4.** `solar` is the default and is the app described above.
`universe` is a skin: identical hierarchy, structure and data, different appearance and
vocabulary. It is **presentation only** — no new record types, no new fields, no
migration; the internal words (`planet`, `moon`, `planetId`, `moonId`) are unchanged in
the code, the API and `data/`.

| concept | `solar` (default) | `universe` (skin) |
|---|---|---|
| maddi | the sun | the centre of the universe (no noun on screen — her label is her name, in both) |
| a person | planet | galaxy |
| a grouping of ≤28 | moon | nebula |
| a memory | star | star |
| a milestone memory | star-cutout card | comet-cutout card |
| navigation portal | a world you travel to | a black hole with an accretion ring |
| picker layout | concentric rings, orbiting | a static two-armed spiral |
| content surfaces | warm cream (`#fffaf0`) | cool graphite (`#707688`) |
| sky family | `nebula-{1,2,3}.webp` | `universe-{1,2,3}.webp` |

The *world* is near-black in both — the sky doesn't get darker. What changes is the
content surfaces: the polaroid face, the read/flip panel, the forms.

## Commands

```bash
npm start          # node server.js — serves the app at http://localhost:3000
```

Useful URLs (Plan 3 Phase 1, both no-ops without the query param):
- `?perf=1` — fixed-corner perf HUD, and `window.__perf()` returning the same snapshot as
  a plain object (`{ frameMs, fps, avgFrameMs, avgFps, calls, triangles, textures,
  geometries, tier, renderedStars, heapMB, paused }`). **This is the cheap way to verify
  render work — one line of console JSON instead of a screenshot.**
- `?quality=high|medium|low` — forces a quality tier at load, bypassing the benchmark and
  any persisted verdict. Needed to exercise the low path on a fast machine, and the only
  way to get `antialias: false` (it is fixed at renderer construction).
- `?theme=solar|universe` (Plan 4 Phase 1) — forces a theme at load. **Unlike `?quality=`
  it also persists**: a themed link is a way to switch, not just to peek. Precedence is
  `?theme=` > stored preference > `solar`. The theme is fixed for the life of the page
  (see the theme notes below), so this is the only way to change it mid-session.

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
- `node scripts/build-backgrounds.js [family|variant] [--reencode]` regenerates the sky
  art. **The art is deterministic as of Plan 4 Phase 3** — every random number comes from
  a mulberry32 PRNG seeded per variant, so a plain run reproduces the files on disk
  byte-for-byte and the sky can be *re-tuned* by editing numbers rather than only
  replaced. (Before Phase 3 it used `Math.random()` and a plain run invented new skies;
  that trap is gone, and so is the `--reencode`-only workflow it forced.) A bare run
  redraws all six variants; passing `solar`, `universe`, or a single name like
  `universe-2` narrows it. `--reencode` still exists to re-encode the PNGs already on
  disk to WebP without redrawing — useful only for changing the encoder options. The
  script prints the numeric contrast guard per variant and **exits non-zero if one misses
  its ceiling**. Requires the `canvas` and `sharp` devDependencies (native, neither needed
  by `npm start`). Both PNG and WebP are written; `scene.js` loads the WebP, and the PNGs
  stay as the lossless source the re-encode reads.
- `node scripts/perf-report.js` prints per-planet star count, payload bytes and how many
  of those are media, from `data/` alone — read-only, no server. Answers "what does
  entering this planet cost" without a browser.

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

**The Browser pane does not composite frames in these sessions** — `visibilityState` is
permanently `hidden`, `requestAnimationFrame` is suspended, and `computer screenshot`
fails, so `window.__perf()` only ever reads `paused: true` / 0 draw calls through it.
This has been true across all four plans. The working method, and now the default:
`npm start` on port 3000, then drive **headless Chrome over CDP** (`--headless=new`,
1280x800) from a throwaway Node script in the scratchpad. That gives a visible document,
a ticking render loop, real `__perf()` numbers and working screenshots. Two traps worth
knowing: `document.querySelector('canvas')` returns the **entry** canvas, not the
renderer's (use `#scene-container canvas`), and `getMeshScreenRect` reads a stale
`modelViewMatrix` on a frustum-culled mesh — so drive the camera **analytically** from
`scene.js`'s own constants (`targetYaw -= dx * 0.004`) rather than searching for a
heading.

**A captured screenshot only costs tokens when it is *read*.** Capture freely; decode
with the `sharp` devDependency in Node and answer the question as a number. Luminance,
contrast ratios, radial profiles, "did this render at all", pixel-identity between two
builds — all numeric. Reserve actually looking at an image for questions that are
irreducibly about perception ("does this read as a black hole", "would a stranger see two
modes"), and crop to the region in question before doing so.

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
  Memories routes: `GET /` (reads the index, **slim by default** — no `photoData`/
  `audioData`, plus `hasPhoto`/`hasAudio`; `?full=1` for the old shape), `GET /trash`
  (slim the same way), `GET /:id` (full record; `?media=photo|audio` for just one
  payload, which is what the ring's lazy photo fetch uses),
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
imports; also owns the card-texture LRU, the frame-callback registry and the rolling
frame-time sampling that asks `quality.js` to step the tier down — see below),
`quality.js` (the quality tier: the tier table as data, precedence resolution, and
`localStorage` persistence — imported by `scene.js` so it resolves first),
`theme.js` (the theme registry — two entries, each with a label map, sky asset family,
colour tokens, the nebula-name pool and feature flags; exports `currentTheme()`,
`setTheme()`, `label()`, `tokens()`, `themeFlag()`, `applyLabels()`. Modelled on
`quality.js` and, like it, must not import `scene.js`),
`perfHud.js` (the `?perf=1` readout and `window.__perf()`; dynamically imported by
`main.js` only when that param is present, so a normal load never fetches it),
`planetPicker.js`
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

Perf/asset notes (mostly Plan 3 — these are load-bearing and easy to undo by accident):

- **The scene render is gated on view visibility.** `scene.js` has *two* pause booleans —
  tab-hidden and planet-view-not-visible — with `animPaused` derived from both, so neither
  reason can un-pause while the other stands. It starts paused; `planetPicker.js` calls
  `resumeScene()`/`pauseScene()` at the *midpoint* of the hyperspace whiteout. The moon
  jump shares `playHyperspace` and deliberately touches neither. Pausing calls
  `renderer.info.reset()`, because three.js resets `info` at the *start* of a render and
  skipping render would otherwise freeze the counters at a full scene's worth.
- **The fairy lights are two `THREE.Points` clouds and one `ShaderMaterial`, not meshes.**
  Twinkle and drift are computed on the GPU from a `uTime` uniform. Don't reintroduce
  per-object animation: the point was removing a per-frame JS loop over 240 objects.
  Colour is encoded to sRGB on the CPU (`fairyOutputColor`) because a `ShaderMaterial` has
  neither half of the conversion the built-in material path applied — skip that and the
  lights come out cold and washed out, which no diff will show you. A shader-compile
  failure falls back to the old meshes via `renderer.debug.onShaderError`.
- **`quality.js` owns the quality tier and must resolve before `scene.js`'s body runs** —
  `antialias` is baked into the WebGL context at construction and cannot be changed after,
  so that import order is the only reason the low tier can have it off. Precedence:
  `prefers-reduced-motion` > `?quality=` > entry-screen selector > persisted verdict >
  `high`. The rolling frame-time average only ever steps *down*, never up, and never moves
  a tier the user named. Never import `scene.js` from `quality.js` — the cycle would put
  the renderer's construction ahead of the tier resolution.
- **`scene.js` has one frame-callback registry**; anything animating the scene belongs on
  it (`addFrameCallback`) rather than its own `requestAnimationFrame`, so it runs at the
  tier's target FPS and stops when the scene does. `onSceneStop` fires when the scene
  pauses, so an in-flight tween can settle instead of stranding locks — `cardFlip.js`
  relies on this, plus a `flipGeneration` token, because resolving a promise alone lets
  the awaiting code resume *after* teardown.
- **`GET /api/memories` is slim by default** — no `photoData`/`audioData`, plus
  `hasPhoto`/`hasAudio` booleans; `?full=1` returns the old shape. The on-disk
  `index.json` is unchanged; this is a response-time projection. The ring fetches each
  card's photo lazily (4 at a time, aborted on moon change) via `GET /:id?media=photo` —
  **use `?media=photo`, not the bare record**, or a card's picture drags its audio down
  with it. `memoryForm.js`'s edit mode must fetch the full record first and refuses to
  open if it can't: saving a slim record would strip the photo off a real memory.
- **Every card shares one `PlaneGeometry`**, so `disposeCardMesh` must not dispose
  geometry, and must skip anything flagged `userData.shared`. The texture cache is an
  **LRU capped at 64** whose eviction hands ownership over — it clears the `cached` flag
  and disposes only if no visible mesh still holds the texture. `updateMemoryInScene()`
  still evicts on edit so a cache hit always reflects saved content.
- **Card texture size comes from the tier** (512x600 / 512x600 / 384x450). Everything in
  `cards.js` is drawn in a fixed 512x600 reference space with one `ctx.scale`, so the high
  tier is an identity transform and stays pixel-identical. Keep new drawing code in that
  reference space.
- **The sky is lossless WebP and three.js is vendored locally.** `public/lib/three.min.js`
  is checked in deliberately, pinned by `package.json`'s exact `three: 0.160.0`. It is in
  `lib/` and not `vendor/` because **`.gitignore` ignores `vendor/`** — named that, it
  would be silently untracked and a fresh clone would boot to a blank screen. `/assets`
  and `/lib` are served `immutable`; everything that changes in place is not, so editing
  a module and reloading still shows the edit.
- The one external host left is Google Fonts (`styles.css:1`). The app loads and renders
  offline but falls back to system type; self-hosting is filed in PLAN_NEXT.md. (Verified
  in Plan 4 Phase 9 by black-holing `fonts.googleapis.com`/`fonts.gstatic.com` at the
  resolver: both themes load and render with 0 console errors and 0 loaded font faces.)

Theme notes (Plan 4 — same status as the perf notes above: load-bearing, easy to undo):

- **The theme is fixed at load and must stay that way.** `setTheme()` stores a preference
  and does *not* repaint; `currentTheme()` is stable for the life of the page. Re-theming
  live would mean regenerating every card texture, reloading the sky and rebuilding the
  portals mid-session. The useful consequence is that a session's texture cache can never
  hold two themes' cards, which is why the LRU key is the bare `memory.id` with **no**
  theme component — correct, not an oversight.
- **`data-theme` is set by a three-line inline `<script>` in `<head>`**, above the
  stylesheet. That is the one justified exception to `index.html` being markup-only: a
  module import runs too late and the app would flash cream before going dark.
- **`cards.js` reads its colours from `theme.js` and must never re-hardcode them.** It
  used to hold literal copies of the same hexes the CSS variables held; the canvas half of
  dark mode is entirely "stop doing that". A new fill or stroke goes through `tokens()`.
- **The `universe` palette window is about one percent wide.** Card `#707688` (L 0.1818)
  and pure-white text are load-bearing to two decimals: they are the only pair satisfying
  both binding criteria at once (body text 4.53:1 above the card, card 3.02–3.07:1 above
  the sky). The two bounds multiply, so the sky-to-white span must be ≥ 3 × 4.5 = 13.5:1.
  The algebra is written beside the hex in `theme.js`. **Do not casually retune either
  value** — and `build-backgrounds.js`'s `UNIVERSE_CARD_LUMINANCE` is the *measured*
  luminance of that same hex, so the two change together or not at all.
- **`build-backgrounds.js`'s contrast guard is per-family** (cream 0.9592 / graphite
  0.1818), because a single ceiling derived from the graphite card would fail the *solar*
  skies for being too bright for a card they never sit behind. It binds on **field p99** —
  the image box-averaged into 128px cells, which is card scale — not on raw pixels, since
  a 3px star cannot out-shout a card however bright that one pixel is.
- **The spiral's arms and its planet placement share one winding constant.** `ARM_WINDING`
  is declared once in `planetPicker.js` and read by both the placement formula
  (`θ = (idx/count)*360 + ring*23 + ARM_WINDING * radius`) and the arm path. Arms baked
  into an image, or drawn from a second constant, would drift off the planets. Related:
  **the arms are broad because of algebra, not taste** — the winding term cancels between
  a planet and an arm centre, so "is this planet on an arm" depends on base angles alone,
  and ring 3's four planets sitting 90° apart force a 90° occupied span against a two-arm
  180° period. Don't narrow the arms to make them prettier; the planets will fall off.
- **`universe` portals are unlit billboards, so the `PointLight` constraint is `solar`
  only.** The three lights still exist in both themes (making the rig conditional would
  put a second theme branch on renderer setup for nothing), but in `universe` they
  illuminate nothing — the one `MeshLambertMaterial` in the app is solar's portal sphere.
  See the portal section below.
- **The hyperspace colour *count* must stay fixed.** Streaks batch into
  `` `${color}|${width}` `` buckets against 7 quantised widths, so the ceiling is 5×7=35
  on a moon jump. Retinting is free; adding a sixth colour is ~20% more stroke calls a
  frame at the app's most performance-sensitive moment. `HYPERSPACE_PALETTES` holds the
  colours per theme; the presets hold the effect's *shape*, identical in both.
- **The comet's head radius comes from `innerRx` alone**, never `innerRy`, or the circular
  photo medallion inside it stops being circular. Its tail edges bow *inward*; bowed
  outward the shape reads as a fat teardrop.
- **Anything static built on `Math.random()` in the picker will reshuffle.**
  `renderSolarSystem()` re-runs on every create, delete and return from a planet. Solar's
  moon dots get away with a random start phase only because they are moving; the
  `universe` halo derives its angle (golden angle) instead.
- **Nebula names are derived, not stored** — a pool of 28 mapped deterministically off
  `moon.index` (index 0 is always Orion), mirroring `lib/moonNames.js`'s 28. Ordered
  rather than randomly picked because the name is computed at render time on every load.
  Accepted trade: the same grouping shows two different names in the two themes. Nothing
  is written to `data/`; the moon's stored name is what `solar` still shows.
- **Gating new motion on `currentTier() !== 'low'` covers `prefers-reduced-motion` for
  free**, because that query forces the low tier through `quality.js`'s precedence chain —
  but it must be re-applied inside an `onTierChange` callback, or a mid-session downgrade
  leaves the animation running.

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
rebuilds the ring's meshes and leaves `memories` alone. The two portals hang 26 units out
at ±100° and ~20.5° of elevation, each a `THREE.Group` under `portalGroup`, outside
`cardGroup`, so ring slot indexing and `renderedStarCount()` keep counting stars only.
**The body branches by theme at construction** (they are built once for the life of the
page — moon changes only swap maps and visibility — so there is no teardown path to lean
on and nothing unused is allocated):

- `solar` — a whole world: a lit `MeshLambertMaterial` sphere plus a `BackSide` atmosphere
  shell, with a caption plate beside it. A locked one is a grey, padlocked ghost at 0.72
  opacity.
- `universe` — an unlit `MeshBasicMaterial` billboard on a *square* plane carrying a black
  hole and its accretion ring, both painted into the texture. No sphere and no halo are
  allocated at all. A locked one keeps the event horizon, loses the accretion ring
  entirely, and stays fully opaque: the ring is what marks a real one, so its absence is a
  better sentence than "greyed out".

The `pointerup` raycast collects the visible portals' body and caption meshes alongside
`cardGroup.children` and routes portal hits to `setOnPortalClick`'s callback (wired up in
`planetPicker.js`, which owns the hyperspace transition). It maps a hit to its portal by
`userData.portal` (a string), not by parent traversal, and `intersectObjects` is
non-recursive — so **any new clickable mesh must carry `userData.portal` *and* be added to
the candidate list**. Solar's `halo` is excluded on purpose: a `BackSide` shell would
swallow clicks in front of the body. A "next" portal with no successor moon does nothing
but swell when clicked, and that swell is the *only* feedback the click was heard.

Three things about the portals are load-bearing and easy to undo by accident:

- **The light is a `PointLight` above the viewer, not a directional one** — both portals
  hang off to the sides, and any single direction leaves one of them a black disc. **This
  applies to `solar` only from Plan 4 Phase 7 on**: a billboard has no unlit hemisphere to
  leave in shadow, and solar's sphere is the app's only non-`Basic` material.
- **The caption sits *beside* its body**, because it doesn't fit above or below — the
  clear sky between the top row of stars (~13.7° elevation) and the top of the 55° FOV
  (27.5°) is only ~14° tall and the body nearly fills it; above puts the caption
  off-screen, below puts it behind the card ring. The side offset is measured off the
  geometry, not the radius constant, because the two themes' bodies are different widths.
- **Portal textures are deliberately outside the 64-entry LRU.** `textureInUse()` only
  scans `cardGroup.children`, so a portal texture in that cache could be disposed while
  still bound to a live material. They use a fresh `CanvasTexture` per call with the old
  one disposed inline by `setPortalAppearance`. A *shared/static* black-hole texture would
  be destroyed by those unconditional disposes on the first moon jump.

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

The separate checkout that works cleanly (used for Plan 2's Phases 4–5–8 and Plan 3's
Phase 5, real `data/` verified untouched afterwards each time):
`git worktree add --detach <scratch>/testbed HEAD`, copy `data.test-fixture/` to
`<scratch>/testbed/data`, **copy** `node_modules` in, and patch that copy's
`src/config.js` `PORT` to something other than 3000 so it can run alongside the real app.
`DATA_DIR` resolves from `src/config.js`'s own `__dirname`, so the testbed server reads
and writes only its own `data/` regardless of cwd. Tear down by removing the testbed's
`node_modules` *first*, then `git worktree remove --force`, then `git worktree prune`.

**Copy `node_modules`, don't junction it.** A junction is the tempting shortcut — it is
instant and saves a few hundred MB — but during Plan 2's Phase 8 `git worktree remove
--force` followed one and deleted the *real* repo's `node_modules` contents, not just the
worktree's. Not `data/`, so not a personal-data hazard, but it breaks `npm start` until
`npm install` is re-run. Copying takes a minute or two and has no such failure mode; Plan
3's Phase 5 did it that way and the real `node_modules` was verified intact afterwards. If
you do junction anyway, unlink it before `git worktree remove`, and re-run `npm install`
and check `node_modules` before trusting the app boots.

Also note `git worktree remove` fails with "Permission denied" while the testbed's server
is still running — stop it first, and if the worktree registration is left behind,
`rm -rf` the directory and `git worktree prune`.

## Development plan

Four plans are complete and merged to `main`, condensed in
[docs/PLAN_ARCHIVE.md](docs/archive/PLAN_ARCHIVE.md): Plan 1, phases 0–14 (file
structure split, validation, per-record storage, archive-not-delete, backups, and a run
of feature/perf phases), and Plan 2, "Galaxy scaling — stars & planets," phases 1–12
(grouping a person's memories into moons of ~28 stars each, with navigation between
them, plus four items scoped in from PLAN_NEXT.md along the way: memory editing,
restore-from-backup UI, touch controls, inline undo toast; plus a terminology rename —
galaxy → planet, planet → moon, including the on-disk data — and moons becoming visible
in the picker).

Plan 3, "Performance & smoothness (low-end PCs first)," phases 1–9, is **complete and
merged to `main`**, condensed in the same archive. Its headline results: the scene no
longer renders behind the entry screen or picker (0 draw calls there), the fairy lights
went from 240 meshes to 2 draw calls, entering "Theo" blocks on 300 bytes instead of
7.56MB, card geometries stopped scaling with ring size, and the skies shrank 48% with
bit-identical pixels. **Several of that plan's baseline findings turned out to be wrong
when measured** — the fairy lights were never ~240 draw calls (frustum culling), Theo's
6.9MB is a photo and not an audio clip, and the portal caption plate is not drawn at 1:1;
the corrections are recorded per phase in the archive, and are worth reading before
trusting any perf claim written down here.

Plan 4, "The universe theme & a richer deep space," phases 1–9, is **complete and merged
to `main`**, in the same archive. It shipped the `universe` skin (theme registry, themed
label vocabulary, derived nebula names, dark content surfaces, static spiral picker,
black-hole portals, comet milestones, retinted hyperspace) and a universal background
overhaul (two deterministic sky families, mean chroma 0.021 → 0.068–0.111, a numeric
per-family contrast guard). It wrote **nothing** to `data/` in nine phases — verified
byte-identical throughout — and its own risk model was wrong twice in ways worth reading:
Phase 6's viewport-drift risk was structurally absent, and Phase 3's "reads flat" was
near-total absence of colour rather than insufficient detail.

[docs/PLAN_NEXT.md](docs/PLAN_NEXT.md) lists candidate future work (PWA/service worker,
native macOS packaging, entry-screen Exit button, PIN/passcode lock, PDF keepsake export,
manual card reordering, self-hosting the two web fonts, a moving comet object, hyperspace
lensing, plus two gaps Plan 4's sweep found) that is **not yet scoped** —
brainstorm/discuss before turning any item there into a real phase; don't treat it as
pre-approved.

[docs/PLAN.md](docs/PLAN.md) is reused as the spec for whichever plan is currently
active. **Nothing is active right now** — it was reset when Plan 3 landed and Plan 4 ran
from its own file, since deleted. Don't mistake an empty `PLAN.md` for there being no
project history; it's all in `PLAN_ARCHIVE.md`.

The ground rules below (applied throughout all three completed plans) are worth reusing
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

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
  A `post-commit` hook (`graphify hook install`) already does this automatically for code
  changes; docs are not covered by the hook and need a manual update.

**The corpus deliberately excludes `public/lib/three.min.js` and `public/assets/backgrounds/*`.**
A plain `/graphify .` re-includes both and ruins the graph — don't run one without re-applying
the exclusions. The first build (2026-08-12) did include them, and three.min.js alone was 76%
of nodes and 77% of edges while sharing **zero** edges with app code: a disjoint blob of
minified identifiers (`We`, `jn`, `ke`) that swamped every god node, community hub and
suggested question. Its names are mangler output, so nothing in it is searchable or
actionable, and it is pinned (`three: 0.160.0`) and vendored on purpose — there is nothing
to refactor there. The nebula PNGs/WebPs are procedural art and cost vision tokens to
describe as "purple nebula". Excluding both took the graph from 2103 nodes / 136 communities
(65 too thin to report) to 568 / 24 (none thin).

`CLAUDE.md`, `MEMORY.md`, `README.md` and `index.html` **are** in the corpus, and that is the
point: the rationale in this file is linked to the symbols it explains, so a query for e.g.
ring layout returns `ringSlot()`/`applyRingLayout()` *and* the reasons they are shaped that
way. Docs go through semantic extraction and cost tokens (the 2026-08-12 run: ~97k input);
code is AST-only and free. Re-extract docs only when they change materially.

**Windows trap: `graphify-out/.graphify_root` and `.graphify_python` must not have a BOM.**
The skill's install step writes them with PowerShell `Out-File -Encoding utf8`, which on
Windows PowerShell 5.1 means *UTF-8 with BOM* — the post-commit hook then reads
`﻿C:\Users\...` as a path and every rebuild dies with `WinError 123`, silently, in
`~/.cache/graphify-rebuild.log` while the commit itself succeeds. Fixed here on
2026-08-12 by rewriting both files BOM-less; re-check them (`head -c3`) after any re-run
of the skill's install step, and read the log rather than assuming the hook worked.

Known soft spot: `src/config.js`'s constants are under-linked — the AST models the config
exports as destructured import blobs, so doc edges aimed at `MOON_STAR_CAP`, `DATA_DIR`, etc.
land nowhere and get dropped (41 such edges, ~3% of raw, on the first clean build).
