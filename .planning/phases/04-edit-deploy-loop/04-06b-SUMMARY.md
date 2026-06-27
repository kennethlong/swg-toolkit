---
phase: 04-edit-deploy-loop
plan: "06b"
subsystem: deploy
tags: [shadow-base, cfg-activation, async-copy, B4-fix, B7-fix, W4-fix, W8-fix]
dependency_graph:
  requires:
    - 04-01  # workspaceService (.studio/ structure, .gitignore with shadow entry)
    - 04-03  # clientLocator (scanSharedFile, chooseSlot) + cfgActivator (activatePatch)
    - 04-04  # sealVersion + changesetService (flatten produces the patchPath input)
  provides:
    - deployShadowBase   # async shadow TRE copy + cfg activation (B4 patch at highest slot)
    - resetShadow        # line-surgery cfg reset (R2-W2)
    - estimateTreSize    # pre-flight size estimate for checkFreeDisk
    - checkFreeDisk      # T-04-SB-01 disk space guard
    - diffShadow         # UAT helper: compare Live/ vs shadow/ *.tre sets
  affects:
    - swgtoolkit.cfg     # written by deployShadowBase; line-surgery cleaned by resetShadow
    - .studio/shadow/    # shadow TRE copy destination
tech_stack:
  added: []
  patterns:
    - async-fs-copyFile         # B7: await fs.promises.copyFile in TRE copy loop
    - path-relative-containment # W4: path.relative(root, target).startsWith('..')
    - tmp-atomic-rename         # W8: .tmp dir + rename for atomic shadow promotion
    - local-slot-tracking       # R2-W1: occupiedSlots maintained locally after each activatePatch
    - cfg-line-surgery          # R2-W2: filter only inserted keyName= lines (no bak restore)
key_files:
  created:
    - packages/renderer/src/services/shadowBaseService.ts
  modified: []
decisions:
  - "Absolute path UAT item: searchTree cfg values use absolute paths to .studio/shadow/ TREs.
     Whether TreeFile.cpp:115-149 accepts absolute paths is UNVERIFIED.
     In-client UAT (Task 2) is required to determine if gap-closure is needed."
  - "checkFreeDisk uses fs.statfsSync (Node 18+) via dynamic lookup with a non-fatal fallback
     (warns and continues if statfsSync unavailable)."
  - "resetShadow(record, cleanup=false) keeps shadow TRE copies on disk by default;
     cleanup=true removes them. The .shadow.bak is never auto-restored (R2-W2)."
metrics:
  duration: ~40 min
  completed: "2026-06-26"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 04 Plan 06b: Shadow-Base Deploy Backend Summary

**One-liner:** Async shadow-base deploy with B4 (patch slot above shadow TREs), B7 (no
renderer-freeze copyFileSync), W4 (path.relative containment), W8 (.tmp cleanup on error),
R2-W1 (one full-chain scan, local slot tracking), R2-W2 (line-surgery reset, no bak restore).

## Status

**Task 1 — COMPLETE** (commit `7a33aed`): `shadowBaseService.ts` created, TSC clean.
**Task 2 — PENDING CHECKPOINT**: In-client UAT awaiting human verification.

## What Was Built

`packages/renderer/src/services/shadowBaseService.ts` — the shadow-base deploy model backend.

Implements six exports:
- `ShadowDeployRecord` — interface carrying all deploy-time state (shadowEntries[], patchEntry, backupPath, etc.)
- `estimateTreSize(liveDir)` — sums *.tre bytes in Live/ for pre-flight disk check
- `checkFreeDisk(targetDir, neededBytes)` — T-04-SB-01 guard; throws 'Not enough disk space: need Xmb, have Ymb'
- `deployShadowBase(client, studioDir, patchPath, onProgress?)` — async copy + cfg activation (all four cross-AI review fixes)
- `resetShadow(record, cleanup?)` — R2-W2 line-surgery; removes only the specific keyName= lines inserted
- `diffShadow(client, studioDir)` — UAT helper comparing Live/ vs shadow/ *.tre sets

## Fixes Implemented (all cross-AI review items)

### B4 — Shadow never applied edits (FIXED)
Prior plan: `deployShadowBase(client, studioDir)` copied base TREs but never mounted the
mod patch. The shadow-base mode delivered an unmodified client clone.

