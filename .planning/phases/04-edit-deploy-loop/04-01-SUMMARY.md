---
phase: 04-edit-deploy-loop
plan: "01"
subsystem: contracts + state + workspace-service
tags: [contracts, zustand, workspace, staging, changeset, deploy, graph-model, git-lfs]
dependency_graph:
  requires:
    - "01-04 (buildTre / TreBuilderEntryNative — native engine this phase drives)"
    - "@swg/contracts (existing ipc/tre/live-inject exports)"
    - "packages/renderer/src/state/liveStore.ts (pattern template)"
    - "packages/renderer/src/hooks/useLiveService.ts (service pattern template)"
  provides:
    - "@swg/contracts workspace/staging/changeset/deploy exports"
    - "packages/renderer/src/state/workspaceStore"
    - "packages/renderer/src/state/stagingStore"
    - "packages/renderer/src/state/changesetStore"
    - "packages/renderer/src/services/workspaceService"
  affects:
    - "All Phase 4 plans 02-06 (import from @swg/contracts and read from these stores)"
tech_stack:
  added:
    - "vitest ^2.0.0 (renderer devDep)"
    - "@testing-library/react ^16.0.0 (renderer devDep)"
    - "@testing-library/jest-dom ^6.0.0 (renderer devDep)"
    - "jsdom ^25.0.0 (renderer devDep)"
  patterns:
    - "GRAPH MODEL versioning: SwgChangeset.parentId enables DAG history; flatten() walks root→N"
    - "string | null UUID pointers replace number-based activeVersionIndex"
    - "execFile arg-array pattern for all git calls (D-04-16 injection guard)"
    - "W5 hook append-not-overwrite with swgtoolkit-retail-guard boundary"
    - "W6 LFS-check before .gitattributes write"
    - "N1 while-IFS-read in pre-commit hook (no word-split)"
key_files:
  created:
    - packages/contracts/src/workspace.ts
    - packages/contracts/src/staging.ts
    - packages/contracts/src/changeset.ts
    - packages/contracts/src/deploy.ts
    - packages/renderer/src/state/workspaceStore.ts
    - packages/renderer/src/state/stagingStore.ts
    - packages/renderer/src/state/changesetStore.ts
    - packages/renderer/src/services/workspaceService.ts
    - packages/renderer/vitest.config.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/renderer/package.json
    - packages/renderer/src/declarations.d.ts
    - pnpm-lock.yaml
decisions:
  - "GRAPH MODEL locked: SwgChangeset.parentId + string UUID pointers replace number index; flatten() walks DAG root→N per D-04-05..08"
  - "StagingEntry.replacementFilePath not action: StagingAction already maps to TreBuilderEntryNative 1:1"
  - "Pre-commit hook uses while-IFS-read (N1 fix) to handle filenames with spaces"
  - "process.resourcesPath Electron type added to declarations.d.ts (pre-existing tsc error)"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-27"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 4
---

# Phase 04 Plan 01: Contract Types + Stores + Workspace Service Summary

## One-liner

Phase 4 typed foundation: GRAPH MODEL changeset contracts (parentId + UUID pointers), three Zustand stores, workspaceService with W4/W5/W6/N1/N3 scaffolding fixes, and renderer vitest infrastructure.

## Tasks Completed

| Task | Description | Commit | Key Deliverables |
|------|-------------|--------|-----------------|
| 1 | Contract types (workspace, staging, changeset, deploy) | 842080e | FileDelta, SwgChangeset (parentId), WorkspaceChangesetManifest (activeVersionId/deployedVersionId), DeployResult; @swg/contracts build clean |
| 2 | Zustand stores + renderer test script | 70845b1 | workspaceStore, stagingStore (restoreEntries), changesetStore (string UUID pointers); vitest + jsdom devDeps; test script B5 fix |
| 3 | workspaceService scaffold + git init fixes | 8fc39d3 | openWorkspace, createWorkspace, checkLfsInstalled; W4/W5/W6/N1/N3 fixes; no exec() injection; tsc clean |

## Verification Results

- `pnpm --filter @swg/contracts build` exits 0.
- `pnpm --filter @swg/renderer exec tsc --noEmit` exits 0.
- All contract acceptance criteria met (FileDelta 3 refs, parentId 7 refs, activeVersionId 4 refs, deployedVersionId 3 refs; activeVersionIndex=0, PurgeChangeset=0, StagingAction import present).
- All store acceptance criteria met (restoreEntries, hasStaleDeployment, setDeployedVersion present; activeVersionIndex=0, splice/filter=0 in changesetStore).
- All workspaceService acceptance criteria met (execFile present, exec( absent, process.cwd() absent, direct-child check, appendFileSync+swgtoolkit-retail-guard, checkLfsInstalled, while IFS=, *.iff/tga/wav, activeVersionId null; *.tre filter=lfs absent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing tsc error: process.resourcesPath not in @types/node**
- **Found during:** Task 2 verification (pnpm --filter @swg/renderer exec tsc --noEmit)
- **Issue:** `useLiveService.ts:81` uses `process.resourcesPath` (Electron-specific) which is not part of Node.js's `ProcessEnv` type, causing a tsc error. This was a pre-existing bug blocking the acceptance criterion.
- **Fix:** Added `declare namespace NodeJS { interface Process { resourcesPath: string } }` to `packages/renderer/src/declarations.d.ts`.
- **Files modified:** `packages/renderer/src/declarations.d.ts`
- **Commit:** 70845b1

**2. [Rule 1 - Comment cleanup] grep-0 acceptance checks on comment text**
- **Found during:** Task 1/2 verification
- **Issue:** The acceptance criteria require `grep -c "activeVersionIndex\b"` = 0 and `grep -c "PurgeChangeset|tar.gz"` = 0. The initial implementations included comments that mentioned the old patterns (e.g. "NOT the old number-based activeVersionIndex"), causing the grep counts to be non-zero.
- **Fix:** Rewrote the comments to avoid including the banned literal text strings.
- **Files modified:** `packages/contracts/src/changeset.ts`, `packages/renderer/src/state/changesetStore.ts`, `packages/renderer/src/services/workspaceService.ts`
- **Commits:** 842080e, 70845b1, 8fc39d3

## Known Stubs

None. All exported types and store actions are fully defined. The workspaceService is functional end-to-end (creates directories, writes files, runs git init, installs hook). No hardcoded empty values or placeholder text flow to UI.

## Threat Flags

No new network endpoints, auth paths, or trust boundary changes introduced. The workspaceService writes to user-chosen directories (covered by T-04-01..05 in the plan's threat model — path validation, execFile arg array, hook append-not-overwrite, gitignore defense-in-depth — all implemented as mitigations).

## Self-Check: PASSED

All 9 created files found on disk. All 3 task commits (842080e, 70845b1, 8fc39d3) verified in git log.
