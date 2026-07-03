# Angle A (Codex — call-graph tracer): WHY does selecting a version fail? (symptom S1)

Read the LOCKED ground truth in `.planning/research/CONSULT-VG-00-GROUND-TRUTH.md` first.

You are the repo tracer. Do NOT theorize about UX. Trace the EXACT runtime call path and report,
as facts from the code, WHERE and WHY selecting a non-baseline version fails to move the pointers.

Trace, in `packages/renderer/src`, starting from `VersionHistoryBody` row `onClick`:
1. handleRowClick → doReconcile → syncLiveToVersion → … → setLiveVersion. Quote each hop (file:line).
2. For a CLIENT-bound project where the target version has NO stored `deployRecord` and was never
   packed into a `.tre`: walk `syncLiveToVersion`'s cfg-apply branch line by line. Identify EVERY
   call that can throw or early-return before `setLiveVersion(targetId)` runs. In particular:
   - What is `ctx.cfgPath` at runtime (fact #3)? Is it a directory or a `.cfg` file?
   - What does `scanSharedFile(cfgPath)` do when given a directory (fact #4)? Does it throw? What error?
   - Does `activatePatch` require the patch `.tre` to exist? Does it throw if absent?
3. Confirm whether `doReconcile` (in VersionHistoryBody) catches errors from `syncLiveToVersion`. If it
   does not, what happens to `activeVersionId`/`deployedVersionId` and the UI selection?
4. Report the precise failure chain as a numbered list of file:line facts, and state the single
   root cause (or causes) that leaves selection stuck on baseline.

Do not propose the fix's code — just prove the failure path with citations. If the path does NOT throw
(i.e. selection SHOULD move), say so and identify what else would prevent the pointer/highlight update.

Output: prose + file:line citations. Read-only.
