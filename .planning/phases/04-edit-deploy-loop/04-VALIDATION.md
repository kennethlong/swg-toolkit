---
phase: 04
slug: edit-deploy-loop
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-26
revised: 2026-06-26
revision_reason: "MAJOR revision — B1..B8 + W1..W10 + N1..N5 fixes; graph model (04-04 REWRITE); 04-04b NEW (ChangesetTimelinePanel); B5 fix (renderer test script); updated test counts"
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + native unit assertions; manual in-client UAT for cfg activation |
| **Config file** | per-package `vitest.config.ts` (hoisted vitest; see 03-01 decision) |
| **Quick run (renderer)** | `pnpm --filter @swg/renderer test` |
| **Quick run (native-core)** | `pnpm --filter @swg/native-core test` |
| **Full suite command** | `pnpm -r test` (from repo root) |
| **B5 fix note** | `packages/renderer/package.json` now has `"test": "vitest run"` (added in 04-01 T2); renderer tests run as part of the full suite |
| **Estimated runtime** | ~varies (188+ tests today; keep < ~60s) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @swg/renderer test` (touching renderer) or `pnpm --filter @swg/native-core test` (touching native-core)
- **After every plan wave:** Run `pnpm -r test` (repo root)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 04-01 T1: Contract types (FileDelta, SwgChangeset with parentId, WorkspaceChangesetManifest with activeVersionId/deployedVersionId, StagingEntry) | 04-01 | 1 | DEPLOY-01..04 | — | types enforce StagingEntry.sha256 presence; parentId enables graph branching; no PurgeChangeset | unit/compile | `pnpm --filter @swg/contracts build` | ⬜ pending |
| 04-01 T2: Zustand stores (string-based activeVersionId/deployedVersionId, restoreEntries, hasStaleDeployment) | 04-01 | 1 | DEPLOY-01..04 | T-04-01 | string IDs replace numeric index; setActiveVersion(string|null); setDeployedVersion(string|null) | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-01 T3: workspaceService (scaffold, .gitignore, pre-commit hook, N1/N3/W4/W5/W6 fixes) | 04-01 | 1 | DEPLOY-01..04 | T-04-02, T-04-03 | N1: `while IFS= read -r` in hook; N3: *.iff *.tga *.wav *.ogg in .gitattributes; W4: path.relative containment; W5: hook append-not-overwrite with swgtoolkit-retail-guard boundary; W6: check git-lfs before writing LFS lines | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` (functional coverage via integration in 04-05 T1) | ⬜ pending |
| 04-02 T1: WorkspaceEntry + ActionBadge + StatusBar (W7 stale badge, W10 deployedVersionId) + workspace-config.ts (W3: addPanel in buildInitialLayout) | 04-02 | 2 | DEPLOY-01 | T-04-04 | W1: button styles defined locally (no ExportDialog import); W3: wiring via workspace-config.ts not WorkspaceShell.tsx; W7: ⚠ badge uses hasStaleDeployment | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-02 T2: StagingPanel (virtualized ROW_HEIGHT=30, local button styles W1) | 04-02 | 2 | DEPLOY-01 | T-04-05, T-04-06 | path-traversal check rejects '../' prefixes inline; W1: no imported ExportDialog button styles | compile + manual visual | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-03 T1: packPatch.test.ts (v5000 magic, tombstone, determinism) + patch-shadow.test.ts (shadow/modify resolution) | 04-03 | 2 | DEPLOY-01 | T-04-09, T-04-10 | magic bytes 0x45 0x45 0x52 0x54 0x35 0x30 0x30 0x30 = EERT5000; tombstone uncompressedSize=0; canonical sort → byte-identical re-deploy | unit (TDD RED→GREEN) | `pnpm --filter @swg/native-core test` | ⬜ pending |
| 04-03 T2: packPatch.ts (buildPatchName B6+N2, canonical sort D-04-08a, atomic write) + clientLocator.ts (B1 full-chain scan, LAST-wins maxSearchPriority N5) | 04-03 | 2 | DEPLOY-01 | T-04-09, T-04-10, T-04-11, T-04-12 | version arg is '5000' literal; path-traversal guard on virtualPath; B6: sanitized patchName with UUID; N5: LAST-wins comment; clientLocator never throws; LAST-wins maxSearchPriority | unit | `pnpm --filter @swg/native-core test` | ⬜ pending |
| 04-03 T3: cfgActivator.ts (re-exports clientLocator; W9 deactivatePatch line-surgery) + cfgScan.test.ts (5 tests: multi-include chain B1, LAST-wins N5) + cfgActivator.test.ts (4 tests: W9 coexistence test) | 04-03 | 2 | DEPLOY-02 | T-04-10, T-04-11, T-04-12 | never writes user.cfg/options.cfg; BOM-free; atomic backup+tmp+rename; ensureInclude idempotent; W9: deactivatePatch removes ONLY its keyName= line via regex line-surgery (never restores .bak) | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-04 T1: changeset.test.ts (7 tests: sealVersion linear, flatten chain, selectVersion materializes staging B2, branching after rollback B3, empty/dup guard N4) | 04-04 | 2 | DEPLOY-03 | T-04-13, T-04-14, T-04-15, T-04-16 | sealVersion with parentId=activeVersionId creates branch; flatten = path-walk last-writer-wins NOT cumulative; selectVersion restores stagingStore entries (B2 fix); N4 dup guard; no rmSync/splice/pop | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-04 T2: changesetService.ts (flatten, sealVersion, selectVersion, setDeployedVersion — make 7 tests GREEN) | 04-04 | 2 | DEPLOY-03 | T-04-13, T-04-14, T-04-15, T-04-16 | ZERO rmSync/splice/pop/PurgeChangeset; renameSync atomic writeManifest; parentId branching; selectVersion materializes staging (B2); N4 flatEqual guard | unit | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-04b T1: ChangesetTimelinePanel.test.tsx (5 tests: node rendering, active pip, deployed pip, stale badge, branch-node marker) | 04-04b | 3 | DEPLOY-03 | T-04-17 | active-version-node class; deployed-version-node class; stale-deploy-warning when active≠deployed; branch-node data attribute; click → selectVersion(id) | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-04b T2: ChangesetTimelinePanel.tsx — graph visualization (branch divergence, pips, stale badge, selectVersion wiring) | 04-04b | 3 | DEPLOY-03 | T-04-17, T-04-18 | zero flatten/parentId walking in component; selectVersion from changesetService; branch-node marker for branch-start nodes; two distinct pip classes for active vs deployed | unit | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-05 T1: gitLfs.test.ts (6 tests incl B8 non-vacuous LFS pointer test + N3 *.iff *.tga *.wav *.ogg assertions) + vcsStore.ts | 04-05 | 2 | DEPLOY-04 | T-04-23, T-04-24, T-04-25, T-04-26 | B8: .dds binary staged → committed → cat-file blob contains LFS pointer header; N3: *.iff *.tga *.wav *.ogg in .gitattributes; *.tre NOT LFS-tracked (gitignored); pre-commit hook rejects .tre and >50MB | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-05 T2: gitLfsService.ts + VcsPanel.tsx (make 6 tests GREEN, exec() absent, no git add .) | 04-05 | 2 | DEPLOY-04 | T-04-23, T-04-24, T-04-25, T-04-26 | exec() absent (0 occurrences); execFile only; never git add .; empty-paths guard; message sanitized; VcsPanel textarea uses --color-bg | unit | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-06b T1: shadowBaseService.ts — async copy (B7), patchPath param at highest slot (B4), W4 path.relative containment, W8 .tmp cleanup on error | 04-06b | 3 | DEPLOY-02, DEPLOY-01 | T-04-SB-01..T-04-SB-05 | B4: patchPath → activatePatch at highest slot so mod edits load; B7: fs.promises.copyFile async; W4: path.relative not process.cwd().startsWith(); W8: catch block rmSync tmpShadowDir; disk-space guard; shadow dir inside workspace | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-06b T2: In-client UAT — shadow TREs load + mod edits visible (B4) + renderer responsive (B7) + reset restores | 04-06b | 3 | DEPLOY-02 | T-04-SB-01, T-04-SB-02 | shadow searchTree slots > originals; B4: mod edits visible in-game (patch at highest slot); B7: renderer stays responsive during multi-GB copy; reset removes shadow cfg entries; originals intact | manual UAT (checkpoint:human-verify) | _Blocking manual UAT — no automated command_ | ⬜ pending |
| 04-06 T1: DeployDialog.tsx — W2 (flatten not stagingStore), W7 (stale banner), W9 (deployingRef mutex), B1 propagation (scanSharedFile cfgRootPath), B6 (buildPatchName), setDeployedVersion after deploy | 04-06 | 4 | DEPLOY-01, DEPLOY-02 | T-04-30..T-04-34 | W2: packPatch receives flatten() output; W7: stale banner renders when active≠deployed; W9: deployingRef+disabled button prevent concurrent deploy; B1: scanSharedFile(cfgRootPath) not swgtoolkitCfgPath; B6: buildPatchName no raw concatenation | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-06 T2: In-client UAT — slot 55 (B1), patchName no spaces (B6), mod visible (B4 propagation), stale banner (W7), reset clean | 04-06 | 4 | DEPLOY-01, DEPLOY-02 | T-04-30, T-04-31 | patch at slot 55 not slot 1; patchName has UUID fragment no spaces; mod edits visible in-game; stale banner appears when active≠deployed; reset removes cfg key and patch .tre | manual UAT (checkpoint:human-verify) | _Blocking manual UAT — no automated command_ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All wave 0 test scaffolds are embedded in the first task of each plan (TDD RED phase before implementation GREEN):

