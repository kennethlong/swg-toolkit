# Phase 04 — Cross-AI Plan Review (consult crew)

**Date:** 2026-06-26 · **Reviewers:** Codex (repo-wiring), Cursor (cfg/format vs swg-client-v2 + real bytes),
fresh Sonnet (lateral failure-modes), fresh Opus (rollback model correctness). Each given locked
ground-truth axioms + a non-overlapping angle. **Convergence across independent angles = highest signal.**

Verdict: **DO NOT execute as-is.** The single Sonnet plan-checker passed these plans, but the crew found
multiple real, cross-confirmed blockers (the "tests-PASSED hides unwired glue" blind spot). Revision required.

---

## BLOCKERS (cross-confirmed first)

### B1 — cfg slot is chosen from the WRONG file → patch is shadowed BY retail (silent no-load)
**Confirmed by Cursor AND Sonnet, independently.** `04-06` Step 4 derives the slot via
`scanSharedFile(swgtoolkitCfgPath)` — the toolkit-owned cfg, which starts empty → `occupiedSlots=[]` →
`chooseSlot` returns **1**. Infinity's real patches occupy slots 30–54; slot 1 is BELOW them, so retail
wins every `find()`. The patch mounts without error but is inert. Section C *preview* correctly uses
`scan` from the full `.include` chain (→ slot 55); Step 4 *insert* uses the isolated file → preview≠reality.
- **Fix:** `scanSharedFile` MUST walk the real `.include` chain (`swgemu.cfg` → `swgemu_live.cfg`) to learn
  the true `occupiedSlots`+`maxSearchPriority`; Step 4 must insert using `scan` (full-chain), not `insertScan`.
- **Cursor sub-finding:** duplicate `maxSearchPriority` across includes is **LAST-wins** (`ConfigFile.cpp:797`),
  NOT first-wins. The plan comment (04-03) + the W-NEW-1 note are backwards. Append `.include "swgtoolkit.cfg"`
  AFTER `swgemu_live.cfg` so any toolkit `maxSearchPriority` bump wins. `scanSharedFile` must read the LAST
  `maxSearchPriority`, not the first regex match. (For Infinity: slot 55 ≤ 60, no bump needed.)

### B2 — Rollback is cosmetic: `setActiveVersion` never restores the staging list / deploy
**Confirmed by Opus AND Sonnet, independently.** `setActiveVersion(n)` writes `activeVersionIndex` and dims
timeline rows but does NOT restore `stagingStore.entries`, rebuild `patch.tre`, or revert the cfg. There is
NO flatten/materialization step anywhere (grep `flatten*` across all plans = 0). `packPatch` packs the LIVE
staging list, never `changesets[active].deltas`. So DEPLOY-03 ("reverts the workspace to a prior state") is
unmet, and after rollback a pack/seal captures the WRONG (un-reverted) list.
- **Fix:** define + implement materialization. **Model decision needed (see Design Decisions):** on rollback,
  restore `stagingStore.entries` from `changesets[n].deltas`; deploy must build from the active version's
  deltas, not the live list. Reconcile the contradictory model docs (RESEARCH/UI-SPEC say "flatten top-down";
  contracts/seal say "full snapshot" — pick full-snapshot: materialize = wholesale restore of `changesets[n].deltas`).

### B3 — Seal-after-rollback corrupts history (Opus)
`sealLayer` appends at `changesets.length` and sets `active = length-1`, jumping PAST the rolled-back orphans
N+1..M — which then re-render as "✓ applied" and (once materialization exists) would silently re-include the
reverted deltas. Active pointer becomes self-contradictory.
- **Fix:** define branch/redo semantics for seal-after-rollback. **Design decision needed** (truncate orphans
  vs branch). Minimum: seal at `active+1` and explicitly define the fate of N+1..M.

### B4 — Shadow-base deploys an UNMODIFIED base (never applies staged edits) (Codex)
`04-06` builds `patch.tre` then calls `deployShadowBase`, but `deployShadowBase` (04-06b) only copies client
TREs to `.studio/shadow/` + writes cfg entries — it never consumes `patch.tre` or applies `StagingEntry` edits
into the shadow. Shadow mode "succeeds" showing none of the user's changes.
- **Fix (recommended model):** shadow-base = isolated base copy + the SAME built `patch.tre` mounted over it at
  a higher shadow slot. i.e. `deployShadowBase` registers the patch (reusing packPatch output) into the shadow's
  cfg context. **Design decision: confirm this "patch-over-isolated-base" model.**

### B5 — Verification gates won't run: `@swg/renderer` has no `test` script (Codex)
Plans 04-03/04/05 verify with `pnpm --filter @swg/renderer test`, but `packages/renderer/package.json` defines
only `build`/`dev`. Gate fails at the command, not the assertion.
- **Fix:** add a `test` script to `@swg/renderer` (vitest) as a Wave-0/04-01 task, OR change those verify commands
  to `pnpm --filter @swg/renderer exec vitest run`. Also fix VALIDATION rows accordingly.

