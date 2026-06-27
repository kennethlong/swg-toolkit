---
id: centralize-ipc-channel-types
title: Centralize IPC channel types — per-file local casts let return types drift (caused a silent deploy bug)
created: 2026-06-27
origin: Maintainer UAT — Deploy "Browse" silently failed; root cause was a drifted local IPC type cast
severity: medium (latent-bug class; type-safety)
area: renderer ↔ main IPC (workspace:pick-dir / pick-file / etc.)
status: pending
related: e2e-deploy-flow-coverage
---

## Problem

Every renderer call site does its OWN local cast of `ipcRenderer`, e.g.
`require('electron') as { ipcRenderer: { invoke(channel: 'workspace:pick-dir'): Promise<...> } }`.
Because the cast is local and unverified against the main-process handler, the declared return type
can DRIFT from reality, and TypeScript can't catch it.

Concrete bug (2026-06-27): `workspace:pick-dir` main handler returns **`string[]`**
(`result.filePaths`, or `[]` if cancelled — `backend/src/main.ts:246`). `WorkspaceEntry.tsx` typed it
correctly (`string[]`), but `DeployDialog.tsx` typed it as **`string | null`** and treated the result
as a string → `[]` is truthy so the guard passed → `path.join(array, …)` threw → caught silently →
client never selected → **Deploy Patch button stayed disabled with no error.** Fixed in DeployDialog
(use `paths[0]` + surface the no-`swgemu.cfg` case), but the underlying drift hazard remains everywhere.

## Fix

Define IPC channel signatures **once** (a shared `ipc-contracts.ts` in `@swg/contracts` or a renderer
`ipc.ts` typed wrapper) and have every call site import that single typed `invoke` — so a handler/return
mismatch is a compile error, not a silent runtime failure. Audit existing channels (`workspace:pick-dir`,
`workspace:pick-file`, `tre:pick-archives`, any others) for the same drift.

## Severity

Medium — not a crash, but a whole CLASS of silent failures (this is the 3rd silent/typing bug found in
the deploy flow during UAT). A typed IPC boundary kills the class. Pairs with E2E coverage
(`e2e-deploy-flow-coverage`) which would have caught the symptom.
