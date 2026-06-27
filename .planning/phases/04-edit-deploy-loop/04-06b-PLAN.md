---
phase: 04-edit-deploy-loop
plan: "06b"
type: execute
wave: 3
depends_on:
  - 04-01
  - 04-03
files_modified:
  - packages/renderer/src/services/shadowBaseService.ts
autonomous: false
requirements:
  - DEPLOY-02
  - DEPLOY-01

must_haves:
  truths:
    - "deployShadowBase() copies each TRE from client.installPath/Live/ to .studio/shadow/ with a pre-flight free-space check; aborts with a clear error ('Not enough disk space: need Xmb, have Ymb') if insufficient space."
    - ".studio/shadow/ is already in .gitignore (written by workspaceService in 04-01 T3 — verify the entry exists before copying)."
    - "Shadow cfg entries are written as searchTree_<sku>_<NN>=<absolute-shadow-tre-path> into swgtoolkit.cfg at slots above the originals, using the same confirmed searchTree_<sku>_<NN>= mechanism from TreeFile.cpp:133."
    - "resetShadow(record) removes the shadow searchTree entries from swgtoolkit.cfg (restores from backup) and optionally deletes the shadow TRE copies."
    - "In-client UAT (Task 2): client boots with shadow cfg entries taking effect; retail originals remain in Live/ untouched; reset restores originals-only cfg."
  artifacts:
    - path: packages/renderer/src/services/shadowBaseService.ts
      provides: "deployShadowBase, resetShadow, estimateTreSize, checkFreeDisk — shadow-base deploy model (D-04-10)"
      exports:
        - deployShadowBase
        - resetShadow
        - estimateTreSize
        - checkFreeDisk
  key_links:
    - from: packages/renderer/src/services/shadowBaseService.ts
      to: packages/renderer/src/services/cfgActivator.ts
      via: "activatePatch(swgtoolkitCfgPath, shadowTreName, scan) for each shadow TRE entry"
      pattern: "activatePatch"
    - from: packages/renderer/src/services/shadowBaseService.ts
      to: packages/renderer/src/services/clientLocator.ts
      via: "scanSharedFile(cfgPath) → chooseSlot(scan) per shadow TRE"
      pattern: "scanSharedFile|chooseSlot"
    - from: ".studio/shadow/"
      to: client.installPath/Live/
      via: "shadow TREs are copies; originals remain at full retail path; resetShadow removes shadow cfg entries"
      pattern: "shadow"
---

## Phase Goal

**As a** SWG mod developer, **I want to** stage edited files in a project workspace and build a deployable `.tre` patch that activates via the client config, **so that** I can iterate on mod changes in-game, roll back to any prior state, and version my work safely via Git/LFS.

<objective>
Implement the shadow-base deploy model backend (D-04-10). deployShadowBase copies the client TRE base into .studio/shadow/ and writes shadow searchTree entries at higher slots than the originals. The real install is never touched — it remains as a pristine reset source.

Purpose: D-04-10 requires BOTH patch-prepend AND shadow-base to be functional. This plan creates the shadowBaseService that DeployDialog (04-06) imports. Without it, the shadow-base radio option in the DeployDialog would be non-functional.

Output: shadowBaseService.ts (estimateTreSize, checkFreeDisk, deployShadowBase, resetShadow, diffShadow); manual UAT checkpoint that shadow TREs load in the client and reset restores originals.
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

<interfaces>
<!-- clientLocator — canonical source of SharedFileScan + helpers -->
import { scanSharedFile, chooseSlot, SharedFileScan } from './clientLocator';
// scanSharedFile(cfgPath: string) → SharedFileScan
// chooseSlot(scan: SharedFileScan) → number (next free slot)

<!-- cfgActivator — re-exports from clientLocator; provides activatePatch, deactivatePatch -->
import { activatePatch, deactivatePatch } from './cfgActivator';
// activatePatch(cfgPath: string, patchName: string, scan: SharedFileScan) → CfgInsertionRecord
// deactivatePatch(record: CfgInsertionRecord) → void

<!-- DetectedClient — from @swg/contracts (created in 04-01 T1) -->
interface DetectedClient {
  name: string;
  installPath: string;
  cfgRootPath: string;  // path to swgemu.cfg
  treVersion: string;
}

