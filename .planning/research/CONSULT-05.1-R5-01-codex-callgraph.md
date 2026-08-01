# YOUR ANGLE (Codex): call-graph trace of the W1–W3 fixes across ALL consumers

Working directory: D:\Code\SWG-Toolkit. Read the preamble context below first, then execute this task.

Trace every touched shared element of commit `667225f` through ALL 15 plans (not just the plans the
work-list named). For each element, enumerate every plan/task that produces, consumes, or describes it, and
verify each site agrees with the new contract:

1. **`reconcileMirrorMode` (two-phase validate-then-write + rollback-by-inverse):** find every call site and
   every prose description across the 15 plans. Does any site still describe/assume the old single-pass
   behavior? Does the Plan 10 mirror-toggle consumer and the Plan 15 step-11 live-verify agree with the new
   two-phase contract (including the `{failures}` return shape and the flag-persist-only-when-zero-failures
   rule from R6)?
2. **`resolveOverridePair()` (new shared helper, Plan 10):** enumerate EVERY disk-touching action in the plan
   set that resolves an override dir/pair (refresh, mirror toggle, Remove, Undo re-add, ADD append, editor-scene
   ops, anything in Plans 04/06/08/12/13/14). Which route through the helper, which resolve inline? Any
   remaining `string | null` → `string` flow the helper was supposed to close?
3. **`refreshTree()` + `onUndoComplete`:** enumerate every mutation path that should refresh the tree
   (persist result, Remove, Undo, ADD confirm, mirror toggle, scene reload). Which call `refreshTree()` after
   completion, which don't, and is any non-caller a real staleness hole (vs covered by the store's own
   reconciliation)?
4. **The "(NEW)" content-identity marker (Plan 14):** trace the marker's producer and every consumer
   (World-panel row render, two-surface ADD confirm, Plan 15 step 8). Same identity key everywhere
   (`buildingId+cellName+objectTemplateName` count-diff)? Any site still describing positional row-id?
5. **Dependency graph:** confirm the wave/`depends_on` math still holds after the amendments (acyclic; every
   wave = max(dep waves)+1; Plan 10's new helper doesn't create an undeclared cross-plan dependency from
   Plan 13 — check how Plan 13 gets access to `resolveOverridePair` given it's defined in Plan 10's files).

Use `git diff 07958ef..667225f -- .planning/phases/05.1-live-world-editor-productization/` to scope what
changed; use grep across all 15 plans for the consumer enumeration. Cite plan file + line for every claim.
