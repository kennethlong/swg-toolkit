---
phase: 04
slug: edit-deploy-loop
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-26
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + native unit assertions; manual in-client UAT for cfg activation |
| **Config file** | per-package `vitest.config.ts` (hoisted vitest; see 03-01 decision) |
| **Quick run command** | `pnpm --filter @swg/renderer test` |
| **Full suite command** | `pnpm -r test` (from repo root) |
| **Estimated runtime** | ~varies (188+ tests today; keep < ~60s) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @swg/renderer test` (if touching renderer) or `pnpm --filter @swg/native-core test` (if touching native-core)
- **After every plan wave:** Run `pnpm -r test` (repo root)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 04-01 T1: Contract types + index exports | 04-01 | 1 | DEPLOY-01..04 | — | types enforce StagingEntry.sha256 presence | unit/compile | `pnpm --filter @swg/contracts build` | ⬜ pending |
| 04-01 T2: Zustand stores | 04-01 | 1 | DEPLOY-01..04 | T-04-01 | discriminated union status prevents stale state reads | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-01 T3: workspaceService (scaffold, .gitignore, pre-commit hook) | 04-01 | 1 | DEPLOY-01..04 | T-04-02, T-04-03 | .gitignore blocks *.tre; pre-commit hook rejects retail bytes; execFile not exec | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` (functional coverage via integration in 04-05 T1) | ⬜ pending |
| 04-02 T1: WorkspaceEntry + ActionBadge + StatusBar extend + WorkspaceShell extend | 04-02 | 2 | DEPLOY-01 | T-04-04 | panel stubs created before dockview registration | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-02 T2: StagingPanel (virtualized ROW_HEIGHT=30, path-traversal rejection) | 04-02 | 2 | DEPLOY-01 | T-04-05, T-04-06 | path-traversal check rejects '../' prefixes inline | compile + manual visual | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-03 T1: patch-shadow.test.ts + packPatch.test.ts (v5000 magic, tombstone) | 04-03 | 2 | DEPLOY-01 | T-04-07, T-04-08 | magic bytes 0x45 0x45 0x52 0x54 0x35 0x30 0x30 0x30 = EERT5000; tombstone length=0 | unit (TDD RED→GREEN) | `pnpm --filter @swg/native-core test` | ⬜ pending |
| 04-03 T2: packPatch.ts + clientLocator.ts (v5000 enforcement, registry probe) | 04-03 | 2 | DEPLOY-01 | T-04-07, T-04-09 | version arg is '5000' literal; path-traversal guard on virtualPath; clientLocator never throws | unit | `pnpm --filter @swg/native-core test` | ⬜ pending |
| 04-03 T3: cfgActivator.ts + cfgScan.test.ts + cfgActivator.test.ts (6 tests) | 04-03 | 2 | DEPLOY-02 | T-04-10, T-04-11, T-04-12 | never writes user.cfg/options.cfg; BOM-free; atomic backup+tmp+rename; ensureInclude idempotent | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-04 T1: changeset.test.ts (6 tests: sealLayer, setActiveVersion, non-destructive rollback) | 04-04 | 2 | DEPLOY-03 | T-04-13, T-04-15 | no array mutation on rollback; atomic write; out-of-bounds guard | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-04 T2: changesetService.ts (sealLayer + setActiveVersion — make tests GREEN) | 04-04 | 2 | DEPLOY-03 | T-04-13, T-04-14, T-04-15 | ZERO rmSync/splice/pop calls; renameSync atomic write; randomUUID for id | unit | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-04 T3: ChangesetTimelinePanel (virtual list, active/rolled-back states, keyboard) | 04-04 | 2 | DEPLOY-03 | — | no confirmation dialog on rollback (D-04-08 — work never lost); aria-label Rule 5 | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-05 T1: gitLfs.test.ts (5 tests) + vcsStore.ts | 04-05 | 2 | DEPLOY-04 | T-04-16, T-04-17, T-04-18, T-04-19 | .gitattributes routes .dds/.png/.msh/.mgn/.ans to LFS; *.tre NOT in LFS (gitignored); pre-commit hook rejects .tre and >50MB | unit (TDD RED→GREEN) | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-05 T2: gitLfsService.ts + VcsPanel.tsx (make tests GREEN) | 04-05 | 2 | DEPLOY-04 | T-04-16, T-04-17, T-04-18, T-04-19 | exec() absent; execFile only; never git add .; empty-paths guard; message sanitized | unit | `pnpm --filter @swg/renderer test` | ⬜ pending |
| 04-06b T1: shadowBaseService.ts — pre-flight disk check + TRE copy + shadow cfg entries | 04-06b | 3 | DEPLOY-02, DEPLOY-01 | T-04-SB-01, T-04-SB-02, T-04-SB-03 | disk-space guard aborts with clear error; shadow dir inside workspace, never git-tracked; cfg entries use confirmed searchTree_<sku>_<NN>= mechanism (TreeFile.cpp:133) | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-06b T2: In-client UAT — shadow TREs load, originals bypassed, reset restores | 04-06b | 3 | DEPLOY-02 | T-04-SB-01, T-04-SB-02 | shadow searchTree slots > originals; reset removes shadow cfg entries; originals intact | manual UAT (checkpoint:human-verify) | _Blocking manual UAT — no automated command_ | ⬜ pending |
| 04-06 T1: DeployDialog.tsx (Sections A/B/C + build/activate/done/fail/reset + deployModel branch) | 04-06 | 4 | DEPLOY-01, DEPLOY-02 | T-04-20, T-04-21, T-04-22, T-04-23 | installPath user-confirmed; activatePatch atomic; deactivatePatch restores on failure; sealLayer('pack') auto-seals; handleDeploy branches on deployModel | compile | `pnpm --filter @swg/renderer exec tsc --noEmit` | ⬜ pending |
| 04-06 T2: In-client UAT — patch loads in SWG Infinity, shadows retail, survives relaunch | 04-06 | 4 | DEPLOY-01, DEPLOY-02 | T-04-20, T-04-21 | patch TRE is v5000; cfg writes swgtoolkit.cfg not user.cfg/options.cfg; .include persists | manual UAT (checkpoint:human-verify) | _Blocking manual UAT — no automated command_ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All wave 0 test scaffolds are embedded in the first task of each plan (TDD RED phase before implementation GREEN):

