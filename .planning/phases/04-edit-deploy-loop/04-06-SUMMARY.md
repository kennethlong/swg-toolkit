---
phase: "04"
plan: "06"
subsystem: deploy-dialog
tags: [deploy, modal, cfg-slot, patch-prepend, shadow-base, changeset, correctness]
dependency_graph:
  requires: [04-02, 04-03, 04-04, 04-04b, 04-05]
  provides: [real-deploy-modal, end-to-end-deploy]
  affects: [StagingPanel, changesetService, cfgActivator, packPatch, shadowBaseService]
tech_stack:
  added: []
  patterns:
    - ExportDialog structural clone (overlay + panel + header × + dividers)
    - deployingRef mutex (W9)
    - flatEqual-based dirty check (R2-B1/B2)
    - scanSharedFile full-chain from cfgRootPath (B1)
    - buildPatchName UUID-fragmented filename (B6+N2)
key_files:
  created: []
  modified:
    - packages/renderer/src/panels/deploy/DeployDialog.tsx
    - packages/renderer/src/panels/deploy/StagingPanel.tsx
decisions:
  - Always-mounted DeployDialog with open prop (never conditional render) for clean phase state reset on re-open
  - Auto-seal try/catch prevents strand at phase:'building' if seal IO fails
  - isDirty guard uses flatEqual (same predicate as N4) — so 'Nothing new' throw cannot fire inside the isDirty=true branch
  - Shadow-base path calls deployShadowBase(client, studioDir, outputPath) then updateChangesetDeployRecord
  - Local button styles (primaryBtnStyleLocal, secondaryBtnStyleLocal, dangerBtnStyleLocal) — not imported from ExportDialog
  - Reset confirmation step before destructive operation
metrics:
  duration_minutes: 30
  completed_date: "2026-06-27"
  tasks_completed: 1
  tasks_total: 2
  files_modified: 2
---

# Phase 4 Plan 06: DeployDialog modal — real implementation Summary

Real deploy modal replacing the 04-02 stub; full patch-prepend + shadow-base paths with eight correctness fixes.

## Objective

Implement the complete `DeployDialog.tsx` replacing the stub from plan 04-02. The modal handles the full deploy workflow: client selection, deploy model choice (patch-prepend vs shadow-base), cfg-slot preview, build/activate progress, and reset. Seven `must_haves.truths` correctness requirements applied.

## What Was Built

**`packages/renderer/src/panels/deploy/DeployDialog.tsx`** — complete 360px single-column stepper modal:

- **Section A**: Target client picker with auto-detected installs (detectClients) + Browse IPC button
- **Section B**: Deploy model radios — patch-prepend (default, accent ring) + shadow-base (opt-in, disk estimate warning)
- **Section C**: Config slot preview (`[SharedFile]` key preview, full-chain scan from cfgRootPath)
- **Phase state**: AsyncProgress (building/activating), VerificationStatus (done/error), Reset button with confirmation step
- **Action row**: Cancel + Deploy patch (disabled when no client or in-flight)

**`packages/renderer/src/panels/deploy/StagingPanel.tsx`** — updated to always-mount pattern:
- Changed from `{deployOpen && <DeployDialog onClose={onDeployClose} />}` to `<DeployDialog open={deployOpen} onClose={onDeployClose} />`

## Correctness Fixes Applied

| Fix | What it does |
|-----|-------------|
| W2  | `handleDeploy` reads `flatten(activeVersionId)` from version graph — not live stagingStore.entries |
| R2-B1/B2 | Dirty check: `isDirty = !flatEqual(stagingSorted, flatten(activeVersionId))` — not `entries.length > 0` |
| B1  | `scanSharedFile(client.cfgRootPath)` — full .include chain walk discovers retail slots 30-54; never swgtoolkitCfgPath alone (slot 1 is below retail, files never load) |
| B6+N2 | `buildPatchName(workspaceName)` sanitizes spaces + adds UUID fragment; raw concatenation banned |
| W7  | Stale-deployment warning banner when `manifest.activeVersionId !== manifest.deployedVersionId` |
| W9  | `deployingRef = useRef(false)` mutex + disabled Deploy button while `phase.kind !== 'idle'` |
| R2-B7 | `record.patchPath = patchPathInLive` — Reset's `fs.unlinkSync(rec.patchPath)` works |
| R2-B8 | `updateChangesetDeployRecord(activeVersionId!, deployRecord)` persists across unmounts |

**Auto-seal safety (R2-final):** `sealVersion(...)` is wrapped in try/catch. If seal IO fails (manifest write, no workspace), error surfaces as `phase:'error'` instead of stranding the dialog at `phase:'building'`. The N4 "Nothing new" throw cannot fire because `isDirty=true` uses the same `flatEqual` predicate as the N4 guard.

## Deploy Paths

**Patch-prepend (default):**
1. `packPatch(flattenedEntries, outputPath)` — builds patch .tre in `studioDir/build/`
2. `fs.copyFileSync(outputPath, clientLiveDir/patchName)` — copies to client Live/
3. `activatePatch(swgtoolkitCfgPath, patchName, insertScan)` — inserts cfg key
4. `ensureInclude(cfgRootPath, 'swgtoolkit.cfg')` — idempotent .include hook
5. `setDeployedVersion(activeVersionId)` + `updateChangesetDeployRecord(...)` — persist record

**Shadow-base (opt-in):**
1. `deployShadowBase(client, studioDir, outputPath)` — handles full shadow copy + cfg write
2. `setDeployedVersion(activeVersionId)` + `updateChangesetDeployRecord(...)` — persist record

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree was behind main by 5 commits**
- **Found during:** Task 1 (writing DeployDialog.tsx)
- **Issue:** Worktree was created from commit `68cae4f` (Phase 3 complete) but main had advanced to `b9a0a57` (Phase 4 Wave 1-3 merged). All deploy panel files (StagingPanel.tsx, ChangesetTimelinePanel.tsx, services, etc.) were missing from the worktree.
- **Fix:** Saved new DeployDialog.tsx to scratch, ran `git merge main` (fast-forward), restored DeployDialog.tsx over the stub.
- **Files modified:** All Phase 4 files merged in; no conflicts.

**2. [Rule 3 - Blocking] contracts package not built → TS6305 errors**
- **Found during:** TypeScript check after writing DeployDialog.tsx
- **Issue:** `@swg/contracts/dist/index.d.ts` didn't exist in the worktree (contracts package not yet built). All files importing `@swg/contracts` emitted TS6305.
- **Fix:** `pnpm --filter @swg/contracts build` (runs `tsc`, produces `dist/`). After build, `pnpm --filter @swg/renderer exec tsc --noEmit` passes clean.
- **Files modified:** `packages/contracts/dist/` generated (not committed, build artifact).

## Task Status

| Task | Type | Status | Commit |
|------|------|--------|--------|
| 1    | auto | COMPLETE | 0ad116d |
| 2    | checkpoint:human-verify | PENDING — in-client deploy UAT | — |

## Known Stubs

None. DeployDialog.tsx is the real implementation replacing the 04-02 stub. All service calls wire to real implementations committed in earlier plans.

## Self-Check

- [x] `DeployDialog.tsx` created at `packages/renderer/src/panels/deploy/DeployDialog.tsx`
- [x] `StagingPanel.tsx` updated (conditional render → always-mounted open prop)
- [x] TypeScript: `pnpm --filter @swg/renderer exec tsc --noEmit` exits 0
- [x] Task 1 committed at `0ad116d`
- [x] 23/24 acceptance grep checks PASS (1 false-fail: pattern didn't match multiline prop format)

## Self-Check: PASSED
