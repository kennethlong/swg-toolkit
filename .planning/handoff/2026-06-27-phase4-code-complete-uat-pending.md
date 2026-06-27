# Handoff — Phase 4 (Edit & Deploy Loop) CODE-COMPLETE; 2 in-client UATs pending

**Date:** 2026-06-27 · **Branch:** `main` · **HEAD:** `2c9137e`
**Status:** All 8 Phase-4 plans **built, merged to `main`, and integrated** (renderer 28/28, native-core
Phase-4 6/6, renderer `tsc --noEmit` clean). The ONLY remaining work is **two human in-client UAT
checkpoints** — they require the running Electron app + the real SWG Infinity client, so they were
handed to the maintainer. Nothing is broken or half-merged.

> **Not yet pushed.** All Phase-4 work is committed locally on `main` but `git push` has NOT been run
> (per repo rule: push only when asked). `git fetch` before pushing.

---

## TL;DR — where to resume

Phase 4 code is done. **The next action is the maintainer running the two in-client UATs** (steps in
"NEXT ACTION" below). After UAT:
1. Mark `04-06` + `04-06b` complete (`gsd-sdk query roadmap.update-plan-progress 04 <id> complete`).
2. Run the phase verifier (`gsd-verifier`) / `/gsd:verify-work` and write `04-VERIFICATION.md`.
3. Close out the phase (update STATE/ROADMAP/PROJECT, REQUIREMENTS DEPLOY-01..04 → Complete).

**Verify current state fast:** `git log --oneline -20` shows the Phase-4 execution (merges
`270840d`→`2c9137e`). `pnpm --filter @swg/renderer test` = 28/28 green;
`pnpm --filter @swg/native-core exec vitest run test/packPatch.test.ts test/patch-shadow.test.ts` = 6/6.

---

## ⚠️ NEXT ACTION — the two in-client UATs (maintainer-run)

### Build & run
```
pnpm install                              # new renderer devDeps: vitest, jsdom, @testing-library/react
pnpm --filter @swg/contracts build        # contracts changed (new types)
pnpm start                                # Electron Forge — NOT `pnpm dev`. (no C++ rebuild needed — native core untouched this phase)
```

### UAT 1 — Patch-prepend deploy (the must-pass core loop; closes `04-06`)
1. Open/create a workspace folder → the **Inspect panel gains a `Deploy` tab** (Staging over the
   version-graph timeline + a `Deploy…` button).
2. Stage ≥1 modified asset (drag-drop / `+`), then **Save version** (seals a changeset).
3. Click **Deploy patch** → modal.
4. **Section A:** auto-detects `D:\SWG Infinity` (or Browse).
5. **Section C (critical):** slot preview must show **`searchTree_00_55=…`** (slot ≥ 30). **If it shows
   slot 1 → STOP, that's a B1 regression; do not deploy.**
6. Deploy → "Building patch (v5000)…" → "Writing client config…" → ✓ `deployed · slot 55`.
7. Disk check: `…\Live\swgtoolkit_<ws>_<uuid>.tre` exists; `swgtoolkit.cfg` has the `searchTree_00_55=`
   line; root `swgemu.cfg` has `.include "swgtoolkit.cfg"`.
8. Launch SWG Infinity → confirm the modded asset is live in-game.
9. **Reset deployment** → `.tre` removed from `Live/`, cfg key removed.
10. **Headline test (the bug that fooled 3 review rounds):** revert to an *older* version in the
    timeline → Deploy with no edits → must deploy that version, **NOT hang** at "building".

### UAT 2 — Shadow-base (opt-in, heavier; closes `04-06b`)
Same flow, pick **Shadow-base (isolated client)**. Copies the TRE base to `.studio/shadow/` (multi-GB —
**watch the UI stays responsive** during copy = B7), mounts the patch over the shadow, leaves `Live/`
pristine. Confirm the mod loads; then Reset.
- ⚠ **Flagged unknown (UAT item):** shadow cfg entries use **absolute paths**. If the client logs
  `could not open archive`, absolute paths are rejected (`TreeFile.cpp:115-149` unconfirmed) → small
  gap-closure: copy shadow TREs to a client-relative subdir instead. Just note it if it happens.

**Both UAT checkpoints' full step lists are in the executor returns** (and in `04-06-SUMMARY.md` /
`04-06b-SUMMARY.md`).

---

## What got built (8 plans, all on `main`)

