# YOUR ANGLE (Sonnet): lateral — NEW seams the W1–W5 fixes' OWN interactions may have opened

You found both round-4 HIGHs on exactly this axis (the round-3 fixes interacting with each other). Do it
again for the round-5 fixes. Do NOT re-litigate W1–W5 as filed — assume the named fixes landed as described
in the preamble; hunt for what their INTERACTIONS newly break. Non-exhaustive probes (follow your own nose
too):

1. **Two-phase reconcile × concurrent mutation:** W1 makes `reconcileMirrorMode` validate-all-then-write with
   rollback-by-inverse. What happens if a persist (HUD save), a Remove, or an ADD lands between the validate
   pass and the write pass, or between a failed write and its rollback? Is there any lock/serialization story
   in the plans, and if not, is the resulting corruption reachable in practice given the UI flows?
2. **Rollback-by-inverse × mirror reality:** the rollback inverts completed writes. If the inverse operation
   itself fails (disk full, file locked by the running game client — a REAL condition here since the client
   mounts these files), what state does the flag + disk end in, and does the Plan 10 "atomic, never-partial"
   history wording become a lie?
3. **`onUndoComplete` → `refreshTree()` × removeUndoStore:** does the refresh triggered by Undo re-entrantly
   interact with the undo store's own state (toast dismissal, pending-undo window, badge reconciliation in
   Plan 04's `refresh()`)? Can a user double-fire Undo during the refresh?
4. **Content-identity "(NEW)" × duplicate rows:** the count-diff key is
   `buildingId+cellName+objectTemplateName`. Two identical decorations in the same cell (same template) are a
   normal decorating pattern. Walk ADD, Remove, Undo, and mixed sequences over duplicate rows: does the
   count-diff ever mislabel or miss a "(NEW)"? (Round 4 probed collisions for Plan 04's badges and found it
   disclosed — this probe is specifically the NEW count-diff consumer in Plan 14.)
5. **`resolveOverridePair()` single-guard × time-of-check:** all three consumers now resolve through one
   helper — called when? If the pair is resolved once and cached by the panel while the project binding
   changes (project switch, mount change mid-session), do the three consumers now share one STALE resolution
   where before they each failed independently?

Files: `.planning/phases/05.1-live-world-editor-productization/*-PLAN.md` (esp. 04, 06, 10, 13, 14, 15),
`05.1-CONTEXT.md` (D-01–D-14), the diff `git diff 07958ef..667225f`. Severity-rank findings; concrete
defect + minimal fix each. If the interactions are genuinely clean, say CONVERGED on the lateral axis.