- [x] 04-01 T1: @swg/contracts compiles — `pnpm --filter @swg/contracts build`
- [x] 04-03 T1: patch-shadow.test.ts + packPatch.test.ts written (RED) before packPatch.ts
- [x] 04-03 T3: cfgScan.test.ts + cfgActivator.test.ts written (RED) before cfgActivator.ts
- [x] 04-04 T1: changeset.test.ts written (RED) before changesetService.ts
- [x] 04-05 T1: gitLfs.test.ts written (RED) before gitLfsService.ts

*Note: DEPLOY-01 patch round-trip + DEPLOY-04 "no retail bytes in git log" are automatable;
DEPLOY-02 (patch actually loads + shadows in a running client, persists across relaunch — OQ-2)
is manual in-client UAT (04-06 Task 2). DEPLOY-02 shadow-base path is manual in-client UAT (04-06b Task 2).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Built patch loads in the running client and shadows retail | DEPLOY-01/02 | Requires a real SWG client process + visual confirmation | Stage one file → build v5000 patch → activate via `.include`d `swgtoolkit.cfg` `[SharedFile]` slot 55 → launch Infinity → confirm the modded asset is in effect |
| `.cfg` insertion persists across launcher relaunch | DEPLOY-02 | Launcher may regenerate cfgs (OQ-2 / Assumption A2) | Relaunch via the official Infinity Launcher; confirm `swgtoolkit.cfg` `.include` + `searchTree_00_55=` survive |
| Shadow-base TREs load in client; originals bypassed; reset restores | DEPLOY-02 | Requires a real client launch + visual confirmation + disk snapshot | Run shadow-base deploy → confirm shadow `searchTree` slots higher than originals → restart client → confirm shadow copies take effect → reset → confirm shadow cfg entries removed + originals intact |
| Non-destructive rollback toggle restores prior client state | DEPLOY-03 | End-to-end visual | Roll active version down in ChangesetTimelinePanel; confirm prior layer shows accent border + rolled-back layers show ↑ glyph + remain clickable |

---

## Key Security Verification Commands

Run these after full wave completion to confirm security posture:

```bash
# D-04-16: No exec() with string interpolation in gitLfsService
grep -c "exec(" packages/renderer/src/services/gitLfsService.ts
# Expected: 0

# D-04-14: *.tre NOT in .gitattributes (gitignored, not LFS-tracked)
grep -c "\.tre.*filter=lfs" packages/renderer/src/services/workspaceService.ts
# Expected: 0

# D-04-08: No destructive deletes in changesetService
grep -c "rmSync\|rmdirSync\|remove_all\|PurgeChangeset\|tar\.gz\|\.splice\|\bpop\b" packages/renderer/src/services/changesetService.ts
# Expected: 0

# cfgActivator never touches user.cfg or options.cfg
grep -c "user\.cfg\|options\.cfg" packages/renderer/src/services/cfgActivator.ts
# Expected: 0 (safety crosscheck — these paths must never appear as write targets)

# packPatch version='5000' not '0005'
grep -c "version.*5000\|5000" packages/renderer/src/services/packPatch.ts
# Expected: 1+

# StagingPanel path-traversal guard
grep -c "\.\./\|traversal\|path-traversal" packages/renderer/src/panels/deploy/StagingPanel.tsx
# Expected: 1+

# shadowBaseService: shadow dir must be inside workspace (never user home or system path)
grep -c "\.studio/shadow\|studioDir.*shadow\|shadowDir" packages/renderer/src/services/shadowBaseService.ts
# Expected: 1+

# handleDeploy branches on deployModel (D-04-10)
grep -c "deployModel.*shadow-base\|shadow-base.*deployModel\|deployShadowBase" packages/renderer/src/panels/deploy/DeployDialog.tsx
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

**Approval:** planner-signed 2026-06-26 (revised: W7 — corrected 04-03 T1/T2 automated commands to @swg/native-core; added 04-06b rows; updated wave numbers)
