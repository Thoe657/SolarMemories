# SolarMemories

A local personal app for storing memories (photos, letters, audio) about favourite
people (or anything!) — built as an anniversary gift. Each person is a planet;
memories orbit as star cards in a Three.js 3D scene, grouped into moons of up to 28
stars each. Two visual themes ship: `solar` (planets/moons/stars, warm cream cards) and
`universe` (galaxies/nebulae/stars, cool graphite cards, black-hole portals) — a skin
over the identical data and hierarchy, switchable from the settings panel.

Everything is local: no accounts, no server calls out, no database beyond plain JSON
files on disk. It's a single-user, single-machine app meant to run on the recipient's
own computer.

## Running it

```bash
npm install
npm start          # serves the app at http://localhost:3000
```

Node and npm are the only requirements to run from source. There's no build step and no
bundler — the frontend is native ES modules served straight out of `public/`.

Useful query params for development:
- `?perf=1` — a perf HUD and `window.__perf()` for checking render cost without a
  screenshot.
- `?quality=high|low` — force a graphics tier, bypassing the auto-detect benchmark.
- `?theme=solar|universe` — force a theme (persists, unlike `?quality=`).

There's no lint script and no test suite. See `CLAUDE.md` for the full architecture
writeup, the reasoning behind the load-bearing bits of the rendering code, and the
project's development history.

## Where your data lives

Everything you add — photos, letters, audio, the people and groupings you create — is
stored as plain JSON files under `data/` (gitignored; never committed). The settings
gear in the app's menu has an "open data folder" button that reveals it directly. The
app also keeps its own rolling zip backups in `backups/` (also gitignored), and takes
one automatically on startup if the newest is stale or missing.

`data.test-fixture/` is a synthetic, gitignored dataset you can copy over a separate
checkout's `data/` if you want to test against a planet with multiple moons without
touching real data.

## Building the actual gift

This repo is the source. The thing a recipient actually double-clicks is a separate,
gitignored `Solar Memories/` folder — an `.app` bundle sitting beside a visible `data/`
copy, built from this repo but not itself source-controlled. If you're preparing that
package:

- `Solar Memories/README.md` (inside that folder, not this one) is written for the
  recipient — setup steps, permissions, how to quit.
- The packaging process and its current state (what's automated, what's still a manual
  step) are documented under "Packaging" in `CLAUDE.md`.

## More detail

`CLAUDE.md` is the primary reference for anyone working on this codebase: architecture,
data schema, the two-theme system, performance notes, data-safety practices, and the
full project history through v1.

`AGENTS.md` points to claude.md as a single-source of truth.
