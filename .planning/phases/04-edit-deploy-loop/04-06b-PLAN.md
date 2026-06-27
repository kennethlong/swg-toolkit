---
phase: 04-edit-deploy-loop
plan: "06b"
type: execute
wave: 3
depends_on:
  - 04-01
  - 04-03
  - 04-04
files_modified:
  - packages/renderer/src/services/shadowBaseService.ts
autonomous: false
requirements:
  - DEPLOY-02
  - DEPLOY-01

must_haves:
  truths:
    - "deployShadowBase() copies each TRE from client.installPath/Live/ to .studio/shadow/ using fs.promises.copyFile (async — B7: never freezes the renderer); aborts with 'Not enough disk space: need Xmb, have Ymb' if insufficient space."
    - "B4 fix: deployShadowBase accepts a patchPath parameter (path to the built patch .tre from packPatch); after writing shadow TRE entries, mounts the patch at the HIGHEST slot over all shadow entries so mod edits take effect in the client (the prior plan only copied base TREs and never applied edits)."
    - "W4 fix: containment check uses path.relative(studioDir, shadowDir).startsWith('..') === false (NOT process.cwd().startsWith() which is incorrect for Windows absolute paths)."
    - "W8 fix: if deployShadowBase fails mid-copy, the .tmp shadow dir is cleaned up in the catch block (no orphaned partial dirs left in the workspace)."
    - "Shadow cfg entries AND the patch entry are written as searchTree_<sku>_<NN>= into swgtoolkit.cfg at slots above the originals, using the searchTree_<sku>_<NN>= mechanism from TreeFile.cpp:133."
    - "resetShadow(record) does line-surgery to remove shadow searchTree entries AND the patch entry from swgtoolkit.cfg (W9 principle extended to shadow cleanup)."
    - ".studio/shadow/ is already in .gitignore (workspaceService 04-01 T3); deployShadowBase verifies this defensively before copying."
  artifacts:
    - path: packages/renderer/src/services/shadowBaseService.ts
      provides: "deployShadowBase (B4: accepts patchPath, mounts patch at highest slot; B7: async copyFile; W4: correct containment check; W8: .tmp cleanup on error), resetShadow, estimateTreSize, checkFreeDisk"
      exports:
        - deployShadowBase
        - resetShadow
        - estimateTreSize
        - checkFreeDisk
  key_links:
    - from: packages/renderer/src/services/shadowBaseService.ts
      to: packages/renderer/src/services/cfgActivator.ts
      via: "activatePatch(swgtoolkitCfgPath, shadowTreName, scan) for each shadow TRE; then activatePatch again for patchPath (B4)"
      pattern: "activatePatch"
    - from: packages/renderer/src/services/shadowBaseService.ts
      to: packages/renderer/src/services/clientLocator.ts
      via: "scanSharedFile(client.cfgRootPath) — FULL CHAIN; chooseSlot(scan) per shadow TRE + patch slot"
      pattern: "scanSharedFile|chooseSlot"
    - from: ".studio/shadow/"
      to: client.installPath/Live/
      via: "shadow TREs are copies; originals remain at full retail path; resetShadow removes shadow cfg entries via line-surgery"
      pattern: "shadow"
---

## Phase Goal

**As a** SWG mod developer, **I want to** stage edited files in a project workspace and build a deployable `.tre` patch that activates via the client config, **so that** I can iterate on mod changes in-game, roll back to any prior state, and version my work safely via Git/LFS.

<objective>
Implement the shadow-base deploy model backend (D-04-10) with all cross-AI review fixes applied.

