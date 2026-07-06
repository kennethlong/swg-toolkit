---
id: server-binding-post-create-ux
title: No UI to add/edit a project's server binding after creation — wizard step 3 is the only entry point
created: 2026-07-06
origin: Maintainer question during 04.4-15 D-22 UAT — "do we have a run book or instructions on how to configure this path?" Binding had to be hand-edited into workspace.json.
severity: medium (Server Push section is invisible/unreachable for every pre-existing project; feature discoverability is near zero)
area: renderer / project lifecycle (VcsPanel Server Push section + workspace.json serverConfig)
status: pending
related: product-thesis-shadow-sandbox-and-server-push, vcs-panel-sketch-and-placement
---

## Problem — serverConfig is creation-time-only

`workspace.serverConfig` (type `core3-wsl2` | `swgsource-docker`, path, hostPort) is captured
ONLY in the New Project wizard's optional step 3 (D-01 capture-only). For an existing project
there is no UI: the maintainer had to hand-edit
`%LOCALAPPDATA%\swg-toolkit\studios\<id>\workspace.json` and reopen the project to make the
VcsPanel Server Push section appear at all.

## Wanted

- An "Add/edit server binding…" affordance reachable from an open project (natural home: the
  VcsPanel Server Push section itself — show a "Bind a server…" empty-state instead of rendering
  nothing when serverConfig is absent; that also fixes discoverability).
- Validate the path shape per flavor on entry (core3: `<path>/conf/config.lua` exists;
  swg-main: `<path>/exe/shared/servercommon.cfg` exists) — the same liveness pre-checks the push
  services already do, surfaced at bind time instead of first push.
- A short user-facing runbook doc (docs/05-server-integration/): bind → push → per-flavor reload
  semantics (Core3 restart-only; swg-main reloadTable) → reset. Today the only writeups are
  04.4-15-PLAN.md's how-to-verify and the Core3 WSL2 runbook outside this repo.

## Notes from the D-22 session (2026-07-06)

- Core3 UNC `\\wsl.localhost\Debian\home\kenny\workspace\Core3\MMOCoreORB\bin` verified reachable.
- swg-main VM at remembered IP 192.168.1.200 was NOT reachable (bridged IP drift or missing
  `cmdkey` SMB credential) — a bind-time validator would have surfaced this immediately.
