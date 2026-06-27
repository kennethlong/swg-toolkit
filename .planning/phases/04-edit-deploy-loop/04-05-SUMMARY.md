---
phase: 04-edit-deploy-loop
plan: "05"
subsystem: git-lfs-vcs
tags: [git, lfs, vcs, security, tdd, deploy]
dependency_graph:
  requires: [04-01]
  provides: [DEPLOY-04]
  affects: [04-06, 04-06b]
tech_stack:
  added: []
  patterns: [zustand-store, execFile-arg-arrays, tdd-red-green, pre-commit-hook, lfs-pointer-filter]
key_files:
  created:
    - packages/renderer/src/state/vcsStore.ts
    - packages/renderer/test/gitLfs.test.ts
    - packages/renderer/src/services/gitLfsService.ts
    - packages/renderer/src/panels/deploy/VcsPanel.tsx
  modified: []
decisions:
  - "execFile with argument arrays only — exec() with string interpolation is banned (D-04-16, T-04-23)"
  - "probeLfsStatus added to gitLfsService so VcsPanel never calls child_process directly"
  - "*.tre is gitignored NOT LFS-tracked; LFS routes *.dds *.png *.msh *.mgn *.ans *.iff *.tga *.wav *.ogg (N3)"
  - "gitCommit validates stagePaths (no absolute, no ..), sanitizes message (T-04-23/24)"
  - "VcsPanel textarea uses var(--color-bg) not var(--color-input) which is an undefined token (W3)"
metrics:
  duration: "~35 minutes"
  completed: "2026-06-27T04:34:44Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 0
---

# Phase 04 Plan 05: Git/LFS Integration (DEPLOY-04) Summary

Git/LFS integration for the mod workspace: execFile-based git shell-outs, LFS pointer routing for mod-output binaries, pre-commit retail-bytes guard, Zustand VCS store, and a dockable VCS panel.

## What Was Built

**vcsStore.ts** — Zustand store for VCS panel state: `CommitStatus` (idle/committing/done/error), `LfsStatus` (unknown/present/absent), `GuardResult` (null/pass/fail-with-file), `LogEntry[]` log feed. Eight actions mirroring `liveStore.ts` pattern exactly.

**gitLfs.test.ts** — 6 integration tests spawning a real temp git repo via `createWorkspace()`:
- Test 1: `.gitignore` contains `*.tre`, `extracted_vanilla_base/`, `.studio/shadow/`, `.studio/build/`
- Test 2: `.gitattributes` has N3 patterns (`*.iff *.tga *.wav *.ogg *.dds *.msh *.mgn *.ans`) and `*.tre` is NOT LFS-tracked
- Test 3: `gitCommit` stages text files, `git log` shows at least one commit
- Test 3b (B8 fix): real `.dds` binary staged via `git add` → LFS filter converts to pointer → `git cat-file blob HEAD:test.dds` asserts `version https://git-lfs.github.com/spec/v1` (was previously vacuous — no binary was ever staged)
- Test 4: `.tre` file force-added, commit rejected by pre-commit hook (non-zero exit)
- Test 5: 55 MB file staged, commit rejected by size guard (non-zero exit)

**gitLfsService.ts** — All git shell-outs via `execFile` with argument arrays (`exec()` banned per D-04-16). Exports: `checkLfsInstalled`, `initLfsTracking` (`git lfs install --local`), `gitCommit` (explicit-path staging + message sanitization + path validation), `gitPush`, `refreshLog`, `getGuardStatus` (app-side defense-in-depth mirror of the pre-commit hook), `probeLfsStatus` (runs `git lfs version` + `git lfs ls-files` → updates vcsStore).

**VcsPanel.tsx** — Dockable panel with: LFS status banner, pre-commit guard result surface, commit message `textarea` using `var(--color-bg)`, commit/push buttons, recent log feed. All git I/O through gitLfsService (panel never calls child_process directly).

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | `66f4f9b` | `test(04-05): add failing gitLfs integration tests + vcsStore` |
| GREEN (feat) | `4d92a21` | `feat(04-05): gitLfsService + VcsPanel — DEPLOY-04 Git/LFS integration` |
| REFACTOR (fix) | `95fbaa5` | `fix(04-05): move LFS probe into gitLfsService (VcsPanel must not call child_process)` |

## Security Posture (Threat Model)

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-04-23 (commit message injection) | `sanitizeMessage()` strips null+control chars; message is a discrete `execFile` argv element |
| T-04-24 (stagePaths escape) | `validateStagePaths()` rejects absolute paths and `..`-prefixed paths |
| T-04-25 (retail bytes committed) | `.gitignore` `*.tre`; `getGuardStatus` checks staged set; pre-commit hook; explicit-path staging only |
| T-04-26 (large binary bloat) | Pre-commit hook size guard >50 MB; `getGuardStatus` mirrors the check at app level |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] VcsPanel must not call child_process directly**

- **Found during:** Task 2 implementation review
- **Issue:** Initial VcsPanel implementation used `import('child_process')` inline in `useEffect` to get the LFS version string. The plan spec states "VcsPanel never directly calls child_process."
- **Fix:** Added `probeLfsStatus(repoPath)` to `gitLfsService.ts` which runs `git lfs version` and `git lfs ls-files` and updates `vcsStore.setLfsStatus`. VcsPanel now calls `probeLfsStatus(folderPath)` only.
- **Files modified:** `gitLfsService.ts`, `VcsPanel.tsx`
- **Commit:** `95fbaa5`

**2. [Rule 2 - Missing Critical Functionality] git lfs install --local needed in test beforeAll**

- **Issue:** `createWorkspace()` writes `.gitattributes` with `filter=lfs` directives but does NOT run `git lfs install --local`. Without this, the LFS filter hooks are not configured in the repo's local git config, so `git add *.dds` would NOT convert the binary to an LFS pointer (Test 3b would fail vacuously).
- **Fix:** Added `execFileSync('git', ['-C', TMP, 'lfs', 'install', '--local'])` in `beforeAll` of `gitLfs.test.ts` after `createWorkspace`. Also added git identity config (`user.email`, `user.name`) required for commits in environments without global config.
- **Files modified:** `gitLfs.test.ts`
- **Commit:** `66f4f9b`

## Known Stubs

None. All exported functions have real implementations. The `placeholder="Describe this changeset…"` in VcsPanel is standard HTML placeholder text, not a data stub.

## Threat Flags

No new trust boundaries beyond those in the plan's threat model. The `probeLfsStatus` function is an additional git call (all via execFile, hardcoded arg array `['lfs', 'version']` and `['lfs', 'ls-files']`), not a new injection surface.

## Self-Check: PASSED

Files exist:
- `packages/renderer/src/state/vcsStore.ts` — FOUND
- `packages/renderer/test/gitLfs.test.ts` — FOUND
- `packages/renderer/src/services/gitLfsService.ts` — FOUND
- `packages/renderer/src/panels/deploy/VcsPanel.tsx` — FOUND

Commits exist:
- `66f4f9b` (RED) — FOUND
- `4d92a21` (GREEN) — FOUND
- `95fbaa5` (REFACTOR/fix) — FOUND

Tests: 6/6 PASSED (`pnpm --filter @swg/renderer test`)
TypeScript: `pnpm --filter @swg/renderer exec tsc --noEmit` exits 0