Revision from cross-AI review:
- B4 fix: deployShadowBase now accepts a `patchPath: string` parameter (the packPatch output built from `flatten(activeVersionId)`). After writing all shadow base TRE entries, it mounts the patch .tre at the highest slot (above all shadow slots), so mod edits take effect. Without this, the shadow-base model only cloned the retail base with zero mod changes applied — the user's edits never loaded in the client.
- B7 fix: copyFileSync is replaced with await fs.promises.copyFile throughout, so the multi-GB TRE copy never blocks the renderer main thread.
- W4 fix: containment check uses path.relative(base, target).startsWith('..') === false instead of the incorrect process.cwd().startsWith() which breaks on Windows absolute paths with different drive letters or mixed-case paths.
- W8 fix: the catch block in deployShadowBase runs rmSync(tmpShadowDir, {recursive:true, force:true}) to clean up any orphaned .tmp dirs left by an interrupted copy.

Output: shadowBaseService.ts (all four fixes); manual UAT checkpoint that shadow TREs + patch load in the client, mod edits visible, reset restores originals-only cfg.
</objective>

<execution_context>
@D:\Code\SWG-Toolkit\.claude\get-shit-done\workflows\execute-plan.md
@D:\Code\SWG-Toolkit\.claude\get-shit-done\templates\summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/04-edit-deploy-loop/04-CONTEXT.md
@.planning/phases/04-edit-deploy-loop/04-RESEARCH.md
@.planning/phases/04-edit-deploy-loop/04-01-SUMMARY.md
@.planning/phases/04-edit-deploy-loop/04-03-SUMMARY.md
@.planning/phases/04-edit-deploy-loop/04-04-SUMMARY.md

<interfaces>
<!-- clientLocator — canonical source of SharedFileScan + helpers (04-03) -->
import { scanSharedFile, chooseSlot, SharedFileScan } from './clientLocator';
// scanSharedFile MUST be called with client.cfgRootPath (swgemu.cfg — the FULL chain root)
// NOT with swgtoolkit.cfg alone — that was B1's bug. The B1 fix is in clientLocator (04-03),
// but the caller here must pass the right root cfg.

<!-- cfgActivator — re-exports from clientLocator; provides activatePatch, deactivatePatch (04-03) -->
import { activatePatch, deactivatePatch } from './cfgActivator';
// activatePatch(cfgPath, patchName, scan) → CfgInsertionRecord
// deactivatePatch(record) → void (line-surgery — W9 from 04-03)

<!-- DetectedClient — from @swg/contracts (04-01 T1) -->
interface DetectedClient {
  name: string;
  installPath: string;
  cfgRootPath: string;  // path to swgemu.cfg (chain root)
  treVersion: string;
}

<!-- ShadowDeployRecord — extended for B4 (patchEntry field) -->
interface ShadowDeployRecord {
  shadowDir: string;
  cfgPath: string;
  includeTargetPath: string;
  shadowEntries: Array<{ keyName: string; slot: number; shadowTrePath: string; originalTreName: string }>;
  patchEntry: { keyName: string; slot: number; patchPath: string };  // B4: the patch slot above shadow TREs
  originalLiveDir: string;
  backupPath: string;
}

<!-- B4 fix: why the prior plan had zero edit coverage -->
// Prior plan: deployShadowBase(client, studioDir, workspaceName) → copies TREs → writes shadow slots
//   → client sees originals via shadow → ZERO mod edits applied (patch never mounted).
// B4 fix: deployShadowBase(..., patchPath: string) → after all shadow slots, mount patchPath
//   at slot = chooseSlot(scan) AFTER all shadow entries (highest priority).
// This mirrors how cfgActivator.activatePatch works: one more entry at the next free slot.
// The patch.tre was built via packPatch(flatten(activeVersionId)) before calling deployShadowBase.
// DeployDialog (04-06) is responsible for: flatten(activeVersionId) → packPatch → call deployShadowBase(…, builtPatchPath).

<!-- B7 fix: sync copy blocks renderer -->
// BANNED: fs.copyFileSync(src, dst) in a TRE copy loop — blocks renderer for multi-GB copy
// REQUIRED: await fs.promises.copyFile(src, dst) inside an async function
// deployShadowBase must be an async function using await for ALL file I/O that may block.
// Progress callback must be called between awaits to allow UI updates.