### B6 — `workspaceName` with spaces truncates the cfg TRE value (Sonnet)
`patchName = 'swgtoolkit_' + workspaceName + '.tre'`; ConfigFile reads the value up to whitespace
(`ConfigFile.cpp:436-518`), so `"my mod"` → `searchTree_00_55=swgtoolkit_my` → TRE not found, silent fail.
- **Fix:** sanitize `workspaceName.replace(/[^a-zA-Z0-9_-]/g,'_')` before building `patchName`.

### B7 — Synchronous multi-GB `copyFileSync` loop freezes the renderer (Sonnet)
`deployShadowBase` copies every `Live/` TRE via `fs.copyFileSync` in a for-loop on the renderer thread →
UI blocks for minutes, `onProgress` can't fire.
- **Fix:** use `fs.promises.copyFile` with `await` in an async loop (or streams) so the event loop stays live.

### B8 — LFS retail-guard test passes VACUOUSLY (Sonnet)
`04-05` Test 4 does `git add -- test.tre` on a `*.tre` that is gitignored → nothing staged → the commit fails
because nothing is staged, NOT because the hook rejected a `.tre`. The guard logic is never exercised.
- **Fix:** `git add -f test.tre` to force-add, or invoke the hook script directly with synthetic staged input.

---

## WARNINGS (real, fix in revision)

- **W1 (Codex):** `04-02` imports `primaryBtnStyle`/`secondaryBtnStyle` from `ExportDialog.tsx` — they are LOCAL
  consts, not exported. Copy them locally or export them.
- **W2 (Codex):** `04-06` reset references `deployRecord`/`shadowRecord` out of scope — local state lists no
  current-deploy-record field. Add deploy-record to the dialog/store state so Reset can use it.
- **W3 (Codex):** dockview wiring points at the wrong file — `buildInitialLayout` lives in
  `workspace-config.ts:56`, not `WorkspaceShell.tsx` (which owns only `panelComponents`); there is no
  `live-inspector` addPanel to add "after". Fix the 04-02 wiring instructions to the real file.
- **W4 (Sonnet):** `process.cwd().startsWith` containment guard in `deployShadowBase` throws for EVERY real
  workspace (cwd = app dir, not the user's workspace). Replace with: absolute + no `..` + `.studio` is a direct
  child of `folderPath`.
- **W5 (Sonnet):** `createWorkspace` overwrites an existing `.git/hooks/pre-commit` (destroys Husky/linter).
  existsSync-check and append the guard block with a comment boundary, or confirm before overwrite.
- **W6 (Sonnet):** `.gitattributes` LFS lines written before `checkLfsInstalled` → cryptic git filter error when
  git-lfs absent. Verify lfs first (or write LFS lines conditionally) and surface the friendly warning.
- **W7 (Sonnet):** no stale-deployment detection — if the launcher regenerates `swgemu.cfg` and drops the
  `.include`, the mod silently goes inactive while the toolkit still shows "deployed." Re-check `.include`
  presence on workspace open / status poll; badge if missing.
- **W8 (Sonnet):** TRE copy failure leaves an orphaned `.tmp` shadow dir (only key-write failure is cleaned).
  Wrap the copy loop in try/catch → `rmSync(tmpShadowDir, {recursive,force})` before re-throw.
- **W9 (Sonnet):** `.swgtoolkit.bak` vs `.shadow.bak` coupling — patch-prepend reset restores a backup that
  predates the shadow keys, silently dropping them. Make `deactivatePatch` remove only its specific key
  (line-surgery), or enforce the two deploy models as mutually exclusive per client+session.
- **W10 (Sonnet):** no "currently deployed at v_" marker on the timeline — add a `deployedVersionIndex` +
  a `⤓ deployed` pip distinct from the `● active` pip.

## NITs
- **N1 (Sonnet):** pre-commit hook `for f in $(git diff --cached --name-only)` word-splits — use `while IFS= read -r`.
- **N2 (Sonnet):** identical `workspaceName` across two workspaces overwrites the deployed `.tre` — add a uuid/hash suffix.
- **N3 (Sonnet):** `.gitattributes` LFS list misses common big SWG types — add `*.iff *.tga *.wav *.ogg`.
- **N4 (Opus + Sonnet, converged):** no empty/duplicate-seal guard — skip seal when deltas equal the active layer's deltas; surface "Nothing new to commit."
- **N5 (Cursor/Codex):** correct the stale plan comments (first-wins → last-wins; stale file:line citations).
- Determinism (Opus): add a canonical sort by `virtualPath` before `buildTre` so re-deploy is byte-identical.

---

## CONFIRMED CORRECT (ground truth held)
- `buildTre(entries, '5000')` + tombstone entries are valid against the real `index.d.ts` (Codex). Patch must be v5000 (Cursor/Codex).
- `searchTree_<sku>_<NN>=` in `[SharedFile]`, higher-wins, first-match, tombstone-hides-retail — all CONFIRMED vs swg-client-v2 source + real Infinity cfg (Cursor).
- Shadow-base via higher-priority `searchTree` entries is sufficient — no base-dir directive exists; absolute paths work (Cursor).
- All cited analog files are real (liveStore, useLiveService, VfsTree, ExportDialog, dockview, Path B) (Codex).
- `activeVersionIndex` pointer mechanics (-1 init, bounds) are sound (Opus).
