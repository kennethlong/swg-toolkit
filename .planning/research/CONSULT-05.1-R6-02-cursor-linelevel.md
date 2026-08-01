# YOUR ANGLE (Cursor): line-level type/wiring check of the V-fixes against the real source files

Working directory: D:\Code\SWG-Toolkit. Read the preamble context below first, then execute this task.

The six revised plans (04, 06, 10, 13, 14, 15) prescribe concrete code against real files in this repo.
Your job is line-level: open the actual `.ts`/`.tsx`/`.cpp` files each plan cites and verify the planned
code would actually type-check and wire correctly against what exists TODAY. Do not review architecture —
review types, signatures, imports, and line citations.

1. **Plan 13's Undo pipeline vs real stores:** the plan has `WorldPanel.tsx` call
   `resolveOverridePair()`, then `restore(id)`, then an add-back helper. Check the real
   `packages/renderer/src/state/` stores it names (the world/decoration trash store the `restore(id)`
   comes from — does that store/method exist today or is it created by an earlier plan? If created,
   which plan/task declares it, and do the signatures match?). Check the narrowed status read
   `st.kind === 'attached' ? st.mappingName : null` against `liveStore.ts:26-31`'s actual union.
2. **Plan 10's `resolveOverridePair()`:** verify the planned selector usage against the real
   `workspaceStore.ts` shape (`studioDir: string | null` at line 34; how selectors are actually consumed
   elsewhere in the codebase — cite one real precedent). Verify `readWorkspaceJson` exists (where?) and
   its real signature tolerates the planned guard ordering.
3. **Plan 06's mirror-path rollback:** against the real `decorationPersist.ts` (esp. lines ~199-203
   per-TEMPLATE mirror write): does grouping by resolved stock mirror path match how the mirror path is
   actually constructed (`path.join(deps.overrideDir, stockIlfVfs)`)? Is the `'deleted'`-branch
   read-before-unlink plan implementable with the file APIs the service actually uses (sync/async, which
   fs wrapper)?
4. **Plan 14's diff effect:** `useEffect(..., [tree])` keyed on the tree state reference — check how
   `tree` state is actually produced in the real `WorldPanel.tsx` (or, if WorldPanel is created by an
   earlier plan in this phase, the plan that creates it): does every planned `refreshTree()` produce a
   NEW reference (i.e., is referential-inequality guaranteed on every refresh, including no-change
   refreshes)? Flag if any planned code path does `setTree` with a same-reference value.
5. **Citation byte-check:** every file:line citation in the `git diff 7f5baca..3d0a605` plan text that
   names a REAL existing file (not a to-be-created file) — open the file, verify the cited line says what
   the plan claims. Note the `DeleteUndoToast.tsx` real path is `panels/deploy/`.

Cite real-file path + line for every verdict. Where a plan cites a to-be-created file, verify instead
against the plan that creates it (interface blocks), and say which plan/line you checked.