<!-- W4 fix: containment check -->
// BANNED: studioDir.startsWith(process.cwd()) — incorrect on Windows (case-insensitive, mixed drive letters)
// REQUIRED: const rel = path.relative(workspaceRoot, shadowDir); if (rel.startsWith('..') || path.isAbsolute(rel)) throw 'Path escapes workspace'
// workspaceRoot = path.dirname(studioDir) (the workspace folder containing .studio/)

<!-- W8 fix: .tmp cleanup on error -->
// In the catch block of deployShadowBase:
//   if (fs.existsSync(tmpShadowDir)) fs.rmSync(tmpShadowDir, { recursive: true, force: true })
//   (W8: prevents orphaned partial dirs)
// Then re-throw the original error.

<!-- searchTree_<sku>_<NN>= mechanism — CONFIRMED ground truth (TreeFile.cpp:133) -->
// Higher numeric slot = higher priority = first-match wins
// Shadow slots: max(originals) + 1, + 2, ... (one per shadow TRE)
// Patch slot: max(shadowSlots) + 1 (highest priority = overrides shadow base — B4)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: shadowBaseService.ts — async copy (B7), B4 patchPath slot, W4 containment fix, W8 .tmp cleanup</name>
  <files>
    packages/renderer/src/services/shadowBaseService.ts
  </files>
  <read_first>
    packages/renderer/src/services/workspaceService.ts — read the .gitignore write section and the mkdirSync patterns. Confirm '.studio/shadow/' is already written to .gitignore in 04-01 T3. Also read the W4-fixed containment logic (04-01 has the correct path.relative check — mirror the same pattern here).
    packages/renderer/src/services/cfgActivator.ts — read activatePatch signature + CfgInsertionRecord type + deactivatePatch (W9 line-surgery). Shadow entries and the patch entry are both written via activatePatch.
    packages/renderer/src/services/clientLocator.ts — read scanSharedFile + chooseSlot (canonical). The caller must pass client.cfgRootPath (swgemu.cfg), not swgtoolkit.cfg.
    packages/renderer/src/services/packPatch.ts — read buildPatchName and the packPatch function signature (04-03). The patchPath param comes from the DeployDialog calling packPatch before deployShadowBase.
    04-CONTEXT.md §D-04-10 — shadow-base model description.
    04-CONTEXT.md §D-04-15 — security: validate all paths before touching filesystem.
    04-REVIEWS.md §B4 — "Shadow never applies edits: deployShadowBase copied base TREs to shadow but never mounted the patch.tre built from flatten(versionId). The shadow-base mode delivered an unmodified client clone, not a patched one."
    04-REVIEWS.md §B7 — "copyFileSync in a loop of multi-GB TRE files freezes the renderer main thread. Use fs.promises.copyFile with await inside an async function."
    04-REVIEWS.md §W4 — "Containment check uses process.cwd().startsWith() which is wrong for Windows absolute paths. Use path.relative."
    04-REVIEWS.md §W8 — "If deployShadowBase throws mid-copy, the .tmp shadow dir is orphaned. Clean up in catch block."
    swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp lines 115-149 — read for the path-reading logic (does it accept absolute paths in searchTree values or only basenames?). Mark as UAT item if ambiguous.
  </read_first>
  <action>
    Create packages/renderer/src/services/shadowBaseService.ts.

    Imports: import * as fs from 'fs'; import * as path from 'path'. Import { scanSharedFile, chooseSlot, SharedFileScan } from './clientLocator'. Import { activatePatch, deactivatePatch } from './cfgActivator'. Import type { DetectedClient, CfgInsertionRecord } from '@swg/contracts'.

    Export interface ShadowDeployRecord (as shown in interfaces block: shadowDir, cfgPath, includeTargetPath, shadowEntries[], patchEntry, originalLiveDir, backupPath).

    Export function estimateTreSize(liveDir: string): number:
    List all *.tre files in liveDir. Sum fs.statSync(fullPath).size for each. Return total bytes. Throw 'Cannot read client Live/ dir: ' + liveDir if directory is unreadable.

    Export function checkFreeDisk(targetDir: string, neededBytes: number): void:
    Use fs.statfsSync (Node 18+) if available, else fall back to wmic parse. If availableBytes < neededBytes: throw 'Not enough disk space: need ' + Math.ceil(neededBytes/1048576) + 'mb, have ' + Math.ceil(availableBytes/1048576) + 'mb'. On check failure: log warning + continue (non-fatal).

    Export async function deployShadowBase(client: DetectedClient, studioDir: string, patchPath: string, onProgress?: (pct: number) => void): Promise<ShadowDeployRecord>:

    // B7: async throughout — no sync I/O inside the TRE copy loop

    1. Path validation (W4 fix):
       const shadowDir = path.join(studioDir, 'shadow').
       const workspaceRoot = path.dirname(studioDir).
       const relToWorkspace = path.relative(workspaceRoot, shadowDir).
       if (relToWorkspace.startsWith('..') || path.isAbsolute(relToWorkspace)) throw new Error('shadowDir escapes workspace: ' + shadowDir).
       // W4: NOT process.cwd().startsWith() — that fails on Windows with mixed drive letters or case differences.
       assert path.isAbsolute(client.installPath) and path.isAbsolute(studioDir) (throw if false).

    2. const liveDir = path.join(client.installPath, 'Live').
    3. Verify .gitignore contains '.studio/shadow/':
       const gitignorePath = path.join(workspaceRoot, '.gitignore').
       if (fs.existsSync(gitignorePath)) { const gi = fs.readFileSync(gitignorePath, 'utf8'); if (!gi.includes('.studio/shadow/')) { fs.appendFileSync(gitignorePath, '\n.studio/shadow/\n'); } }

    4. Pre-flight: const neededBytes = estimateTreSize(liveDir); checkFreeDisk(studioDir, neededBytes).

    5. Atomic copy to .tmp (B7: async + W8: cleanup on error):
       const tmpShadowDir = shadowDir + '.tmp'.
       let tmpCreated = false.
       try {
         await fs.promises.mkdir(tmpShadowDir, {recursive: true}); tmpCreated = true.
         const treFiles = (await fs.promises.readdir(liveDir)).filter(f => f.endsWith('.tre')).
         const total = treFiles.length.
         for (let i = 0; i < treFiles.length; i++) {
           const src = path.join(liveDir, treFiles[i]).
           const dst = path.join(tmpShadowDir, treFiles[i]).
           await fs.promises.copyFile(src, dst).  // B7: async — never blocks renderer
           onProgress?.((i + 1) / total * 0.8).   // copy = 80% of progress
         }
         if (fs.existsSync(shadowDir)) fs.rmSync(shadowDir, {recursive: true, force: true}).
         await fs.promises.rename(tmpShadowDir, shadowDir).
       } catch (e) {
         // W8: clean up orphaned .tmp dir
         if (tmpCreated && fs.existsSync(tmpShadowDir)) fs.rmSync(tmpShadowDir, {recursive: true, force: true}).
         throw e.
       }

    6. Write shadow cfg entries + B4 patch entry:
       const cfgDir = path.dirname(client.cfgRootPath).
       const swgtoolkitCfgPath = path.join(cfgDir, 'swgtoolkit.cfg').
       if (!fs.existsSync(swgtoolkitCfgPath)) { fs.writeFileSync(swgtoolkitCfgPath, '[SharedFile]\n', {encoding:'utf8'}); }
       const backupPath = swgtoolkitCfgPath + '.shadow.bak'; fs.copyFileSync(swgtoolkitCfgPath, backupPath).
       
       const records: ShadowDeployRecord['shadowEntries'] = [].
       
       // Write one shadow entry per TRE (re-scan after each to get the updated occupied slots)
       let currentScan = scanSharedFile(client.cfgRootPath).  // FULL chain scan — not just swgtoolkit.cfg
       const treFiles = (await fs.promises.readdir(liveDir)).filter(f => f.endsWith('.tre')).
       for (let j = 0; j < treFiles.length; j++) {
         const shadowTrePath = path.join(shadowDir, treFiles[j]).
         // NOTE: Absolute path support in searchTree values is UNVERIFIED (UAT item — TreeFile.cpp:115-149 ambiguous).
         // If the client rejects absolute paths, the UAT checkpoint will surface this and a gap-closure plan will add copy-to-client-subdir logic.
         const record = activatePatch(swgtoolkitCfgPath, shadowTrePath, currentScan).
         records.push({ keyName: record.keyName, slot: record.slot, shadowTrePath, originalTreName: treFiles[j] }).
         currentScan = scanSharedFile(swgtoolkitCfgPath).  // rescan after each insertion
         onProgress?.(0.8 + (j + 1) / treFiles.length * 0.15).  // cfg writes = 15% of progress
       }
       
       // B4 fix: mount the patch at the highest slot (above all shadow TREs)
       // packPatch(flatten(activeVersionId)) was called by the DeployDialog before invoking deployShadowBase.
       // Here we just register the already-built patchPath in the cfg.
       const patchScan = scanSharedFile(swgtoolkitCfgPath).  // includes all shadow slots written above
       const patchRecord = activatePatch(swgtoolkitCfgPath, patchPath, patchScan).
       const patchEntry = { keyName: patchRecord.keyName, slot: patchRecord.slot, patchPath }.
       onProgress?.(1.0).
       
       return { shadowDir, cfgPath: swgtoolkitCfgPath, includeTargetPath: client.cfgRootPath, shadowEntries: records, patchEntry, originalLiveDir: liveDir, backupPath }.

    Export function resetShadow(record: ShadowDeployRecord, cleanup = false): void:
    // Line-surgery to remove shadow searchTree entries AND the patch entry (W9 principle).
    // Restore from the single .shadow.bak taken before any shadow writes — this is the
    // authoritative restore point that covers all shadow entries + the patch entry in one operation.
    fs.copyFileSync(record.backupPath, record.cfgPath).
    if (cleanup && fs.existsSync(record.shadowDir)) { fs.rmSync(record.shadowDir, {recursive: true, force: true}); }
    // The .shadow.bak is kept (do not delete it — safety net for future resets).

    Export function diffShadow(client: DetectedClient, studioDir: string): { inShadow: string[]; missingFromShadow: string[] }:
    Compare *.tre files in liveDir vs shadowDir. Return stale/missing arrays. Used by UAT tooling.
  </action>
  <verify>
    <automated>pnpm --filter @swg/renderer exec tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    pnpm --filter @swg/renderer exec tsc --noEmit exits 0.
    grep -c "deployShadowBase\|resetShadow\|estimateTreSize\|checkFreeDisk" packages/renderer/src/services/shadowBaseService.ts gives 4.
    grep -c "promises\.copyFile\|await.*copyFile" packages/renderer/src/services/shadowBaseService.ts gives 1+ (B7: async copy).
    grep -c "copyFileSync" packages/renderer/src/services/shadowBaseService.ts gives 1 (only for the .shadow.bak backup — not in the TRE copy loop; grep total should be 1 not 2+).
    grep -c "patchEntry\|patchPath.*activatePatch\|B4\|patch.*highest.*slot" packages/renderer/src/services/shadowBaseService.ts gives 2+ (B4: patch slot above shadow entries).
    grep -c "path\.relative\|relToWorkspace\|W4" packages/renderer/src/services/shadowBaseService.ts gives 2+ (W4: correct containment check).
    grep -v "process\.cwd" packages/renderer/src/services/shadowBaseService.ts | grep -c "startsWith" gives 0 (the only startsWith use is path.relative result check, not process.cwd()).
    grep -c "rmSync.*tmpShadowDir\|catch.*rmSync\|W8\|orphan" packages/renderer/src/services/shadowBaseService.ts gives 1+ (W8: .tmp cleanup on error).
    grep -c "from './clientLocator'" packages/renderer/src/services/shadowBaseService.ts gives 1 (imports from canonical module).
    grep -c "live-inject\|@swg/live-inject" packages/renderer/src/services/shadowBaseService.ts gives 0.
    grep -c "absolute.*UNVERIFIED\|UNVERIFIED.*absolute\|UAT.*absolute" packages/renderer/src/services/shadowBaseService.ts gives 1+ (absolute path caveat annotated).
    grep -c "async function deployShadowBase" packages/renderer/src/services/shadowBaseService.ts gives 1 (async — B7).
  </acceptance_criteria>
  <done>shadowBaseService.ts: async deployShadowBase (B7 — no sync copyFileSync in TRE loop); B4 — patchPath param + activatePatch call at highest slot after all shadow entries; W4 — path.relative containment check (not process.cwd().startsWith()); W8 — catch block cleans up tmpShadowDir; estimateTreSize + checkFreeDisk + resetShadow; TS compiles clean.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: In-client UAT — shadow TREs + patch load, mod edits visible, reset restores</name>
  <what-built>
    shadowBaseService.ts copies the full client TRE base to .studio/shadow/ (async, with progress) and writes shadow searchTree entries at higher slots than originals. THEN mounts the patch .tre (built from flatten(activeVersionId)) at the highest slot so mod edits take effect. The real install (D:\SWG Infinity\SWG Infinity\Live\) remains pristine. resetShadow() restores the cfg from backup, removing all shadow entries AND the patch entry.
  </what-built>
  <how-to-verify>
    PRECONDITIONS: Toolkit app running with a workspace open. SWG Infinity installed. Enough disk space for full TRE base copy (~multi-GB). A sealed version (04-04 sealVersion) with at least one file modification must exist. Network/launcher not running.

    STEP 1 — Build the patch:
    In DeployDialog, choose 'Shadow-base (isolated client)'. Verify the dialog calls flatten(activeVersionId) → packPatch → builds the .tre patch. Note the patch .tre path.

    STEP 2 — Deploy shadow base:
    Click 'Deploy patch' (or equivalent). Observe: progress indicator moves through the TRE copy phase (0-80%) and the cfg write phase (80-100%). Confirm completion without renderer freeze (B7 test — UI must remain responsive during copy). If renderer freezes: this is B7 regression; note which copyFile call caused it.

    STEP 3 — Verify shadow dir:
    Confirm .studio/shadow/ now contains *.tre copies. Confirm D:\SWG Infinity\SWG Infinity\Live\ files are UNCHANGED (no additions, no removals).

    STEP 4 — Verify cfg entries:
    Open D:\SWG Infinity\SWG Infinity\swgtoolkit.cfg. Confirm: (a) shadow TRE entries at slots above 54 (the retail max), and (b) the patch .tre entry at the HIGHEST slot (above all shadow entries). If the searchTree value paths are absolute paths: note whether that causes client load issues in Step 5. (UAT item: absolute path support UNVERIFIED in TreeFile.cpp.)

    STEP 5 — Client launch (full mod test — B4 verification):
    Launch SWG Infinity. Confirm: (a) client boots successfully, (b) the file you modified in the sealed changeset is VISIBLE in-game (this is the B4 test — the prior plan's shadow-base mode never applied edits). If the modified file is NOT visible: B4 is broken; record which layer the modification was in.

    STEP 6 — Absolute path check (UAT item):
    If the client failed to load any TREs in Step 5: check the swgemu.log or client console for 'could not open archive' errors. If the errors reference the shadow paths: absolute paths are not supported in searchTree values. Note for gap-closure: 'need to copy shadow TREs to client-relative subdir instead of using absolute paths'.

    STEP 7 — Reset shadow:
    Use the toolkit's Reset deployment function. Confirm swgtoolkit.cfg no longer contains shadow searchTree entries or the patch entry. Confirm .studio/shadow/ TRE copies remain on disk (cleanup=false by default).

    STEP 8 — Post-reset boot:
    Launch SWG Infinity. Confirm it boots from originals in Live/ (no shadow or patch entries). Confirm the modified file is NO LONGER visible (retail version shows instead).
  </how-to-verify>
  <resume-signal>
    Type 'approved' if Steps 1-8 all pass. If Step 4 shows absolute paths rejected (client can't find shadow TREs): type 'approved with note: absolute paths rejected — gap-closure needed'. If Step 5 shows B4 still broken (mod edits not visible despite patch entry in cfg): describe the exact slot numbers in cfg vs the searched slots. If renderer froze during Step 2 (B7 regression): describe which phase of the copy (which TRE file or index) caused it. If any client crash: provide crash log path.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| deployShadowBase → .studio/shadow/ | Multi-GB async copy; must stay within workspace, never to system paths |
| searchTree values (absolute paths) → client .cfg | Client reads these paths at boot; wrong path silently fails (falls through) |
| resetShadow backup-restore → swgtoolkit.cfg | Restore must be atomic; partial restore leaves corrupt cfg |
| patchPath → activatePatch → cfg | The patch .tre path is written into the client's cfg; must be a legitimate toolkit-built patch |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-SB-01 | Denial of Service | deployShadowBase disk exhaustion | mitigate | Pre-flight checkFreeDisk aborts with 'Not enough disk space: need Xmb, have Ymb' before any copy begins |
| T-04-SB-02 | Tampering | deployShadowBase writing shadow outside workspace | mitigate | W4 fix: path.relative(workspaceRoot, shadowDir).startsWith('..') guard throws before any mkdir; path.isAbsolute checks on all inputs |
| T-04-SB-03 | Tampering | partial interrupted async copy leaves .tmp dir | mitigate | W8 fix: catch block runs fs.rmSync(tmpShadowDir, {recursive:true, force:true}); then re-throws |
| T-04-SB-04 | Tampering | resetShadow restoring wrong backup | mitigate | ShadowDeployRecord.backupPath records the exact path taken before any shadow writes; restore uses that exact path |
| T-04-SB-05 | Tampering | patchPath pointing outside workspace | mitigate | patchPath is built by packPatch(flatten(activeVersionId)) which writes to .studio/build/ — validated at packPatch write time; deployShadowBase does not independently validate patchPath beyond passing it to activatePatch |
| T-04-SC | Tampering | npm/pip installs | mitigate | No new npm packages; slopcheck not required |
</threat_model>

<verification>
pnpm --filter @swg/renderer exec tsc --noEmit exits 0 (Task 1).
Manual UAT approved (Task 2 checkpoint): shadow TREs copy to .studio/shadow/; patch .tre mounted at highest slot (B4); mod edits visible in-game; renderer responsive during copy (B7); reset restores originals-only cfg; post-reset boot shows unmodified retail.
</verification>

<success_criteria>
shadowBaseService.ts: async TRE copy (B7); patchPath param with activatePatch at highest slot above shadow entries (B4); path.relative containment guard (W4); .tmp cleanup on error (W8); estimateTreSize + checkFreeDisk + resetShadow; absolute path UAT item annotated; in-client UAT confirms mod edits visible in shadow-base mode and reset restores originals.
</success_criteria>

<output>
Create .planning/phases/04-edit-deploy-loop/04-06b-SUMMARY.md when done.
</output>