| Plan | Delivers | Key files |
|---|---|---|
| 04-01 | Contracts (graph model) + Zustand stores + workspaceService + renderer test infra | `packages/contracts/src/{workspace,staging,changeset,deploy}.ts`; `packages/renderer/src/state/{workspace,staging,changeset}Store.ts`; `services/workspaceService.ts`; `renderer/vitest.config.ts` (jsdom) |
| 04-02 | Staging panel + inspector-group tab registration | `panels/deploy/{StagingPanel,WorkspaceEntry,ActionBadge}.tsx`; `shell/StatusBar.tsx`; `workspace/workspace-config.ts` (+`WorkspaceShell.tsx`); `backend/src/main.ts` (`workspace:pick-dir/pick-file` IPC) |
| 04-03 | packPatch(v5000) + clientLocator(full-chain scan) + cfgActivator | `services/{packPatch,clientLocator,cfgActivator}.ts`; `native-core/test/{packPatch,patch-shadow}.test.ts`; `renderer/test/{cfgScan,cfgActivator}.test.ts` |
| 04-04 | Version-graph engine | `services/changesetService.ts`; `renderer/test/changeset.test.ts` (8 tests) |
| 04-04b | ChangesetTimelinePanel (git-graph) | `panels/deploy/ChangesetTimelinePanel.tsx` (+`.test.tsx`, 5 jsdom tests) |
| 04-05 | Git/LFS + VCS panel | `services/gitLfsService.ts`; `state/vcsStore.ts`; `panels/deploy/VcsPanel.tsx`; `renderer/test/gitLfs.test.ts` |
| **04-06b** | Shadow-base backend (**UAT pending**) | `services/shadowBaseService.ts` |
| **04-06** | DeployDialog modal + end-to-end deploy (**UAT pending**) | `panels/deploy/DeployDialog.tsx` (+ StagingPanel Deploy-button wiring) |

**Execution mechanics:** parallel git-worktree isolation per plan, merged wave-by-wave. One real
post-merge integration bug was caught + fixed (`f7cc1af`): StagingPanel called `sealVersion`
positionally against 04-02's stub; real `04-04` `sealVersion` takes a single `SealVersionParams` object.

---

## The model (DEPLOY-03) — DO NOT regress (3 review rounds hardened this)

A **version graph**, not a flat list. Implemented in `services/changesetService.ts`:
- **`flatten(versionId)`** — walk `root→N` via `parentId` (push+reverse, O(n)), **last-writer-wins**
  accumulator, `delete→tombstone`, **code-point sort** (NOT `localeCompare` — cross-machine
  determinism), **`visited` cycle guard**.
- **`sealVersion(params)`** — stores **DIFF-VS-PARENT** deltas only (sha from the SOURCE file, filter
  changed-vs-`flatten(parent)` BEFORE copying — copies ONLY changed files; explicit-tombstone delete
  invariant); `parentId = activeVersionId` ⇒ branching; N4 empty/dup guard via `flatEqual`; atomic
  `tmp+rename` manifest write.
- **`selectVersion(id)`** — sets `activeVersionId` AND materializes staging via
  `restoreEntries(flatten(id))` (rollback is real, not cosmetic).
- **`updateChangesetDeployRecord` / `setDeployedVersion(id)`** (validates id exists) — persist deploy
  state to the manifest.
- **Dirty model:** `dirty = staging ≠ flatten(activeVersionId)`. `DeployDialog.handleDeploy` auto-seals
  ONLY when dirty (auto-seal wrapped in try/catch → setPhase error, never strands at "building"); deploy
  builds from `flatten(activeVersionId)`, **never the live staging list**. → "select old version →
  Deploy" works without hang.
- **BANNED (absent everywhere):** `PurgeChangesetLayer` / `.tar.gz` snapshot engine / array-splice
  rollback / `exec()` with string interpolation.

Store: `WorkspaceChangesetManifest { activeVersionId, deployedVersionId, changesets[] }`,
`SwgChangeset { id, parentId, label, timestamp, sealedBy, deltas[], deployRecord? }`. String UUID
pointers — the old `activeVersionIndex: number` is banned.

---

## Ground-truth (DEPLOY-01/02) — verified vs swg-client-v2 + real Infinity bytes

- Patch built **`version='5000'`** (live client mounts `EERT5000`; `'0005'` default is WRONG). `buildTre`
  tombstone entry (length-0 TOC) hides retail.
- `.cfg`: **`searchTree_<sku>_<NN>=<file>.tre`** keys in a **`[SharedFile]`** section; higher suffix
  wins; first-match; `maxSearchPriority` gates the scan; duplicate `maxSearchPriority` is **LAST-wins**
  (`ConfigFile.cpp:797`). `scanSharedFile` MUST walk the full `.include` chain from the client cfg root
  (scanning the empty `swgtoolkit.cfg` alone → slot 1 → retail shadows the patch). Real Infinity:
  `maxSearchPriority=60`, slots `_00_30..54` used → **slot 55**.
- Write target = toolkit-owned **`swgtoolkit.cfg`** pulled in via **`.include "swgtoolkit.cfg"`** appended
  once to the stable root `swgemu.cfg`; **never** `user.cfg`/`options.cfg` (launcher-clobbered). CRLF,
  BOM-free, atomic, backup, line-surgery deactivate.
