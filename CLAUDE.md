# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SolarMemories ("Maddi's Memories") — a local personal app for storing memories (photos,
letters, audio) about favourite people. Each person is a "galaxy"; memories orbit as
"planets"/cards in a Three.js 3D scene, arranged in rings by galaxy.

## Commands

```bash
npm start          # node server.js — serves the app at http://localhost:3000
```

- There is no lint script and no test suite (`npm test` is a stub that errors).
- `./start.command` is the packaged launcher: it runs `./node/node server.js` using a
  bundled Node binary (for running the app without a system-wide Node install). Both
  `node/` and `start.command` need `chmod +x` before first use on macOS.
- `DATA_DIR` env var overrides where JSON data is stored (defaults to `./data`).

## Architecture

**Currently a two-file monolith** — everything is in `server.js` and `public/index.html`.
A phased refactor into `src/` (backend) and `public/js/`+`public/css/` (frontend) modules
is planned but not yet started; see "Development plan" below before making structural changes.

### Backend (`server.js`)
Thin Express app with a hand-rolled JSON-file "database":
- Two flat files: `data/galaxies.json`, `data/memories.json`.
- `readJSON`/`writeJSON` read/write the whole file each time; writes are atomic
  (write to `.tmp`, then `fs.renameSync`).
- `withWriteLock` chains a module-level `writeQueue` promise so concurrent requests
  serialize their read-modify-write cycles instead of racing.
- Routes: `GET/POST /api/galaxies`, `DELETE /api/galaxies/:id` (cascades — also deletes
  that galaxy's memories), `GET /api/memories?galaxy=<id>`, `POST /api/memories`,
  `DELETE /api/memories/:id`.
- Photos/audio are stored inline as base64 data URLs directly in the JSON records
  (no separate blob storage). `MAX_DOC_SIZE` caps a single memory doc at 8MB; the
  Express JSON body parser is capped at 12mb.
- Data schema:
  - galaxy: `{ id, name, accentColor, ring (1-3), createdAt }`
  - memory: `{ id, galaxyId, type ('photo'|'letter'|'audio'), title, date, text, photoData, audioData, createdAt }`

### Frontend (`public/index.html`)
Single file: inline `<style>` block followed by inline `<script>` (no build step, no
framework — vanilla JS + Three.js loaded from a CDN `<script>` tag). Rough shape of the
script section:
- API helpers (`loadGalaxies`, `createGalaxyRemote`, `deleteGalaxyRemote`, `persistMemory`,
  `loadAllMemories`, `deleteMemory`) — thin `fetch()` wrappers around the backend routes.
- Three.js scene setup — camera, renderer, procedurally-painted nebula background
  (`paintGlow`), starfield, floating "fairy light" decorations, and drag-to-look camera
  controls (pointerdown/pointermove on the canvas).
- Card rendering — `makePolaroidTexture` draws a memory (photo/letter/audio) onto a
  canvas as a polaroid-style texture, mapped onto a `THREE.PlaneGeometry` mesh via
  `addMemoryToScene`. Cards are laid out in a ring via `getCardPosition`.
- Galaxy picker — `renderSolarSystem`/`addPlanet` draw galaxies as orbiting planets
  around a central sun; clicking one plays a hyperspace transition (`playHyperspace`)
  into that galaxy's ring of memory cards (`selectGalaxy` → `loadGalaxyMemories`).
  `showGalaxyPicker`/`backToGalaxiesBtn` return to the picker.
- Add/edit forms — add-memory overlay (type selector, photo/audio drag-drop with
  client-side image compression via `compressImage`), add-galaxy and edit-galaxy overlays
  (color/ring pickers), delete confirmation flows for both memories and galaxies.
- Read view — `openReadView`/`closeReadView` show a memory's full content (text, image,
  audio player) in a modal overlay.
- `init()` at the bottom wires everything up and does the initial data load.

## Data safety

`data/` holds real personal photos/letters/audio and is gitignored — never assume it's
disposable. `docs/` and `node/` are also gitignored (present locally, not tracked).

## Development plan

[docs/PLAN.md](docs/PLAN.md) has a detailed, phase-by-phase plan for refactoring this app
(file structure split, validation, per-record storage, archive-not-delete, backups, and a
number of feature/perf phases). If asked to do structural or feature work here, **read that
file first** — it specifies strict rules that override general habits:
- One git branch per phase; don't combine phases or skip ahead.
- Restate the phase's plan and file list before writing code; stop and ask if anything is
  ambiguous, especially anything touching `data/`.
- Any phase that writes to `data/` must first copy it to `data.bak-<timestamp>/`.
- After each phase, run `npm start`, manually exercise the affected behavior, and report
  what was actually tested.
- If a phase's diff touches more than ~5 files outside its designated area, stop and flag it.
