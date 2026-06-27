---
id: client-detection-and-layout-model
title: Client detection + layout is release-specific — pattern-detect across installs, allow manual override
created: 2026-06-27
origin: Maintainer UAT note — "swgemu.cfg is not the definitive way to detect a client; some releases have client.cfg, etc. … look at all the installed versions, figure out the patterns, and allow override by entering the actual config file path/name."
severity: high (blocks reliable deploy across clients; hardcoded assumptions already broke a UAT deploy)
area: renderer / clientLocator + DeployDialog (client detection + layout)
status: pending
related: project-binds-and-automounts-client-tres, project-entry-point-and-shadow-redesign, product-thesis-shadow-sandbox-and-server-push
---

## Problem — the deploy code hardcodes client-layout assumptions that don't generalize

Real evidence from UAT (2026-06-27), across installed clients:

| Client | Config file | TRE location | maxSearchPriority |
|---|---|---|---|
| SWG Infinity (`D:\SWG Infinity\SWG Infinity`) | `swgemu.cfg` | **`Live/` subfolder** | 60 |
| SWGEmu (`D:\SWGEmu-Client\SWGEmu`) | `swgemu.cfg` | **install root** (no `Live/`) | 27 |
| (others, per maintainer) | **may be `client.cfg`, etc.** | varies | varies |

Hardcoded assumptions that have ALREADY caused failures:
1. **Config filename = `swgemu.cfg`** — `DeployDialog.handleBrowse` + `clientLocator` only look for `swgemu.cfg`. Maintainer: other releases use `client.cfg` etc. → detection misses them.
2. **TRE dir = `Live/`** — `DeployDialog` hardcoded `path.join(installPath, 'Live')` as the patch-copy
   destination. SWGEmu has NO `Live/` (TREs in root) → `copyFileSync` ENOENT, deploy failed.
   **Interim-fixed** (prefer `Live/` if it exists, else install root) to unblock UAT — but that's a
   heuristic, not real detection.

## Desired model (maintainer)

- **Pattern-detect across installed versions:** enumerate known client layouts (config filename, TRE
  directory, CWD, version family) rather than assuming one. Build a small table of release patterns
  (Infinity, SWGEmu, SWG Source/Legends, Restoration, …) and match the selected folder against them.
- **Manual override:** let the user enter the **actual config file path/name** (and likely the TRE
  directory) when auto-detection can't classify the install. Persist the override with the project's
  client binding.
- Surface what was detected (which pattern, cfg path, TRE dir) so the user can confirm/correct before
  deploying.

## Connection to the verified absolute-path finding

We verified absolute `searchTree` paths work (`project-binds-and-automounts-client-tres` §RESOLVED).
A future deploy that registers the patch by **absolute path** (no copy into the client) would sidestep
the `Live/`-vs-root question entirely — BUT note the ConfigFile **whitespace-truncation** constraint
(B6): an absolute path containing spaces (e.g. `D:\SWG Infinity\…`) truncates at the first space, so the
override `.tre` must live at a **whitespace-free absolute path** (reinforces `.studio` under a
space-free app root). The TRE-dir detection here is still needed for the copy-based path and for
locating the client's existing archives.

## Severity

High — client detection/layout is foundational to deploy working at all on arbitrary installs. The
hardcoded assumptions have already broken one UAT deploy. Real pattern-detection + manual override
should land with the deploy/shadow rework.
