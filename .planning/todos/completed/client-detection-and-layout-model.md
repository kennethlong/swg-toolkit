---
id: client-detection-and-layout-model
title: Client detection + layout is release-specific — pattern-detect across installs, allow manual override
created: 2026-06-27
origin: Maintainer UAT note — "swgemu.cfg is not the definitive way to detect a client; some releases have client.cfg, etc. … look at all the installed versions, figure out the patterns, and allow override by entering the actual config file path/name."
severity: high (blocks reliable deploy across clients; hardcoded assumptions already broke a UAT deploy)
area: renderer / clientLocator + DeployDialog (client detection + layout)
status: done
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

## A THIRD client class — the dev/modder "decoupled binary + external TRE set" (verified 2026-06-28)

`swg-client-v2` (SWG Source client) is a fundamentally different layout, and the maintainer flags it as
**how devs/modders actually work**: the runnable client and the game data are **separate dirs**.

- **Binary dir** = `D:\Code\swg-client-v2\stage-x64\` — `SwgClient_r.exe` + dlls + `client.cfg`, and
  **ZERO `.tre` files**.
- **Data** = a *different* install `D:\Code\SWGSource Client v3.0\` (131+ TREs + `.toc` indexes),
  referenced by **absolute path** from the cfg. One data set can back many stage clients.
- `client.cfg` is **machine-generated** (`tools/setup/setup-client.ps1` from `client.cfg.template`,
  `@TRE_ROOT@`/`@OVERRIDE_PATH@` tokens) — **do NOT hand-edit the staged copy** (regen clobbers it).

### Verified `[SharedFile]` mount mechanisms (see memory `reference-swg-client-mount-mechanisms`)
The engine mounts via THREE key families per priority (TreeFile.cpp:118-148), not just `searchTree`:

| Key | Mounts | swg-client-v2 use | Priority |
|---|---|---|---|
| `TOCTreePath=` | dir prefix prepended to `.tre` names found inside `.toc` files | `D:/Code/SWGSource Client v3.0/` | — |
| `searchTOC_NN_P` | a **`.toc` master index** (lists 131 TREs + 193k path index) | base game, 4 sku indexes (gated by `gameFeatures` bits) | 0–3 |
| `searchTree_NN_P` | one individual `.tre` overlay | snow-disable, swgsource overlay | 7, 8 |
| `searchPath_NN_P` | a **loose-file directory** overlay | `stage/override` ← modder iterate loop | 10–11 (top) |
| `maxSearchPriority` | bounds which priority slots are read | 12 | — |

Precedence: higher P wins; same-P ties → later-added wins (`clientSearchOrder.ts` already correct for
the searchTree subset).

### Concrete toolkit gaps for this class
1. **Detection** (`clientLayout.ts`): no `client.cfg` row → `resolveLayout` returns null. Add a layout
   entry (cfg=`client.cfg`, treSubdir resolved from cfg, not a fixed folder).
2. **Mount** (`clientSearchOrder.ts`/`treAutoMount.ts`): parses **only `searchTree`** → for
   swg-client-v2 it finds just the 2 overlay TREs and **misses the entire 131-archive base** (loaded via
   `searchTOC`) and the `searchPath` dirs. Must learn `searchTOC` (read the `.toc` master index — the
   blender plugin's `tre_reader.parse_master_index` already does this; native side needs equivalent) +
   `TOCTreePath` prefixing + `searchPath` loose dirs. Until then the toolkit can't fully browse this client.
3. **Deploy**: the patch-prepend/`.include` model fights a generated cfg + low maxSearchPriority + a
   slot-chooser blind to searchTOC/searchPath priorities (would pick a colliding/too-low slot).
   → Add a **"deploy into the loose `searchPath` override dir"** mode: write the edited files straight
   into the top-priority `searchPath` dir (no TRE pack, no cfg surgery, survives regen). **This is the
   cleanest deploy of all and IS the lazy/virtual-shadow thesis** (`product-thesis-shadow-sandbox-and-server-push`).

### PROVEN end-to-end 2026-06-28
Retextured the space terminal on swg-client-v2 by dropping an edited `.dds` into
`stage\override\texture\ksk_all_spaceterminal.dds` (the `searchPath_00_10/11` override dir) — appeared
in-game. So the override-dir deploy path is validated; the toolkit just needs to drive it.

## Severity

High — client detection/layout is foundational to deploy working at all on arbitrary installs. The
hardcoded assumptions have already broken one UAT deploy. Real pattern-detection + manual override
should land with the deploy/shadow rework. The dev/modder decoupled-client class (above) is now a
first-class target, not an edge case — it's the standard dev workflow and the natural home for the
loose-override deploy mode.

## Resolution (2026-07-03 triage)

Resolved by 04.1-09 (clientLayout detection table + manual cfg/TRE-dir override, D-13) and 04.2-02 (client.cfg / treDirFromCfg swg-client-v2 layout row).
