# YOUR ANGLE (Cursor): line-level type/wiring check of the W1–W5 fixes against the REAL source files

Working directory: D:\Code\SWG-Toolkit. Read the preamble context below first, then execute this task.

Check the round-5 amendments (`git diff 07958ef..667225f`) at the type/signature level against the actual
`.ts`/`.tsx`/`.cpp` files on disk — not against what the plans say the files contain.

1. **W3 fix (`resolveOverridePair()`):** read the Plan 10/13 task text describing the helper. Against the
   real signatures — `resolveOverrideDir(cfgPath: string, installRoot?)` in
   `packages/renderer/src/services/looseOverrideDeploy.ts` and whatever `resolveScanRoot`/`makeReadVfs`
   actually accept in the real files — does the helper as specced actually close the `string | null` →
   `string` type error the round-4 Cursor found? Does the specced return shape let all three consumers
   (refresh / mirror toggle / Remove) type-check?
2. **W2 fix:** `RemoveUndoToast` `onUndoComplete` prop — is the prop threading as specced consistent with the
   component tree the plans describe (who owns `refreshTree`, who renders the toast)? Any React-level problem
   (stale closure over `refreshTree`, toast surviving a tree remount) the spec text papers over?
3. **W5 citations (verify against the real files, exact lines):** `useChannelReader.ts:272` and
   `LiveSyncClientCard.tsx:159` for `clientLabel`; `overlay.cpp:443` for the `channelWriteCapture` call site.
   Confirm each cited line actually contains what the plan claims, or give the correct line.
4. **W1 fix:** the two-phase `reconcileMirrorMode` spec in Plan 06 — check its described file operations
   against the real persist/deploy code paths (`decorationPersist.ts`, `looseOverrideDeploy.ts`): are the
   inverse operations it plans for rollback actually expressible with the file APIs those modules use today
   (copy/rename/delete), or does the rollback assume a primitive that doesn't exist?
5. Any OTHER type/wiring mismatch the diff introduces against the real source (imports, store selectors,
   union shapes) — line-precise, minimal-fix.

Cite real-file path:line for every claim.
