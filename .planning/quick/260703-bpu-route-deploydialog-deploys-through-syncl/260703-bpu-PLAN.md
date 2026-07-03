---
phase: 260703-bpu-route-deploydialog-deploys-through-syncl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/renderer/src/services/syncLiveToVersion.ts
  - packages/renderer/src/services/syncLiveToVersion.test.ts
  - packages/renderer/src/panels/deploy/DeployDialog.tsx
  - packages/renderer/src/panels/deploy/DeployDialog.test.tsx
  - packages/renderer/src/panels/deploy/VersionHistoryBody.tsx
autonomous: true
requirements: [DEPLOY-03, DEPLOY-08, VER-04]

must_haves:
  truths:
    - "Clicking Deploy in DeployDialog for the absolute-path model or the loose-override model calls syncLiveToVersion — no direct deployLoose/activatePatch call remains in handleDeploy"
    - "Clicking Deploy while the active version is Baseline (or flattens to zero entries) also routes the revert-to-stock path through syncLiveToVersion"
    - "After a real deploy, the Undo bar appears in VersionHistoryBody and clicking Undo (or Ctrl+Z) calls syncLiveToVersion to restore the prior deployed state on the client — not just re-select the prior version"
    - "syncLiveToVersion's cfg-apply branch writes the freshly-built patch's real absolute path (not the 'patch.tre' placeholder, not a basename-truncated path) when deploying a version that has no prior deployRecord yet"
    - "All existing syncLiveToVersion tests keep passing, and a new DeployDialog test proves the engine is called on Deploy"
  artifacts:
    - path: "packages/renderer/src/services/syncLiveToVersion.ts"
      provides: "ReconcileCtx.freshPatchPath/freshSnapshotPath + corrected patchPath/includeTargetPath on the persisted CfgDeployRecord"
    - path: "packages/renderer/src/panels/deploy/DeployDialog.tsx"
      provides: "handleDeploy routing Baseline-revert, loose-override apply, and absolute-path apply through syncLiveToVersion"
    - path: "packages/renderer/src/panels/deploy/VersionHistoryBody.tsx"
      provides: "handleUndo calling syncLiveToVersion(snapshot.priorLiveVersionId, ctx) when a client is bound"
  key_links:
    - from: "packages/renderer/src/panels/deploy/DeployDialog.tsx (handleDeploy)"
      to: "packages/renderer/src/services/syncLiveToVersion.ts"
      via: "await syncLiveToVersion(targetId, ctx)"
      pattern: "await syncLiveToVersion\\("
    - from: "packages/renderer/src/panels/deploy/VersionHistoryBody.tsx (handleUndo)"
      to: "packages/renderer/src/services/syncLiveToVersion.ts"
      via: "await syncLiveToVersion(snapshot.priorLiveVersionId, ctx)"
      pattern: "syncLiveToVersion\\(snapshot"
---

<objective>
Route `DeployDialog.handleDeploy`'s reconcile (both a forward deploy and a Baseline
revert-to-stock) through `syncLiveToVersion`, deleting the duplicated inline
apply/revert logic, and make `VersionHistoryBody`'s Undo affordance perform a REAL
reconcile (restore the prior deployed state on the client) instead of a selection-only
`doSelect`. Closes `.planning/todos/pending/deploy-dialog-synclive-undo-wiring.md`.

Purpose: `syncLiveToVersion` (H4 record-shape dispatch, loose/cfg cross-model,
Baseline restore, undo-snapshot push) is tested and correct, but nothing in the UI
calls it — so Undo is currently dormant and DeployDialog duplicates apply/revert
logic the engine already owns. Wiring the dialog to the engine is what makes Undo
come alive "for free" (the engine pushes the undo snapshot on every real mutation).