<!-- ShadowDeployRecord — return type of deployShadowBase -->
// Define locally in shadowBaseService.ts and export:
interface ShadowDeployRecord {
  shadowDir: string;                   // .studio/shadow/
  cfgPath: string;                     // path to swgtoolkit.cfg (where shadow entries were written)
  includeTargetPath: string;           // swgemu.cfg path (.include target)
  shadowEntries: Array<{
    keyName: string;                   // e.g. 'searchTree_00_56'
    slot: number;                      // numeric priority slot
    shadowTrePath: string;             // absolute path to shadow TRE copy in .studio/shadow/
    originalTreName: string;           // filename in client Live/ dir
  }>;
  originalLiveDir: string;             // client.installPath/Live/ — unchanged (pristine)
  backupPath: string;                  // swgtoolkit.cfg backup before shadow writes
}

<!-- searchTree_<sku>_<NN>= mechanism — CONFIRMED ground truth (TreeFile.cpp:133) -->
// Key format: 'searchTree' + skuSuffix + slotNumber (e.g. 'searchTree_00_56')
// Higher numeric slot = higher priority = first-match wins
// Shadow entries must use slots ABOVE the highest occupied originals (scan via scanSharedFile)
// Absolute shadow path support UNVERIFIED — UAT item. If the client rejects absolute paths,
// implement copying shadow TREs to a client-relative subdir instead.

