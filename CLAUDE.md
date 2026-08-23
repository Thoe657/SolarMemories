# SolarMemories

Local, single-user app for private photos, letters, and audio. Each person is a
`planet`; memories are `stars`, grouped into `moons` of at most 28. The `universe`
theme changes presentation and user-facing nouns only; code, API, and data keep the
`planet`/`moon` model.

## Safety

- `data/` contains irreplaceable personal content. Treat it as production data even
  though it is gitignored.
- Get explicit approval before any write, migration, seed, deletion, or overwrite of
  real `data/`, and first copy it to `data.bak-<timestamp>/`.
- Test data-writing work with synthetic data in a separate checkout. Do not rely on
  `DATA_DIR` for isolation; it has previously written to real data despite reporting the
  override.
- Copy `node_modules` into test worktrees; never junction it. Stop the test server and
  remove its copied `node_modules` before removing the worktree.
- `backups/`, `docs/`, `node/`, packaging assets, and the delivery folder are also
  gitignored. Git status is not evidence that they are disposable.

## Workflow

- Run with `npm start` at `http://localhost:3000`. There is no build step, lint script,
  or test suite (`npm test` is a failing stub).
- `docs/PLAN.md` is the active spec. An empty file means nothing is scoped;
  `docs/PLAN_NEXT.md` contains candidates, not approved work. Completed work and design
  history live in `docs/archive/PLAN_ARCHIVE.md`.
- For an active plan, work on `main` one phase at a time and commit each phase
  separately. Restate the phase scope before editing; stop if the diff crosses about
  five files outside its designated area.
- Give a delegated phase the output of `node scripts/plan-phase.js <n>` rather than the
  whole plan.
- After a phase, exercise the affected behavior and report what was actually checked.

Useful development URLs:

- `?perf=1` enables the HUD and `window.__perf()`.
- `?quality=high|low` forces a graphics tier for that load.
- `?theme=solar|universe` selects and persists a theme.

## Architecture invariants

- Backend code is under `src/`; the frontend is native ES modules under `public/`.
  `server.js` stays a thin entrypoint.
- The theme is fixed for a page lifetime. Applying a theme or quality change reloads
  beneath the entry screen; live re-theming would invalidate textures and scene state.
- `quality.js` must resolve before `scene.js` constructs WebGL because antialiasing is
  fixed at renderer creation. Scene animation uses `addFrameCallback`, not independent
  `requestAnimationFrame` loops, so tier limits and pause state remain authoritative.
- `GET /api/memories` is slim by default. Use media-specific endpoints for lazy card
  loads, and fetch the full record before editing so saving cannot strip photo/audio.
- The server assigns a new memory's `moonId`. Wait for the response before rendering;
  only draw it when it belongs to the currently viewed moon.
- Theme canvas colors come from `theme.js`; keep the universe card/sky contrast guard
  synchronized with the palette. Background generation is deterministic and its script
  exits non-zero when contrast fails.
- Pre-paint inline scripts in `public/index.html` prevent theme and owner-name flashes.
  The server settings response remains authoritative for the owner name.

## Verification

- Prefer console output, API requests, server logs, and `window.__perf()` over images.
  Use a cropped screenshot only when the question is genuinely visual.
- The in-app browser suspends `requestAnimationFrame`, so it cannot verify WebGL timing
  or rendering. Use headless Chrome over CDP with a visible page; the renderer canvas is
  `#scene-container canvas`, not the first `canvas` in the document.
- Verify data-writing paths only against the fixture checkout described under Safety.

## Packaging

`Solar Memories/` is generated delivery output, not source. It contains the `.app`
beside a visible `data/` copy and `start.command`. Read `Solar Memories/README.md` before
packaging or changing launch/quit behavior; copying real data into a delivery build is a
manual, approval-gated step.

## Graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