Output: `syncLiveToVersion` gains the two ctx fields it needs to support a brand-new
(never-before-deployed) cfg-model version; `DeployDialog` deploys/reverts exclusively
through the engine; `VersionHistoryBody`'s Undo restores the prior deployed state.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/todos/pending/deploy-dialog-synclive-undo-wiring.md
@.planning/STATE.md
@packages/renderer/src/services/syncLiveToVersion.ts
@packages/renderer/src/panels/deploy/DeployDialog.tsx
@packages/renderer/src/panels/deploy/VersionHistoryBody.tsx
@packages/renderer/src/services/changesetService.ts
@packages/renderer/src/state/undoStore.ts

<interfaces>
<!-- ReconcileCtx (current) — packages/renderer/src/services/syncLiveToVersion.ts -->
export interface ReconcileCtx {
  manifest: WorkspaceChangesetManifest;
  studioDir: string;
  cfgPath: string;        // MUST be selectedClient.cfgRootPath (the FILE), never clientPath/installPath
  installRoot: string;    // selectedClient.installPath
  priorLiveLooseRecord?: LooseDeployRecord;  // the LIVE version's LooseDeployRecord, when loose-model
}

export interface LiveReconcileResult {
  liveVersionId: string | null;
  model: 'loose' | 'cfg';
  record?: LooseDeployRecord | CfgDeployRecord;
  noop: boolean;
}

export function syncLiveToVersion(targetId: string | null, ctx: ReconcileCtx): Promise<LiveReconcileResult>;

<!-- DetectedClient — packages/contracts/src/deploy.ts -->
export interface DetectedClient {
  name: string;
  installPath: string;   // = ReconcileCtx.installRoot
  cfgRootPath: string;   // = ReconcileCtx.cfgPath (the real cfg FILE, not the install dir)
  treVersion: string;
}

<!-- undoStore.ts -->
export interface ReconcileSnapshot {
  priorLiveVersionId: string | null;
  priorDeployRecord?: CfgDeployRecord | LooseDeployRecord;
  takenAt: string;
}
useUndoStore.getState().undo(): ReconcileSnapshot | undefined;  // pops LIFO
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix syncLiveToVersion's cfg-apply path for a brand-new (never-deployed) target version</name>
  <files>packages/renderer/src/services/syncLiveToVersion.ts, packages/renderer/src/services/syncLiveToVersion.test.ts</files>
  <action>
Bug (the todo's "Watch out" note): in the cfg-apply branch of `syncLiveToVersion` (the
`else` under `if (applyModel === 'loose')`, "Step 4: Activate the target cfg entry"),
`patchName` falls back to the literal string `'patch.tre'` when
`targetChangeset.deployRecord.patchPath` is absent — true for every FIRST-TIME deploy
of a version, since no deployRecord exists yet for a version nobody has deployed
before. Additionally, when `targetCfgRecord.patchPath` IS present it is passed through
`path.basename(...)`, truncating the absolute path that `activatePatch`'s `patchName`
parameter is supposed to receive verbatim (D-05 absolute-path model: the searchTree
value must be the FULL absolute path to the .tre, exactly as `DeployDialog` already
does when calling `activatePatch` directly today).

Fix, in order:
1. Add two optional fields to `ReconcileCtx`: `freshPatchPath?: string` (absolute path
   to a patch the CALLER just built for this deploy — takes priority over any stored
   record) and `freshSnapshotPath?: string` (absolute path to a root-cfg snapshot the
   caller just took, same priority rule). Document both with a comment referencing this
   plan and the "no prior deployRecord yet" scenario.
2. In the cfg-apply branch, change the `patchName` computation to prefer
   `ctx.freshPatchPath`, then `targetCfgRecord?.patchPath` used VERBATIM (remove the
   `path.basename(...)` call entirely — do not truncate), then the `'patch.tre'`
   fallback only when neither is available.
3. In the `newRecord` object built after `activatePatch` succeeds: set `patchPath` to
   `ctx.freshPatchPath ?? targetCfgRecord?.patchPath ?? ''` (same precedence as
   patchName); set `snapshotPath` to `ctx.freshSnapshotPath ?? targetCfgRecord?.snapshotPath`;
   set `includeTargetPath` to `ctx.cfgPath` (NOT `insertionRecord.includeTargetPath`,
   which `activatePatch` always returns as `''` — the real value the record needs is
   the client root cfg path, already available on `ctx`).
