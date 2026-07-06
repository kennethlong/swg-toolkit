---
id: e2e-leaked-temp-studios
title: E2E runs leak swg-toolkit-e2e-* studio dirs into the real LOCALAPPDATA studios root
created: 2026-07-06
origin: Noticed while enumerating studios for the D-22 server binding — ~12 stale `swg-toolkit-e2e-13-{cfg,loose}-client-*` studio dirs from 04.4-13 runs.
severity: low (cosmetic/pollution; no functional impact, but they appear in the app's project list scans and bloat the studios root over time)
area: e2e specs (07-deploy-flow, 06-delete-flow fixtures) / test cleanup
status: pending
---

## Problem

`e2e/07-deploy-flow.spec.ts` (and possibly 06) create studios keyed off temp-dir fixture names
(`swg-toolkit-e2e-13-cfg-client-<rand>` etc.) in the REAL `%LOCALAPPDATA%\swg-toolkit\studios`
root, and afterAll cleanup evidently misses them (04.4-14's spec verified ITS cleanup; the 13
spec's studios remain). ~12 stale dirs present on the maintainer's machine as of 2026-07-06.

## Wanted

- Point e2e runs at an isolated data root via `SWG_TOOLKIT_DATA_ROOT` (workspaceService already
  reads it) so they never touch the real studios root — strictly better than best-effort afterAll.
- One-time cleanup of the existing stale `swg-toolkit-e2e-*` studio dirs.
