# Deferred Items — Phase 05 (wysiwyg-live-sync-typed-editors)

Out-of-scope discoveries logged during plan execution, per the executor's Scope Boundary rule.
Not fixed as part of the plan that discovered them.

## 05-11: `test/gitLfs.test.ts` intermittent failure (pre-existing, unrelated to 05-11)

- **Found during:** 05-11 Task 1/2/3 verification runs (`pnpm --filter renderer test`).
- **Symptom:** `Test 3b (B8 fix) — staging a .dds binary converts it to an LFS pointer; cat-file
  confirms` intermittently fails with `git-lfs not found — .gitattributes written without LFS
  routing` and a raw-binary blob instead of an LFS pointer.
- **Scope:** `test/gitLfs.test.ts` is untouched by 05-11 (`git log`/`git status` confirm zero
  05-11-session modifications to this file). It belongs to Phase 04.1 (DEPLOY-04 Git/LFS
  workspace) and depends on a real `git-lfs` binary being resolvable on PATH at test time.
- **Reproduction:** Flaky, not deterministic — the SAME suite run (`pnpm --filter renderer test`,
  no changes between runs) failed once and passed on the immediately-following re-run with
  identical code. Consistent with an environment/PATH-resolution race for the `git-lfs` binary
  during the sandboxed test session, not a code regression.
- **Action:** Not fixed (out of scope for 05-11 — the plan's own files_modified list does not
  include this file, and the failure is pre-existing/environmental, not caused by any 05-11
  change). Left for a future session with a stable git-lfs install to investigate if it recurs
  persistently.