- [x] 04-01 T1: @swg/contracts compiles — `pnpm --filter @swg/contracts build`
- [x] 04-03 T1: packPatch.test.ts + patch-shadow.test.ts written (RED) before packPatch.ts
- [x] 04-03 T3: cfgScan.test.ts (5 tests) + cfgActivator.test.ts (4 tests) written (RED) before cfgActivator.ts
- [x] 04-04 T1: changeset.test.ts (7 tests) written (RED) before changesetService.ts
- [x] 04-04b T1: ChangesetTimelinePanel.test.tsx (5 tests) written (RED) before ChangesetTimelinePanel.tsx
- [x] 04-05 T1: gitLfs.test.ts (6 tests incl B8 LFS pointer) written (RED) before gitLfsService.ts

*Note: DEPLOY-01 patch round-trip + DEPLOY-04 LFS tracking are automatable;
DEPLOY-02 (patch actually loads + shadows in a running client, persists across relaunch — OQ-2)
is manual in-client UAT (04-06 Task 2). DEPLOY-02 shadow-base path + B4 (mod edits visible) is manual in-client UAT (04-06b Task 2).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Built patch loads in the running client and shadows retail (patch-prepend) | DEPLOY-01/02 | Requires a real SWG client process + visual confirmation | Stage one file → flatten(activeVersionId) → build v5000 patch with buildPatchName → activate via `.include`d `swgtoolkit.cfg` `[SharedFile]` slot 55 → launch Infinity → confirm the modded asset is in effect |
| `.cfg` insertion persists across launcher relaunch | DEPLOY-02 | Launcher may regenerate cfgs (OQ-2 / Assumption A2) | Relaunch via the official Infinity Launcher; confirm `swgtoolkit.cfg` `.include` + `searchTree_00_55=` survive |
| Shadow-base: mod edits visible (B4 fix), renderer responsive during copy (B7 fix), reset restores | DEPLOY-02 | Requires a real client launch + visual confirmation + multi-GB disk copy | Run shadow-base deploy with a sealed version containing mod edits → confirm shadow `searchTree` slots higher than originals → AND patch slot highest of all → restart client → confirm shadow copies AND mod edits are in effect (B4) → confirm renderer stayed responsive during copy (B7) → reset → confirm shadow cfg entries removed + originals intact |
| Stale-deployment banner appears when active≠deployed (W7 UAT) | DEPLOY-03 | UI-level verification | Stage a file without deploying → re-open DeployDialog → confirm stale-deployment warning banner is present |
| Non-destructive selectVersion restores staging AND shows branch pips (B2/B3 UAT) | DEPLOY-03 | End-to-end visual | Roll active version down in ChangesetTimelinePanel; confirm staged entries change to match flatten() of the selected version; confirm branch-node marker visible for branched nodes |