4. Add a new test case to `syncLiveToVersion.test.ts` (alongside cases a-f), e.g.
   "(g) fresh cfg deploy with no prior deployRecord uses ctx.freshPatchPath verbatim,
   not the 'patch.tre' placeholder or a truncated basename": build a manifest where the
   TARGET changeset has NO `deployRecord` at all (a version never deployed before), set
   `cfgActivator.activatePatch` to `mockReturnValueOnce` a concrete `CfgInsertionRecord`
   (cfgPath/keyName/slot/backupPath), call `syncLiveToVersion(targetId, { ...makeCtx(manifest), freshPatchPath: '/studio/build/fresh.tre', freshSnapshotPath: '/studio/snapshots/root.bak' })`,
   and assert: `cfgActivator.activatePatch` was called with the SECOND argument exactly
   `'/studio/build/fresh.tre'` (full path, no basename stripping, not `'patch.tre'`);
   `result.record?.patchPath === '/studio/build/fresh.tre'`;
   `result.record?.includeTargetPath === ctx.cfgPath` ('/client/swgclient.cfg' per `makeCtx`).
  </action>
  <verify>
    <automated>cd packages/renderer && npx vitest run src/services/syncLiveToVersion.test.ts</automated>
  </verify>
  <done>All syncLiveToVersion.test.ts cases (a-g) pass; the new case proves activatePatch never receives the literal 'patch.tre' or a basename-truncated path when ctx.freshPatchPath is supplied.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Route DeployDialog.handleDeploy (Baseline-revert, loose-override, absolute-path) through syncLiveToVersion</name>
  <files>packages/renderer/src/panels/deploy/DeployDialog.tsx</files>
  <action>
In `packages/renderer/src/panels/deploy/DeployDialog.tsx`, import `syncLiveToVersion`
and the `ReconcileCtx` type from `'../../services/syncLiveToVersion.js'`. Add a small
local helper inside `handleDeploy` (or just inline it each time — the three call sites
below all need the same shape) that builds a `ReconcileCtx`:
`{ manifest, studioDir, cfgPath: selectedClient!.cfgRootPath, installRoot: selectedClient!.installPath, priorLiveLooseRecord }`
where `priorLiveLooseRecord` is `deployRecordRef.current` cast to `LooseDeployRecord`
ONLY when `'overrideDir' in deployRecordRef.current` is true, else `undefined`. Per the
"Watch out" note, `cfgPath` MUST be `selectedClient.cfgRootPath` — NEVER
`selectedClient.installPath` or `useWorkspaceStore.getState().clientPath` (the EISDIR
bug from CONSULT-VG-01).

Replace the three branches as follows (all three currently duplicate apply/revert
logic that `syncLiveToVersion` already owns):