Fix: `deployShadowBase(client, studioDir, patchPath)` accepts the already-built patch .tre
(from `packPatch(flatten(activeVersionId))`) and mounts it via `activatePatch` at the HIGHEST
slot (above all shadow TRE entries), so mod edits take effect.

### B7 — Renderer freeze on TRE copy (FIXED)
Prior plan: used `copyFileSync` in a loop over multi-GB TRE files, blocking the renderer main thread.

Fix: all TRE copies use `await fs.promises.copyFile(src, dst)` inside the `async deployShadowBase`
function. Progress callback is invoked between awaits so the UI stays responsive.

### W4 — Incorrect Windows path containment check (FIXED)
Prior plan: used `process.cwd().startsWith(shadowDir)` which is wrong on Windows (case-insensitive
paths, different drive letters, mixed normalization).

Fix: `const relToWorkspace = path.relative(workspaceRoot, shadowDir); if (relToWorkspace.startsWith('..') || path.isAbsolute(relToWorkspace)) throw ...`

### W8 — Orphaned .tmp dir on interrupted copy (FIXED)
Prior plan: no cleanup on copy failure, leaving .tmp dirs in the workspace.

Fix: `catch (e) { if (tmpCreated && fs.existsSync(tmpShadowDir)) fs.rmSync(tmpShadowDir, { recursive: true, force: true }); throw e; }`

### R2-W1 — Slot collision from rescanning toolkit cfg (FIXED)
Prior plan: rescanned `swgtoolkitCfgPath` inside the loop. That cfg lacks retail slots 30-54,
so `chooseSlot` returned slot 1 — below retail priority, silently never loaded.

Fix: `scanSharedFile(client.cfgRootPath)` called ONCE at the top (discovers retail slots 30-54).
`currentScan.occupiedSlots` extended locally after each `activatePatch` call with `record.slot`.

### R2-W2 — Wholesale .bak restore in resetShadow (FIXED)
Prior plan: would have restored `.shadow.bak` wholesale, dropping any keys written after backup
was taken (e.g. patch-prepend keys from the other deploy model).

Fix: `resetShadow` does true line-surgery: collects the exact set of `keyName=` lines it inserted
(`shadowEntries[].keyName` + `patchEntry.keyName`), filters them out via `cfgText.split(/\r?\n/).filter(...)`,
and atomic-writes the result. The `.shadow.bak` is retained as a safety net only.

## Known UAT Item (not a defect — requires in-client verification)

**Absolute paths in searchTree values (UNVERIFIED):**
The cfg entries written by `deployShadowBase` use absolute paths to `.studio/shadow/*.tre`.
Whether `TreeFile.cpp:115-149` accepts absolute paths has NOT been confirmed from ground-truth
source reading. Task 2 (in-client UAT) will surface this as a 'could not open archive' error
in Steps 5-6 if the client rejects them. Gap-closure: copy shadow TREs to a client-relative
subdir and use relative paths instead.

## Deviations from Plan

None — plan executed exactly as written (all four cross-AI fixes are in the implementation;
TypeScript compiles clean; acceptance criteria all pass).

## Threat Surface Scan

No new threat surface beyond what the plan's `<threat_model>` already covers. All four STRIDE
mitigations (T-04-SB-01 through T-04-SB-04) are implemented.

## Task Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | shadowBaseService.ts (B4/B7/W4/W8/R2-W1/R2-W2) | `7a33aed` | packages/renderer/src/services/shadowBaseService.ts |
| 2 | In-client UAT | PENDING CHECKPOINT | — |

## Self-Check: PASSED

- `packages/renderer/src/services/shadowBaseService.ts` exists: FOUND
- Commit `7a33aed`: FOUND (`feat(04-06b): implement shadowBaseService.ts with B4/B7/W4/W8/R2-W1/R2-W2 fixes`)
- `pnpm --filter @swg/renderer exec tsc --noEmit`: exits 0 (clean)
- All acceptance criteria greps: PASS (copyFileSync=1, promises.copyFile=4, scanSharedFile(client.cfgRootPath)=3, banned scan=0, keysToRemove=11, patchEntry=14, path.relative=10, W8=9, clientLocator import=1, live-inject=0, UNVERIFIED=5, async function=1)
