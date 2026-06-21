# Coverage Map — claimed source→doc mapping (VERIFY THIS)

This is our **claim** of how the original research transcript was distilled into `docs/`. It is
provided as neutral reference so a coverage audit can be efficient. **Your job is to find where this
map is WRONG or INCOMPLETE** — source content that has no doc home, was dropped, truncated, or altered.

- **Source:** `.planning/research/source-transcript.txt` (15,393 lines, ~88k words — an AI/Gemini research session). Large; read in line ranges, not all at once.
- **Distilled docs:** `docs/` (25 files). Index at `docs/README.md`.

The distillation intentionally REMOVED: conversational filler, "Would you like to… next?" trailers,
inline citation markers (`[1]`, `[2,3]`), and trailing citation-URL lists. Those are NOT misses.
A miss = substantive content: a code sample, a struct/field, an algorithm, a format detail, a design
decision, a constraint, a maintainer aside/goal, or a reference-project note that was lost or distorted.

| Source lines | Topic | Claimed doc |
|---|---|---|
| 1–11 | Reference-project list (local paths) | README.md, 00-overview/project-vision.md |
| 13–77 | SIE/JodelEngine context; Three.js capabilities overview | 00-overview/project-vision.md, architecture.md |
| 79–135 | Architecture & data flow; R3F ecosystem; perf pitfalls | 00-overview/architecture.md; 02-formats/meshes-and-appearances.md |
| 137–205 | Runtime vs offline pipeline; IFF intro; TRE decompress; DDS | 01-core-engine/iff-and-tre.md (+ meshes for DDS) |
| 207–592 | Composite appearances (.sat); palette customization (.pal) | 02-formats/meshes-and-appearances.md |
| 594–782 | Dual-channel IPC; live memory injection | 04-live-sync/live-memory-and-ipc.md |
| 784–2147 | Terrain (.trn): LAYR/BPOLY/FRAC, render, serialize | 02-formats/terrain.md |
| 2149–2774 | Flora (.fld) + terrain-material linkage | 02-formats/flora.md |
| 2776–3024 | TRE packing + swg.cfg loader | 01-core-engine/iff-and-tre.md |
| 3025–3260 | Client config (.cfg) management | 02-formats/properties-config-environment.md |
| 3262–4314 | Viewport tools: selection/gizmo/snap/brush/scatter/cull | 03-rendering/viewport-tools.md |
| 4315–4776 | World snapshots (.ws) read & write | 02-formats/world-snapshots.md |
| 4777–5042 | Collision/pathfinding via Recast | 02-formats/collision-and-portals.md |
| 5043–5419 | Electron packaging (5238–5419 = duplicate) | 06-workflow/packaging-and-distribution.md |
| 5420–5635 | Auto-updates (Squirrel + asset streamer) | 06-workflow/packaging-and-distribution.md |
| 5636–5690 | "Beyond geometry" — IFF data-types overview essay | (scattered across format docs — CHECK if the overview itself is captured) |
| 5691–5955 | Audio (.snd) + Web Audio | 02-formats/audio-and-effects.md |
| 5956–6234 | Particles/effects (.prt/.eft) | 02-formats/audio-and-effects.md |
| 6235–6710 | Skeletons (.sat/.skt) + animation (.ans) | 02-formats/skeletons-and-animation.md |
| 6711–6947 | Datatables (DTII) | 02-formats/datatables-and-strings.md |
| 6954–7344 | String tables (.stf) + serialize | 02-formats/datatables-and-strings.md |
| 7345–7897 | Lightsabers (.lsb) + motion trails + compile | 03-rendering/shaders-and-fx.md |
| 7898–8159 | Animation→audio sync | 02-formats/audio-and-effects.md |
| 8160–8393 | Weapon DTII query engine | 02-formats/datatables-and-strings.md |
| 8394–8546 | DPS charting | 02-formats/datatables-and-strings.md |
| 8547–8734 | Client↔server balance sync (Core3 Lua) | 05-server-integration/core3-parity.md |
| 8738–9016 | Remaining-types overview + spawns (.spw) | 02-formats/properties-config-environment.md |
| 9017–9472 | Sky/weather (.sky) + serialize | 02-formats/properties-config-environment.md |
| 9474–9903 | Collision (.cdf) + serialize | 02-formats/collision-and-portals.md |
| 9904–10357 | Portals/cells (.pob) culling + serialize | 02-formats/collision-and-portals.md |
| 10358–10616 | Indoor pathfinding (.floc) | 02-formats/collision-and-portals.md |
| 10617–10914 | UI editor (.ui) | 02-formats/ui-files.md |
| 10915–11088 | Parity pipeline / master file registry | 05-server-integration/core3-parity.md |
| 11089–11343 | Version control (Git/LFS) | 06-workflow/version-control-and-backup.md |
| 11344–11585 | Local backup/snapshot | 06-workflow/version-control-and-backup.md |
| 11586–11643 | Advanced studio modules overview | 08-ui-ux/workspace-layout.md |
| 11645–11871 | Shader graph editor (.sht) | 03-rendering/shaders-and-fx.md |
| 11872–12115 | Live memory inspector / packet analyzer | 04-live-sync/live-memory-and-ipc.md |
| 12116–12383 | FX timeline sequencer | 02-formats/audio-and-effects.md |
| 12384–12688 | Main workspace screen layout | 08-ui-ux/workspace-layout.md |
| 12689–12896 | Golden Layout docking | 08-ui-ux/workspace-layout.md |
| 12897–13114 | Force-field/shield shaders | 03-rendering/shaders-and-fx.md |
| 13115–13586 | Object property templates (.prp) | 02-formats/properties-config-environment.md |
| 13587–13830 | Async texture baking | 03-rendering/viewport-tools.md |
| 13830–14034 | Base44 changeset system | 06-workflow/version-control-and-backup.md |
| 14035–14291 | TRE consolidation (TREE0005) | 01-core-engine/iff-and-tre.md |
| 14292–14551 | Remote differential sync | 06-workflow/version-control-and-backup.md |
| 14551–14782 | Server-side deployment daemon | 05-server-integration/core3-parity.md |
| 14783–14830 | Why live injection matters | 04-live-sync/live-memory-and-ipc.md |
| 14831–15393 | Blender integration + AI mocap | 07-blender/blender-integration.md |

**Known suspected weak spots to scrutinize:** lines 13–77 (Three.js capabilities overview — may be
under-captured), 5636–5690 (IFF data-types overview essay — may have no clean home), and any place
the source ran code together on one line (copy artifact) that a doc may have mis-split or dropped.