---

## Key Security Verification Commands

Run these after full wave completion to confirm security posture:

```bash
# D-04-16: No exec() with string interpolation in gitLfsService
grep -c "\bexec\s*(" packages/renderer/src/services/gitLfsService.ts
# Expected: 0

# W9 fix: deactivatePatch does NOT restore from .bak (line-surgery only)
grep -c "copyFileSync.*bak.*cfgPath\|bak.*→.*cfgPath\|restoring.*bak" packages/renderer/src/services/cfgActivator.ts
# Expected: 0

# B1 fix: scanSharedFile walks .include chain (recursive)
grep -c "processFile\|\.include\|visited.*Set" packages/renderer/src/services/clientLocator.ts
# Expected: 3+

# N5: LAST-wins comment in clientLocator
grep -c "LAST.*wins\|last.*wins\|ConfigFile.*797" packages/renderer/src/services/clientLocator.ts
# Expected: 1+

# D-04-14: *.tre NOT in .gitattributes (gitignored, not LFS-tracked)
grep -v "^#" packages/renderer/src/services/workspaceService.ts | grep -c "\.tre.*filter=lfs"
# Expected: 0

# D-04-08: No destructive deletes in changesetService (append-only history)
grep -c "rmSync\|rmdirSync\|remove_all\|PurgeChangeset\|tar\.gz\|\.splice\|\bpop\b" packages/renderer/src/services/changesetService.ts
# Expected: 0

# cfgActivator never touches user.cfg or options.cfg
grep -c "user\.cfg\|options\.cfg" packages/renderer/src/services/cfgActivator.ts
# Expected: 0

# packPatch version='5000' not '0005'
grep -v "^#\|comment\|//.*5000\|Wrong" packages/renderer/src/services/packPatch.ts | grep -c "5000"
# Expected: 1+

# B6+N2: buildPatchName sanitizes + UUID fragment
grep -c "replace.*\[.*a-zA-Z0-9_-\]\|randomUUID\|uuid.*slice" packages/renderer/src/services/packPatch.ts
# Expected: 2+

# B7 fix: no sync copyFileSync in the TRE copy loop of shadowBaseService
grep -c "promises\.copyFile\|await.*copyFile" packages/renderer/src/services/shadowBaseService.ts
# Expected: 1+

# W4 fix: path.relative containment check (not process.cwd().startsWith)
grep -c "path\.relative\|relToWorkspace" packages/renderer/src/services/shadowBaseService.ts
# Expected: 2+

# W2 fix: DeployDialog uses flatten() not stagingStore.entries directly for packPatch
grep -c "packPatch(flattenedEntries\|packPatch.*flatten" packages/renderer/src/panels/deploy/DeployDialog.tsx
# Expected: 1+

# W9 fix: deploy mutex in DeployDialog
grep -c "deployingRef" packages/renderer/src/panels/deploy/DeployDialog.tsx
# Expected: 3+

# B1 propagation: DeployDialog uses cfgRootPath for scan (not swgtoolkitCfgPath)
grep -c "scanSharedFile.*cfgRootPath" packages/renderer/src/panels/deploy/DeployDialog.tsx
# Expected: 1+
```

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or manual UAT designation
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (TDD tasks are first in each plan)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (pnpm --filter @swg/renderer test targets < 60s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-signed 2026-06-26 (revised: MAJOR — B1..B8 + W1..W10 + N1..N5 fixes; graph model 04-04 rewrite; 04-04b NEW ChangesetTimelinePanel; B5 renderer test command fixed; all task rows updated for revised plans)
