# Your angle: LINE-LEVEL TYPE/WIRING VERIFIER (Cursor) — round 4

Read `.planning/research/CONSULT-05.1-R4-PREAMBLE.md` first for the neutral evidence and ground truth.

You are the most detailed code reader. Your job: verify the R1/R6/R8/R9 fixes actually TYPE-CHECK and wire
correctly against the REAL referenced source files (not the plan's prose). Read the actual files listed under
"Ground truth" in the preamble and diff the plans' claimed signatures/fields against them line-by-line.

Verify each, citing real `file:line`:

1. **R8/M2 (`clientLabel`)** — Plan 10. Does it use `useLiveStore((s) => s.clientLabel)` and NOT
   `liveStatus.clientLabel`? Confirm against `liveStore.ts`: `clientLabel` is a top-level store field, and the
   `attached` union has no `clientLabel`. Any residual `liveStatus.clientLabel` is a real `tsc` error.

2. **R8/M3 + R9 (`resolveScanRoot`)** — Plan 04. Its revised signature/return (`string | null`) and the
   `cfgPath===undefined` guard before `resolveOverrideDir(cfgPath: string, …)`. Confirm against
   `looseOverrideDeploy.ts:47` that `cfgPath` is non-optional and the guard prevents passing `undefined`.
   Confirm all four `string`-typed consumers (`makeReadVfs`, `reconcileMirrorMode`, `refresh`, `removeDecorationRow`)
   have a specified null branch.

3. **R1 (`reconcileMirrorMode`)** — Plan 06. Confirm the two-arg `scanWorldEditorState` call, the
   `readWorkspaceJson(studioDir).worldEditorBuildingTemplates ?? {}` read, and a concrete fail-closed `failures`
   entry for `buildingTemplateVfsPath === ''`. Check the `<interfaces>` block matches.

4. **R6** — Plan 06: `updateWorkspaceMeta(... mirrorToStockIlf ...)` is now gated on `failures.length === 0`.
   Plan 10: the failure is durably surfaced (history entry + visual revert), not just `log('warn')`.

5. **R11** — Plan 02: `worldEditorBuildingTemplates?` is OUTSIDE the "current WorkspaceBindingMeta" quote (it's
   a Task-1 addition), and the count reads "three" new fields. Confirm against `workspace.ts` that the field does
   not exist yet today.

Report any line that would fail `tsc --noEmit` or wire to a non-existent field/signature. If all four fixes
type-check clean against the real files, say **CONVERGED on line-level wiring**.
