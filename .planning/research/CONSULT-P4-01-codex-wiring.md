# CONSULT P4-01 — Codex — Phase 4 plan↔real-code wiring audit

You are reviewing IMPLEMENTATION PLANS (not code yet) for an SWG modding toolkit's "Edit & Deploy
Loop" phase. Your job: trace the plans' assumptions against the ACTUAL existing code in this repo and
the reference projects, and report where a plan would NOT compile / NOT wire / cite a non-existent
symbol or signature. You are the integration-correctness oracle. Do NOT rubber-stamp; find the breaks.

## LOCKED ground-truth axioms (do NOT re-derive or contradict — treat as given)
- GT-4: The native addon ALREADY exports `buildTre(entries, version)` and `repackTre(sourcePath, edits, version)` (Phase 1). Entry shape = `{path, data?, tombstone?}`. See `packages/native-core/index.d.ts`.
- GT-5: `@swg/live-inject` has NO client-install/.cfg discovery — only `launchAndInject`/`attachAndInject`. A new `clientLocator` is required.
- GT-1: A deploy patch must be built `version='5000'` (live client mounts EERT5000).

## The plans to audit (read these)
- `.planning/phases/04-edit-deploy-loop/04-01-PLAN.md` ... `04-06-PLAN.md` + `04-06b-PLAN.md`
- Context/refs: `04-CONTEXT.md`, `04-PATTERNS.md`, `04-RESEARCH.md` (same dir)

## Your angle — verify against REAL code (cite file:line)
1. Does the REAL `buildTre` signature/entry shape in `packages/native-core/index.d.ts` match what
   `04-03` (packPatch) assumes (version string '5000' accepted? tombstone supported? ArrayBuffer vs
   Uint8Array)? Flag any mismatch.
2. Are the analog files the plans cite (`04-PATTERNS.md`: `liveStore.ts`, `VfsTree.tsx`,
   `ExportDialog.tsx`, `useLiveService.ts`, DockviewReact panel registration in WorkspaceShell, theme
   tokens) REAL and do the cited patterns actually exist as described? Name any that don't.
3. Cross-plan symbol wiring: do the contracts the plans add (`StagingEntry`, `DetectedClient`,
   `DeployModel`, `CfgInsertionRecord`, `SharedFileScan`, changeset manifest types) and the imports
   between `clientLocator`/`cfgActivator`/`packPatch`/`changesetService`/`DeployDialog` resolve? Any
   dangling import, wrong module, or type the plans reference but never define?
4. The store/service patterns: do the plans' Zustand store + plain-async-service shapes match the real
   `liveStore.ts`/`useLiveService.ts` conventions? Any place a plan would not compile against the real
   renderer (Path B) setup?
5. Build/wiring gotchas the plans miss: contracts rebuild step, DockviewReact panel registration, the
   renderer's actual import style for `@swg/native-core`.

Report concrete, cited findings (file:line). Rank by severity: BLOCKER (won't compile/wire) >
WARNING (works but wrong) > NIT. If a plan assumption is actually CORRECT against the code, say so
briefly — confirmation matters. Be specific; vague "looks fine" is not useful.