1. **H1 Baseline/empty-flatten block** (the block starting at the
   `manifest.activeVersionId === BASELINE_ID || flattenedEntries.length === 0` check):
   keep reading `existingRec = deployRecordRef.current` and computing `rootCfgPath`
   exactly as today (still needed for the UI's `cfgPath` field in the `'done'` phase).
   Replace the two hand-rolled revert code paths (the `'overrideDir' in existingRec`
   branch calling `resetLoose` directly, AND the snapshot-restore + toolkit-cfg-unlink
   + patch-unlink fallback branch below it) with a single
   `await syncLiveToVersion(manifest.activeVersionId, ctx)` call wrapped in try/catch.
   On success: set `deployRecordRef.current = null`, `setHasPriorDeployment(false)`,
   `setPhase({ kind: 'done', slot: 'Baseline (reset to stock)', cfgPath: rootCfgPath })`.
   Keep the existing best-effort `clearChangesetDeployRecord(carrier)` bookkeeping call
   (still safe/idempotent) — but DELETE the manual `setDeployedVersion(null)` call:
   `syncLiveToVersion` already moves BOTH `activeVersionId` and `deployedVersionId` to
   the target via its own `setLiveVersion` call (D-08 single-pointer invariant); calling
   `setDeployedVersion(null)` afterward would desync the two pointers. On failure, set
   `phase: { kind: 'error', step: 'activate', message, cfgRestored: false }` (Baseline
   revert has no separate "build" step to fail).

2. **Loose-override apply block** (`if (deployModel === 'loose-override')`): keep BOTH
   pre-flight guards exactly as-is (the `!resolvedOverrideDir` early-return, and the W1
   override-dir-priority guard via `resolveClientMountOrder` — these are dialog-owned
   validations, not engine work). Replace the `deployLoose(...)` call plus the
   subsequent `deployRecordRef.current = record; setLiveVersion(...); updateChangesetDeployRecord(...)`
   trio with: `const result = await syncLiveToVersion(manifest.activeVersionId, ctx);`
   then `deployRecordRef.current = result.record ?? null;` (the engine already calls
   `updateChangesetDeployRecord` and `setLiveVersion` internally — do not call them
   again from the dialog). Set `phase: { kind: 'done', slot: 'override-dir', cfgPath: resolvedOverrideDir }`
   on success, keep the existing catch → `phase: { kind: 'error', step: 'activate', ... }`.

3. **Absolute-path apply block** (the final branch, D-05 default): keep Steps 1-2
   EXACTLY as today — (Step 1) create/truncate `swgtoolkitCfgPath` empty via
   `fs.mkdirSync` + `fs.writeFileSync(swgtoolkitCfgPath, '')` (this must happen before
   the engine's `activatePatch` call, which requires the file to already exist), and
   (Step 2) `snapshotCfg(selectedClient!.cfgRootPath, studioDir)` capturing
   `absSnapshotPath` (must happen BEFORE `ensureInclude` mutates the root cfg). Also
   keep `packPatch(flattenedEntries, outputPath)` from earlier in `handleDeploy`
   unchanged — the patch must be built before the engine call. Replace Step 3 (the
   `scanSharedFile` + `activatePatch` + `ensureInclude` + `deployRecordRef.current = record`
   + `setLiveVersion` + `updateChangesetDeployRecord` sequence) with:
   `const result = await syncLiveToVersion(manifest.activeVersionId, { ...ctx, freshPatchPath: outputPath, freshSnapshotPath: absSnapshotPath });`
   then, ONLY on success, `ensureInclude(selectedClient!.cfgRootPath, swgtoolkitCfgPath)`
   (the engine does not call `ensureInclude` — this remains a dialog-owned step, same as
   today) and `deployRecordRef.current = result.record ?? null;`. Set
   `phase: { kind: 'done', slot: (result.record as CfgDeployRecord | undefined)?.keyName ?? 'deployed', cfgPath: swgtoolkitCfgPath }`.
   Keep the existing catch block's H5/M9 auto-rollback (`restoreCfg(selectedClient.cfgRootPath, absSnapshotPath)`
   on failure) — the engine can still throw (e.g. `activatePatch` I/O failure), and the
   rollback UX must survive that.

Remove now-dead imports from the top of the file: `activatePatch` (no longer called
directly anywhere in this file — `deactivatePatch`, `ensureInclude`, `snapshotCfg`,
`restoreCfg`, `getToolkitCfgPath` are all still used by `handleReset` or the flows
above) and `deployLoose` (no longer called directly — `resolveOverrideDir` and
`resetLoose` are still used elsewhere). Leave the hardlink-shadow branch
(`deployModel === 'hardlink-shadow'`) UNTOUCHED: `syncLiveToVersion` has no shadow-model
dispatch (H4 only covers 'loose' | 'cfg' by design — see the file's own header comment),
and the todo's acceptance criteria only ban inline `deployLoose`/`activatePatch` calls,
not `deployShadowBase`.
  </action>
  <verify>
    <automated>cd packages/renderer && npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>handleDeploy contains zero direct calls to deployLoose or activatePatch; the Baseline-revert, loose-override, and absolute-path branches each call syncLiveToVersion; typecheck is clean (ignoring pre-existing packages/backend/preload.ts errors).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Rewire VersionHistoryBody's Undo to restore the prior deployed state; add DeployDialog engine-call test</name>
  <files>packages/renderer/src/panels/deploy/VersionHistoryBody.tsx, packages/renderer/src/panels/deploy/DeployDialog.test.tsx</files>
  <behavior>
    - DeployDialog test: clicking "Deploy patch" (or "Deploy Baseline (revert to stock)")
      with a bound/selected client calls the mocked `syncLiveToVersion` with
      `(manifest.activeVersionId, expect.objectContaining({ cfgPath: <selectedClient.cfgRootPath>, installRoot: <selectedClient.installPath> }))`,
      and neither `activatePatch` nor `deployLoose` is called.
    - VersionHistoryBody: `handleUndo`, when a client is bound (`useWorkspaceStore.getState().clientPath` non-null),
      calls `syncLiveToVersion(snapshot.priorLiveVersionId, ctx)` with a `ctx.cfgPath`
      resolved the same way DeployDialog resolves it on open (`resolveLayout(clientPath)?.cfgFile ?? 'swgemu.cfg'`
      joined onto `clientPath`), NOT a plain `doSelect` (selection-only) call.
    - VersionHistoryBody: `handleUndo`, when NO client is bound, falls back to the prior
      `doSelect(snapshot.priorLiveVersionId)` behavior (there is no live client to
      reconcile against — this is a genuine, honest degraded path, not scope reduction).
  </behavior>
  <action>
In `packages/renderer/src/panels/deploy/VersionHistoryBody.tsx`, add imports:
`path` from `'path'`, `resolveLayout` from `'../../services/clientLayout'`,
`syncLiveToVersion` + `type ReconcileCtx` from `'../../services/syncLiveToVersion'`.
Rewrite `handleUndo` (currently `undo(); doSelect(snapshot.priorLiveVersionId)`): after
popping `snapshot` from `undo()`, read `clientPath = useWorkspaceStore.getState().clientPath`.
If `clientPath` is null, keep today's behavior unchanged
(`doSelect(snapshot.priorLiveVersionId)`) — no bound client means no live state to
restore. If `clientPath` is set, resolve `cfgFile = resolveLayout(clientPath)?.cfgFile ?? 'swgemu.cfg'`
and `cfgRootPath = path.join(clientPath, cfgFile)` (same fallback pattern
`DeployDialog`'s `useEffect` on open already uses), build a `ReconcileCtx`
(`manifest` from the store, `studioDir`, `cfgPath: cfgRootPath`, `installRoot: clientPath`,
`priorLiveLooseRecord: snapshot.priorDeployRecord && 'overrideDir' in snapshot.priorDeployRecord ? snapshot.priorDeployRecord as LooseDeployRecord : undefined`),
and `await syncLiveToVersion(snapshot.priorLiveVersionId, ctx)` inside a try/catch
(log-and-continue on failure — Undo must never crash the panel; `console.error` matches
the existing `doSelect` catch style). `handleUndo` is already `async` — keep it that
way; the `void handleUndo()` call sites (button onClick, Ctrl+Z listener) are unchanged.

In `packages/renderer/src/panels/deploy/DeployDialog.test.tsx`, add
`vi.mock('../../services/syncLiveToVersion', () => ({ syncLiveToVersion: vi.fn().mockResolvedValue({ noop: false, liveVersionId: null, model: 'cfg', record: undefined }) }))`
alongside the existing hoisted mocks, and import the mocked `syncLiveToVersion` for
assertions. Add a new test "Test 8: Deploy routes through syncLiveToVersion, not
activatePatch/deployLoose directly": set `useWorkspaceStore` state with a `studioDir`
and `workspaceName`; mock `detectClients` to return one `DetectedClient` fixture (e.g.
`{ name: 'Test Client', installPath: '/swg/client', cfgRootPath: '/swg/client/swgemu.cfg', treVersion: '0005' }`);
mock `readManifest` to return a manifest with `activeVersionId: 'cs-1'` and one
changeset `{ id: 'cs-1', label: 'v1', parentId: null, timestamp: ..., deltas: [] }`;
render `<DeployDialog open={true} onClose={() => {}} />`; click the client radio row
(if not auto-selected) then click the "Deploy patch" button; `await` a microtask flush
(`await screen.findByTestId(...)` or `await waitFor(...)` per existing test-file
conventions) and assert `syncLiveToVersion` was called with
`('cs-1', expect.objectContaining({ cfgPath: '/swg/client/swgemu.cfg', installRoot: '/swg/client' }))`,
and that the mocked `activatePatch` and `deployLoose` were NOT called.
  </action>
  <verify>
    <automated>cd packages/renderer && npx vitest run src/panels/deploy/DeployDialog.test.tsx</automated>
  </verify>
  <done>New DeployDialog test proves syncLiveToVersion is called with the correct ctx and that activatePatch/deployLoose are not; VersionHistoryBody's handleUndo calls syncLiveToVersion when a client is bound and falls back to doSelect only when none is bound; full renderer suite (npx vitest run in packages/renderer) stays green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| renderer → local filesystem | `syncLiveToVersion` and its callers (DeployDialog, VersionHistoryBody) read/write the real SWG client's cfg files and TRE archives on disk based on manifest data the same renderer process wrote earlier. No network/remote input crosses this boundary in this change. |
| DeployDialog UI → ReconcileCtx | `ctx.cfgPath`/`ctx.installRoot` are sourced from `DetectedClient` (auto-detected or user-Browse'd), not from arbitrary/attacker-controlled input. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260703-01 | Tampering | `syncLiveToVersion` cfg-apply patchName | mitigate | Task 1 removes the silent `'patch.tre'` placeholder fallback path for fresh deploys by threading `ctx.freshPatchPath` through — prevents the engine from ever writing a searchTree key pointing at a file that does not exist. |
| T-260703-02 | Repudiation/Info-loss | Undo restoring the wrong prior state | accept | `syncLiveToVersion` already pushes an undo snapshot before every mutation (including one triggered by Undo itself), so an Undo-of-Undo is possible via the same stack (redo-by-another-name) — no data is lost, worst case is an extra manual re-deploy. |
| T-260703-03 | Denial of Service | `ctx.cfgPath` pointed at the install DIR instead of the cfg FILE (EISDIR) | mitigate | Both DeployDialog and VersionHistoryBody build `ctx.cfgPath` exclusively from `DetectedClient.cfgRootPath` / `resolveLayout(...).cfgFile` joined onto the install path — never from `clientPath`/`installPath` alone (per CONSULT-VG-01 finding, now enforced at both call sites, not just one). |
</threat_model>

<verification>
- `cd packages/renderer && npx vitest run` — full suite green (269+ tests, including the new/updated syncLiveToVersion and DeployDialog cases).
- `cd packages/renderer && npx tsc --noEmit -p tsconfig.json` — clean (ignore pre-existing packages/backend/preload.ts errors, per project convention).
- Manual grep check: `grep -n "deployLoose(\|activatePatch(" packages/renderer/src/panels/deploy/DeployDialog.tsx` shows zero calls inside `handleDeploy` (only the now-removed-import lines should be absent entirely; any remaining hits should be in `handleReset`, which is out of scope for this change and does not call either).
</verification>

<success_criteria>
- Deploying from the dialog (absolute-path or loose-override model) and reverting to Baseline both go through `syncLiveToVersion`.
- After a deploy, the Undo affordance appears in `VersionHistoryBody` and clicking it restores the prior deployed state on the client (when a client is bound), not merely the selection.
- No inline `deployLoose`/`activatePatch` calls remain in `DeployDialog.handleDeploy`.
- `syncLiveToVersion` tests (a-g) keep passing; a new `DeployDialog` test asserts the engine is called with the correct `ReconcileCtx`.
</success_criteria>

<output>
Create `.planning/quick/260703-bpu-route-deploydialog-deploys-through-syncl/260703-bpu-SUMMARY.md` when done
</output>
