# Session log

## 2026-08-12 — Plan 3 complete: performance & smoothness, low-end PCs first (phases 1-9)
Completed: Implemented and committed all 9 phases of Plan 3 — perf HUD + `?perf=`/
`?quality=`, pausing the render behind the entry screen/picker, fairy lights as two
shader `Points` clouds, persistent quality tiers, slim `/api/memories` + lazy media,
shared card geometry + LRU texture cache, lossless-WebP skies + vendored three.js, and
compositing/transition/input work — then swept all three tiers and folded it into
`PLAN_ARCHIVE.md`.
Decisions: Four of the plan's own baseline findings were wrong when measured (fairy
lights were never ~240 draw calls, Theo's 6.9MB is a photo not audio, the portal caption
plate isn't drawn at 1:1, dropping sky alpha saves neither bytes nor VRAM) — corrected
per phase in the archive rather than quietly dropped. User approved a `sharp`
devDependency for lossless WebP and `npm install three@0.160.0` to vendor three.js.
Open issues & next steps: Frame times here are throttle-bound (20ms/35ms against the
60/30fps targets), so tiers are verified as *applied*, not as rescuing genuinely slow
hardware — the machine this plan targeted is still untested; `prefers-reduced-motion`
forcing low is verified by inspection only. `fonts.googleapis.com` is the last external
host (offline load works but falls back to system type) — self-hosting is now filed in
PLAN_NEXT.md; `docs/PLAN.md` is reset, and `docs/PLAN_4_UNIVERSE_THEME.md` is drafted
but unscoped.
Files touched: `public/js/` (new `perfHud.js`, `quality.js`; plus scene, cards, cardFlip,
memoryForm, api, planetPicker, entryScreen, main), `public/css/styles.css`,
`public/index.html`, new `public/lib/three.min.js` + `public/assets/backgrounds/*.webp`,
`src/routes/memories.js`, `server.js`, `scripts/` (new `perf-report.js`,
`build-backgrounds.js`), `package.json`, `CLAUDE.md`; `docs/` (gitignored).
Commits: 84b521f..d1a05ec

## 2026-08-10 — Phases 6,7,8,9,10,12: plan complete, folded into archive, pushed
Completed: Implemented and committed the plan's remaining phases via sequential
subagents — Phase 6 (milestone star cards), 7 (memory editing), 8 (restore-from-backup
UI), 9 (touch tap-target fixes), 10 (undo toast), 12 (moon satellites in the picker) —
completing all 12 phases of "Galaxy scaling"; folded `docs/PLAN.md` into
`docs/PLAN_ARCHIVE.md` as "Plan 2" and pushed all 8 commits to `origin/main`.
Decisions: User confirmed the ~40 `mem-test-*`/`planet-test-*` records found in real
`data/` are a deliberate "Moons Demo" fixture, not pollution — left untouched rather than
restoring from backup. A Phase 8 `git worktree remove` followed a Windows `node_modules`
junction and deleted the real repo's `node_modules` (not `data/`); self-recovered via
`npm install`, re-verified afterward.
Open issues & next steps: No plan is currently active — `docs/PLAN.md` is reset to an
empty placeholder; next work should come from `docs/PLAN_NEXT.md` once something's
scoped. Several phases (7/9/10/12) couldn't be pixel-verified since the in-app browser
pane never fires `requestAnimationFrame` — verified via direct function calls/API round-
trips instead, now documented in `PLAN_ARCHIVE.md`'s Plan 2 cross-cutting notes.
Files touched: `public/js/` (cards.js, cardFlip.js, memoryForm.js, scene.js, state.js,
api.js, planetPicker.js, motionPreference.js), `public/index.html`, `public/css/
styles.css`, `src/routes/{backup,planets,memories}.js`, `src/lib/zipBackup.js`,
`CLAUDE.md`; `docs/PLAN.md`, `docs/archive/PLAN_ARCHIVE.md` (both gitignored).
Commits: 4f6ceaa..6dc24ca

## 2026-08-09 — Phases 4/5/11: portals, hyperspace escalation, planet/moon rename (archived — see docs/MEMORY.archive.md)
Built moon-navigation portals (Phase 4), hyperspace escalation (Phase 5), and the
galaxy→planet/planet→moon rename including on-disk data (Phase 11); portal
PointLight/caption-placement rationale is now documented in CLAUDE.md's architecture
section. Its open issues (Phase 6 star shape, Phase 12 picker satellites) are resolved
as of the 2026-08-10 entry above.

## 2026-08-08 — Phase 3: frontend renders only the viewed planet's stars (archived — see docs/MEMORY.archive.md)
Rendered only the viewed planet's stars, verified 28/35 on a 2-planet test set; flagged a
`DATA_DIR`-override test-seed mishap (recovered from backup). Its open issue (add-memory
flow not planet-aware) and its `DATA_DIR` lesson are both resolved/codified as of the
2026-08-09 entry above and CLAUDE.md's Data safety section.

## 2026-08-07 — Scoped PLAN_NEXT into PLAN.md (Phases 7-10), executed Phase 2 (planets data model) (archived — see docs/MEMORY.archive.md)
Scoped memory editing, restore-from-backup UI, touch controls and the undo toast into
PLAN.md as Phases 7-10, and built the `planets` record type with ~28-star grouping
(`src/lib/planetNames.js`, `scripts/backfill-planets.js`). Its decision — a re-POST of an
existing memory id preserves `planetId`/`moonId` like `createdAt` — is codified in
CLAUDE.md's memories-routes description; all four scoped items shipped by 2026-08-10.

## 2026-08-07 — Scoped "Galaxy scaling" plan (stars & planets), executed Phase 1 rename (archived — see docs/MEMORY.archive.md)
Scoped the 6-phase "Galaxy scaling" plan and renamed memory cards to "stars", working
around a naming collision by calling the picker's icons "world" (`addWorld`, `.world`).
That workaround was retired by Phase 11's galaxy→planet/planet→moon rename; the whole
plan is now Plan 2 in `docs/archive/PLAN_ARCHIVE.md`.

## 2026-08-06 — Executed PLAN.md phases 0–14 + doc wrap-up (plan now fully complete) (archived — see docs/MEMORY.archive.md)
Built the original 15-phase plan (modular refactor, validation, per-record storage,
archive-not-delete, backups, texture caching, adaptive quality, baked backgrounds) and
consolidated the docs into PLAN_ARCHIVE.md + PLAN_NEXT.md; it is now Plan 1 in the
archive. Two gotchas it recorded are still live and not codified elsewhere: `pkill -f
"node server.js"` doesn't kill the Windows `node.exe` here — use `taskkill //F //IM
node.exe`; and the in-app browser pane stalls `requestAnimationFrame`, which has now
recurred across all three plans.