<!-- workspaceService disk layout (from 04-01 T3) -->
// .studio/shadow/   — already in .gitignore (workspaceService writes '.studio/shadow/')
// .studio/build/    — patch output dir
// .studio/changesets/ — sealed manifest
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: shadowBaseService.ts — pre-flight disk check + TRE copy to .studio/shadow/ + shadow cfg entries</name>
  <files>
    packages/renderer/src/services/shadowBaseService.ts
  </files>
  <read_first>
    packages/renderer/src/services/workspaceService.ts — read the mkdirSync and .gitignore write sections. Confirm '.studio/shadow/' is already written to .gitignore. If the exact string is missing, the first step of deployShadowBase must add it (but should not be needed if 04-01 T3 is correct).
    packages/renderer/src/services/cfgActivator.ts — read activatePatch signature + CfgInsertionRecord type + deactivatePatch. Shadow entries are written via repeated activatePatch calls (one per TRE), accumulating the records.
    packages/renderer/src/services/clientLocator.ts — read scanSharedFile + chooseSlot (canonical definitions). Shadow deployment needs to assign consecutive slots starting from the next free slot after originals.
    04-RESEARCH.md §Ground Truth searchTree_<sku>_<NN>= mechanism — read the TreeFile.cpp:133 citation. Confirm the key format and higher-slot-wins semantics. Shadow entries must use higher numeric slots than any existing retail entry.
    04-RESEARCH.md §Open Questions — note that absolute path support in searchTree values is UNVERIFIED; mark the shadow TRE path writing as a UAT item.
    04-CONTEXT.md §D-04-10 — read the shadow-base model description: copy TRE base to .studio/shadow/, write searchTree at higher slots pointing to shadow copies; real install stays as pristine reset source.
    04-CONTEXT.md §D-04-15 — security: validate all paths before touching filesystem; never write outside workspace or client.
    swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp lines 115-149 — read for the sprintf key-building logic and the path-reading code. Verify whether searchTree values can be absolute paths or must be relative. This is the UAT item — confirm in the source before writing; if ambiguous, add a comment marking it as UNVERIFIED and flag it for Task 2 UAT.
  </read_first>
  <action>
    Create packages/renderer/src/services/shadowBaseService.ts.

    Imports: fs from 'fs'; path from 'path'; os from 'os'.
    Import { scanSharedFile, chooseSlot, SharedFileScan } from './clientLocator'.
    Import { activatePatch, deactivatePatch } from './cfgActivator'.
    Import type { DetectedClient, CfgInsertionRecord } from '@swg/contracts'.

    Export interface ShadowDeployRecord (as shown in interfaces block above).

    Export function estimateTreSize(liveDir: string): number:
    List all *.tre files in liveDir (fs.readdirSync filter .endsWith('.tre')). Sum fs.statSync(fullPath).size for each. Return total bytes. If liveDir does not exist or cannot be read: throw 'Cannot read client Live/ dir: ' + liveDir.

    Export function checkFreeDisk(targetDir: string, neededBytes: number): void:
    Use the native node disk-space check: require('fs').statfsSync if available (Node 18+), else fall back to child_process.execFileSync('wmic', ['logicaldisk', 'where', 'DeviceID="' + path.parse(targetDir).root.replace('\\','') + '"', 'get', 'FreeSpace', '/value'], {encoding:'utf8', timeout:5000}) and parse the FreeSpace= line. Extract available bytes. If availableBytes < neededBytes: throw 'Not enough disk space: need ' + Math.ceil(neededBytes/1024/1024) + 'mb, have ' + Math.ceil(availableBytes/1024/1024) + 'mb'. If the disk check fails for any reason (API unavailable, parse error), log a warning and continue (do not block the deploy — UAT will catch actual space issues).

    Export async function deployShadowBase(client: DetectedClient, studioDir: string, workspaceName: string, onProgress?: (pct: number) => void): Promise<ShadowDeployRecord>:

    1. Path validation: assert path.isAbsolute(client.installPath) and path.isAbsolute(studioDir). Assert studioDir.startsWith(process.cwd()) or is within a known workspace root (basic containment check — not crossing volumes).
    2. const liveDir = path.join(client.installPath, 'Live').
    3. const shadowDir = path.join(studioDir, 'shadow').
    4. Verify .gitignore contains '.studio/shadow/': read path.join(path.dirname(studioDir), '.gitignore'); if the string is absent, append it (workspaceService should have done this in 04-01 T3, but be defensive).
    5. Pre-flight: const neededBytes = estimateTreSize(liveDir); checkFreeDisk(shadowDir, neededBytes). This throws if space is insufficient (bubbles up to DeployDialog error handler).
    6. Atomic-ish copy: copy to a temp shadow dir first (shadowDir + '.tmp'), then rename to shadowDir if it doesn't already exist. This prevents a partial-interrupted copy from leaving a corrupt shadow dir:
       a. const tmpShadowDir = shadowDir + '.tmp'; fs.mkdirSync(tmpShadowDir, {recursive:true}).
       b. const treFiles = fs.readdirSync(liveDir).filter(f => f.endsWith('.tre')); total = treFiles.length.
       c. For each TRE (with index i): fs.copyFileSync(path.join(liveDir, tre), path.join(tmpShadowDir, tre)); call onProgress?.((i+1)/total * 0.8) (copy = 80% of progress).
       d. If shadowDir exists (from a previous deploy): remove it (fs.rmSync(shadowDir, {recursive:true})).
       e. fs.renameSync(tmpShadowDir, shadowDir).
    7. Write shadow searchTree entries into swgtoolkit.cfg:
       a. const cfgDir = path.dirname(client.cfgRootPath); const swgtoolkitCfgPath = path.join(cfgDir, 'swgtoolkit.cfg').
       b. If swgtoolkit.cfg does not exist: create an empty [SharedFile] block (BOM-free, same as cfgActivator pattern).
       c. const backupPath = swgtoolkitCfgPath + '.shadow.bak'; fs.copyFileSync(swgtoolkitCfgPath, backupPath). (Single backup covers all shadow entries — deactivation restores from this one backup.)
       d. const records: Array<{keyName:string; slot:number; shadowTrePath:string; originalTreName:string}> = [].
       e. let currentScan = scanSharedFile(swgtoolkitCfgPath). For each TRE (with index j): const slot = chooseSlot(currentScan); const keyName = 'searchTree' + currentScan.skuSuffix + slot; const shadowTrePath = path.join(shadowDir, tre).
          NOTE: absolute path support is UNVERIFIED (UAT item). Write the absolute path. If the client rejects it, the UAT will catch it and a gap-closure plan will add copy-to-client-subdir logic.
          Write a single [SharedFile] block with the one key to swgtoolkitCfgPath (use activatePatch or inline write). Push record. Re-scan after each insert: currentScan = scanSharedFile(swgtoolkitCfgPath) (slot state must be current). onProgress?.((j+1)/treFiles.length * 0.2 + 0.8).
       f. If writing any key fails: restore from backupPath; clean up tmpShadowDir or shadowDir; re-throw.
    8. Return ShadowDeployRecord: { shadowDir, cfgPath: swgtoolkitCfgPath, includeTargetPath: client.cfgRootPath, shadowEntries: records, originalLiveDir: liveDir, backupPath }.

    Export function resetShadow(record: ShadowDeployRecord): void:
    Restore swgtoolkit.cfg from the shadow backup: fs.copyFileSync(record.backupPath, record.cfgPath). (The backup taken in step 7c covers all shadow entries — restoring it removes them all in one operation.) Do NOT delete the shadow TRE copies unless the caller requests it (preserve them as a safety net). Provide an optional 2nd param: cleanup?: boolean — if true, fs.rmSync(record.shadowDir, {recursive:true}).

    Export function diffShadow(client: DetectedClient, studioDir: string): { inShadow: string[]; missingFromShadow: string[] }:
    Compare *.tre files in client.installPath/Live/ vs .studio/shadow/. Return arrays of which TREs are in shadow but not in Live/ (stale) and which are in Live/ but not in shadow/ (need re-copy). Used by future UAT tooling.
  </action>
  <verify>
    <automated>pnpm --filter @swg/renderer exec tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    pnpm --filter @swg/renderer exec tsc --noEmit exits 0.
    grep -c "deployShadowBase\|resetShadow\|estimateTreSize\|checkFreeDisk" packages/renderer/src/services/shadowBaseService.ts gives 4 (all four functions exported).
    grep -c "Not enough disk space\|neededBytes\|availableBytes" packages/renderer/src/services/shadowBaseService.ts gives 2+ (free-space guard message + implementation).
    grep -c "\.tmp\|tmpShadowDir\|renameSync" packages/renderer/src/services/shadowBaseService.ts gives 2+ (atomic copy-to-temp then rename).
    grep -c "shadow\.bak\|backupPath.*shadow\|shadow.*backup" packages/renderer/src/services/shadowBaseService.ts gives 1+ (single backup covers all shadow entries).
    grep -c "gitignore\|\.studio/shadow" packages/renderer/src/services/shadowBaseService.ts gives 1+ (defensive .gitignore check).
    grep -c "from './clientLocator'" packages/renderer/src/services/shadowBaseService.ts gives 1 (imports scanSharedFile/chooseSlot from canonical module).
    grep -c "live-inject\|@swg/live-inject" packages/renderer/src/services/shadowBaseService.ts gives 0 (never imports live-inject).
    grep -c "absolute.*UNVERIFIED\|UNVERIFIED.*absolute\|UAT.*absolute\|absolute.*UAT" packages/renderer/src/services/shadowBaseService.ts gives 1+ (absolute path caveat annotated).
    grep -c "path.isAbsolute\|isAbsolute" packages/renderer/src/services/shadowBaseService.ts gives 2+ (path validation guards).
  </acceptance_criteria>
  <done>shadowBaseService.ts exports deployShadowBase + resetShadow + estimateTreSize + checkFreeDisk; free-space guard aborts with 'Not enough disk space: need Xmb, have Ymb'; TRE copy is atomic (to .tmp then rename); shadow cfg entries use searchTree_<sku>_<NN>= mechanism from clientLocator; absolute path support marked UNVERIFIED (UAT item); shadow dir stays inside .studio/; .gitignore checked defensively; TS compiles clean.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: In-client UAT — shadow TREs load, originals bypassed, reset restores</name>
  <what-built>
    shadowBaseService.ts copies the full client TRE base to .studio/shadow/ and writes shadow searchTree entries at higher slots. The real install (D:\SWG Infinity\SWG Infinity\Live\) remains pristine. resetShadow() restores the cfg from backup, removing all shadow entries.
  </what-built>
  <how-to-verify>
    PRECONDITIONS: Toolkit app running with a workspace open. SWG Infinity installed at D:\SWG Infinity. Enough free disk space for the full TRE base copy (~multi-GB). Network/launcher not running.

    STEP 1 — Pre-flight check:
    Confirm .studio/shadow/ does NOT exist yet in the workspace. Note available disk space. Verify D:\SWG Infinity\SWG Infinity\Live\ contains the *.tre files.

    STEP 2 — Shadow deploy:
    Open DeployDialog → select 'Shadow-base (isolated client)' in Section B → confirm the ⚠ disk-space warning shows an estimated size. Click 'Deploy patch'. Observe the progress indicator (TRE copy is the heavy operation — may take 1-5 minutes). Wait for the success state.

    STEP 3 — Verify shadow dir:
    Confirm .studio/shadow/ now contains *.tre copies. Run diffShadow (or manually compare) to confirm all TREs from Live/ are present in shadow/. Confirm the ORIGINAL D:\SWG Infinity\SWG Infinity\Live\ files are UNCHANGED (no files removed or added there).

    STEP 4 — Verify cfg entries:
    Open D:\SWG Infinity\SWG Infinity\swgtoolkit.cfg. Confirm it now contains [SharedFile] entries with searchTree_00_<NN>= pointing to the shadow TRE paths (absolute paths) at slot numbers HIGHER than the originals in swgemu.cfg. (UAT item: if the client does not accept absolute paths, the TREs will not load — document this if it happens and type 'note: absolute paths rejected — need client-relative copy' in resume signal.)

    STEP 5 — Client launch:
    Launch SWG Infinity. Confirm it boots successfully with the shadow cfg entries active. (Modification test is optional for this UAT — the main check is 'client boots without crash when shadow cfg entries point to shadow dir'.)

    STEP 6 — Reset shadow:
    Without closing the client: use the toolkit's Reset deployment function (or call resetShadow from a dev console). Confirm swgtoolkit.cfg no longer contains the shadow searchTree entries (backup restored). The shadow .studio/shadow/ TRE copies should remain on disk (cleanup=false by default).

    STEP 7 — Original confirm:
    Relaunch SWG Infinity with the reset cfg. Confirm it boots from the originals in Live/ (not shadow). Confirm no crashes.
  </how-to-verify>
  <resume-signal>
    Type 'approved' if Steps 1-7 all pass. If Step 4 fails (client rejects absolute paths in searchTree values): type 'approved with note: absolute paths rejected — gap-closure needed (copy shadow TREs to client-relative subdir)'. If shadow copy is too slow or fails pre-flight: document disk space numbers. If client crashes during Step 5: provide the crash log path and describe which shadow cfg entry was active.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| deployShadowBase → .studio/shadow/ | Multi-GB filesystem copy; must stay within workspace, never to system paths |
