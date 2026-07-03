---
id: deploy-dialog-synclive-undo-wiring
title: Route DeployDialog.handleDeploy through syncLiveToVersion (dedupe apply logic + re-wire Undo)
created: 2026-07-03
origin: Crew consult CONSULT-VG-03 (Sonnet) during the select-vs-deploy decoupling — flagged as the
  pre-existing gap the old navigate=deploy model papered over.
severity: medium (Undo is currently dormant; deploy logic is duplicated)
area: renderer / DeployDialog + syncLiveToVersion + undoStore
status: pending
related: version-navigation-live-sync-deploy-model
---

## Problem

With navigation decoupled from deploy (2026-07 crew consult; row click = `selectVersion`, no client
mutation), `syncLiveToVersion` is no longer called from anywhere in the UI:

- `DeployDialog.handleDeploy` does NOT call `syncLiveToVersion` — it re-implements the apply/revert
  steps inline (`deployLoose` / `activatePatch` / `restoreCfg` / `setLiveVersion` directly,
  DeployDialog.tsx ~:462-600).
- `syncLiveToVersion` is the ONLY place undo snapshots are pushed (`useUndoStore.push`,
  syncLiveToVersion.ts ~:170). Since navigation no longer calls it and DeployDialog never did,
  **nothing pushes undo snapshots** → the Undo bar/Ctrl+Z in VersionHistoryBody is dormant.

## Fix

Route `DeployDialog.handleDeploy`'s reconcile through `syncLiveToVersion(targetId, ctx)`:
- Dedupe: the dialog keeps seal/naming/progress/error UI; the actual apply/revert/restore moves to
  the one engine (which already handles loose/cfg cross-model, Baseline restore, H4 dispatch).
- Build ctx with the REAL cfg file path (workspace `cfgPath` contract field, contracts/workspace.ts:47)
  — NOT `clientPath` (the install dir). That mistake is what broke navigation (EISDIR — Codex trace
  CONSULT-VG-01).
- Undo comes back for free: syncLiveToVersion pushes the snapshot; VersionHistoryBody's Undo then
  means "revert the last deploy" (select prior version; user re-deploys explicitly, or the undo
  handler can invoke the deploy engine directly — decide during implementation).

## Acceptance

- Deploying from the dialog and reverting to Baseline both go through syncLiveToVersion.
- After a deploy, the Undo affordance appears and restores the prior deployed state.
- No inline deployLoose/activatePatch calls remain in DeployDialog.
- syncLiveToVersion tests keep passing; add a DeployDialog test asserting the engine is called.