- `clientLocator` is NEW work (live-inject has NO install discovery). `SWGEmu` stock client not installed
  → DEPLOY-02 only byte-verified vs Infinity; stock `maxSearchPriority` defaults to 20.

---

## UI layout (sketch-validated, in `04-UI-SPEC.md` §Layout)

Deploy UI lives as a **tab in the existing Inspect panel group** (`Inspect` | `Deploy`), NOT new dock
regions. Deploy tab = **Staging (sketch 004-B)** over the **Version graph (sketch 002-A, git-graph
lanes)** + a **`Deploy…`** button → the **deploy modal (sketch 003-A)**. Modal costs no panel space —
that's why it fits. Inspector defaults ~380px when Deploy active (sketch 005-B; ~300px is cramped →
labels ellipsize + row-actions collapse to `⋯`). `workspace-config.ts` registers Staging/Timeline/VCS as
tabs `within` the `inspector` group. Sketches committed at `ef74d58`; winners 002-A/003-A/004-B/005-B.

---

## Build / run / test gotchas

- **App:** `pnpm start` (Electron Forge), NOT `pnpm dev`.
- **Node not on the non-interactive PATH:** bash → `export PATH="/c/Program Files/nodejs:$PATH"`;
  PowerShell → `$env:PATH = "C:\Program Files\nodejs;$env:PATH"`.
- **New renderer devDeps** (vitest/jsdom/@testing-library/react, added 04-01) → run `pnpm install`.
- **Contracts changed** → `pnpm --filter @swg/contracts build` before the renderer sees new types.
- **Renderer now HAS a `test` script** (`vitest run`, jsdom config incl. `*.test.tsx`). 28 tests.
- **Native-core test flake (IGNORE):** `test/resolve-prebuild.test.ts` fails with
  `EPERM: rename 'build' -> 'build.bak'` — a **pre-existing Phase-0** Windows build-dir lock, unrelated
  to Phase 4. All Phase-4 native tests (packPatch 4, patch-shadow 2) pass.
- **Worktree exec model:** executors ran isolated; orchestrator merged each wave, resolving stub↔real
  add/add conflicts by keeping the real implementation. Worktrees cleaned up.

---

## Review journey (what's already verified — don't re-litigate)

plan-checker (structural PASS) + **two full cross-AI crew rounds** + a targeted Opus deploy-boundary
re-check. R1 found: cfg-scanner-reads-wrong-file (Cursor+Sonnet), rollback-cosmetic (Opus+Sonnet),
shadow-deploys-unmodified-base (Codex), renderer-no-test-script (Codex). R2 found: deploy-boundary
auto-seal hang (Opus — the headline bug, present-but-subtly-wrong), UI-layout mismatch (Codex+checker),
timeline path, .tsx test infra, deploy-record patchPath + persistence, shadow-reset W9 regression. **All
closed** across 3 revision rounds + 3 final residual fixes. Crew briefs:
`.planning/research/CONSULT-P4-*.md` + `CONSULT-P4R2-*.md` (`.out` files gitignored). Lesson: the
plan-checker validates structure; the crew validates correctness — both were needed.

---

## Deferred / parked (for the eventual milestone replan, NOT now)

- **Cross-session shadow reset** (post-MVP tech debt, W-NEW-2): `ShadowDeployRecord` stored via
  `as unknown as CfgDeployRecord` cast — within-session reset works; cross-session would mis-type. Fix:
  discriminated-union `deployRecord` or a `deployModelKind` tag. In `04-CONTEXT.md` Deferred Ideas.
- **REQUIREMENTS.md traceability stale:** VIEW-03/04 + CORE-02 marked Pending but actually Complete
  (Phase 2/1). DEPLOY-01..04 flip to Complete after UAT.
- **live-world-terrain-sync** placement (new Phase 9 vs 7.1) — depends on Phase 5+7; decide at the
  milestone replan (carried from the Phase-3 handoff).
- **Backlog todo:** `vfs-override-archive-dim-too-dark` — bump the gray (non-override) archive label
  from `--color-text-faint` to something lighter (reads as deselected). `.planning/todos/pending/`.
- ROADMAP/STATE `progress:` block has been hand-edited across the session; recompute milestone % at
  close-out (4 phases done of 9; Phase 4 about to be the 5th).

---

## Memory candidates (write at close-out if not already)

- The cross-AI crew found **real, cross-confirmed blockers the GSD plan-checker passed** — **twice** —
  including a deploy-boundary bug that was "present but subtly wrong" through 2 rounds. Reinforces
  `feedback-executor-integration-blind-spot` + the consultant-crew protocol. Worth a `feedback` memory:
  "after a major plan revision, re-run the crew on the *revised* plans, not just the originals; the
  plan-checker won't catch correctness/wiring regressions the revision introduces."