| searchTree values (absolute paths) → client .cfg | Client reads these paths at boot; a wrong path silently fails (client falls through to originals) |
| resetShadow backup-restore → swgtoolkit.cfg | Restore must be atomic; partial restore would leave a corrupt cfg |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-SB-01 | Denial of Service | deployShadowBase disk exhaustion | mitigate | Pre-flight checkFreeDisk aborts with 'Not enough disk space: need Xmb, have Ymb' before any copy begins; error surfaces in DeployDialog error state |
| T-04-SB-02 | Tampering | deployShadowBase writing shadow outside workspace | mitigate | shadowDir is path.join(studioDir, 'shadow') where studioDir is the workspace .studio/ dir; path.isAbsolute validated; studioDir containment check before any write |
| T-04-SB-03 | Tampering | partial interrupted copy leaves corrupt shadow dir | mitigate | All TREs copied to .tmp shadow dir first; only rename to final shadowDir after all copies succeed; if copy fails mid-way, .tmp is cleaned up and final shadowDir is never produced |
| T-04-SB-04 | Tampering | resetShadow restoring wrong backup | mitigate | Backup is taken as swgtoolkit.cfg + '.shadow.bak' immediately before any shadow key writes; the ShadowDeployRecord.backupPath field records the exact path; restore uses that exact path |
| T-04-SC | Tampering | npm/pip installs | mitigate | No new npm packages; slopcheck not required |
</threat_model>

<verification>
pnpm --filter @swg/renderer exec tsc --noEmit exits 0 (Task 1).
Manual UAT approved (Task 2 checkpoint): shadow TREs copy to .studio/shadow/; cfg entries written at higher slots; original Live/ untouched; client boots with shadow entries; reset restores originals-only cfg; client boots from originals after reset.
</verification>

<success_criteria>
shadowBaseService.ts exports deployShadowBase (pre-flight disk check + atomic TRE copy to .studio/shadow/ + shadow searchTree cfg entries at higher slots than originals) and resetShadow (cfg restore from backup); free-space guard shows clear mb/mb error; shadow dir stays inside workspace; .gitignore checked defensively; in-client UAT confirms shadow TREs load and reset restores originals.
</success_criteria>

<output>
Create .planning/phases/04-edit-deploy-loop/04-06b-SUMMARY.md when done.
</output>
