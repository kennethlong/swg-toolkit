# Backlog — Milestone 9 (proposed): SWGEmu capability parity

**Status:** captured 2026-08-01, not yet on the roadmap. Maintainer's ask, raised during Phase 05.1
execution. Nothing here is scoped or committed — this is the shape of the problem plus the evidence
gathered while answering "how much of 05.1 works on the non-advertised client?"

## Why this exists

Phase 05.1's entire **in-game** half is advertised-build-only (swg-client-v2). Verified against source
this session, not assumed:

- **The overlay itself never installs on legacy.** `overlay.cpp:902-914` `tryInstall()` requires
  `gl11_r.dll` / `gl11_d.dll` exporting `GetHookPoints` — a **D3D11** renderer. SWGEmu's retail client
  is D3D9 (Utinni hooks D3D9 `Present`). `tryInstall()` returns false at :907 and polls forever,
  silently — the warn branch at :910-913 is *past* the `gl11` null check, so there is not even a log line.
- **Every world-editor slot is seeded `nullptr` with no legacy RVA literal** (`rva_table.cpp:265-319`):
  `wsAddObject`, `wsSaveSnapshot`, `wsGetSavePath`, `wsUnloadSnapshot`, `wsSetNodeTemplateName`,
  `wsLoad`, `collideScreenRay`, `collideScreenRayObject`, `getContainingBuildingId`, `gameLoadScene`.
  Contrast the Phase-3/5 slots, which DO carry verified Utinni literals (`setTransform_o2w`
  `0x00B22CC0`, `getTemplateFilename` `0x00B23C40`, `getPlayer` `0x00425140`).

This is not a descoping decision. Those *slots* were **added to swg-client-v2 by the provider** —
several in this pipeline's own lineage (v22 `collideScreenRayObject`, v23 `wsSetNodeTemplateName`,
v24 `getTransformO2P`, v25 `getContainingBuildingId`; handbacks in `.planning/handoff/`).

> **Do not read the above as "this capability cannot exist on SWGEmu."** It means *we* never bound a
> legacy literal for these slots. The retail client DOES contain equivalent world-snapshot add/remove/
> save, picking, and cell-resolution code, with RVAs already written down in `../Utinni` — see the
> corrected evidence section below.

Degradation is graceful, not crashy: call sites capability-gate on the slot pointer
(`haveRebind = wsSetNodeTemplateName != nullptr`, `haveInsert = wsAddObject != nullptr`, the
`getObjectTransformO2P == nullptr` guards). A legacy attach yields the Phase-3/5 channel
(transform/template/liveness reads + `setTransform_o2w` writes) with the world editor simply absent.

## 05.1 per-plan legacy support (as built)

| Works on legacy | Advertised-only |
| --- | --- |
| 01 `.ilf` + persist + failure labels | 05 in-game HUD strip |
| 02 per-project persistence | 09 agent command consumption |
| 03 wire contract / channel layout | 12 placement mode |
| 04 scan + store | 15 live sign-off steps |
| 06 mirror toggle | |
| 07 HOST_CMD C++ plumbing | |
| 10 World panel spine | |
| 13 remove + undo (data-only by design, C4) | |

Partial: **08** (sends fine, nothing ever acks), **11** (UI renders, "Reload scene" is a no-op),
**14** (browse/select works, "Place in game" does not).

## The split that actually governs scope

RVA scanning only helps for functions **present in the binary**. Two categories:

1. **Present but unadvertised** → scanning/harvest works. Utinni has already done much of this.
   The known legacy gaps (`g_runningFlags`, `getNetworkId` — `rva_table.cpp:131-152`) are here.
2. **Never compiled into retail** → scanning finds nothing. **Suspected home of the entire `ws*`
   family.** swg-client-v2 builds from the leaked Source *including SOE's dev toolchain*, which is why
   world-snapshot authoring is callable there; the retail client loads `.ws` but plausibly never
   shipped the save/edit half.

**ANSWERED 2026-08-01 — NO. The retail binary HAS the world-snapshot editing code, with known RVAs.**

⚠️ **This section corrects an earlier wrong conclusion in this same note.** An initial read of
`../Utinni`'s *modern* `endpoints_bindings.cpp:305-308` — "Slots start null -- no SWGEmu RVA exists" —
was over-generalized into "the `ws*` family was never compiled into retail." **That comment is scoped
to the v17 `utinni_ws*` id-keyed READ shims**, a newer provider-added API surface for the advertised
client. It says nothing about the classic RVA layer, which still exists alongside it.

**Ground truth — `UtinniCore/swg/scene/world_snapshot.cpp`, real SWGEmu RVA literals:**

| Function | RVA |
| --- | --- |
| `WorldSnapshot::addNode` | `0x00B98410` |
| `WorldSnapshot::removeNode` | `0x00B98780` |
| `WorldSnapshot::saveFile` | `0x00B98120` |
| `WorldSnapshot::openFile` | `0x00B97D90` |
| `WorldSnapshot::clear` | `0x00B98290` |
| `getNodeByNetworkId` / `getNodeByIndex` | `0x00B98740` / `0x00B986B0` |
| `nodeCount` / `nodeCountTotal` | `0x00B986A0` / `0x00B986D0` |
| `removeFromWorld` | `0x00B97440` |

**Picking** (`swg/scene/client_world.cpp`): `collide = 0x00561350`,
`internalCollideFindAllObjects = 0x00562680`.
**Cell/portal** (`swg/appearance/portal.cpp`, `swg/object/object.cpp`): `getParentCell = 0x00B22C00`,
`setParentCell = 0x00B22C30`, `getCellCount = 0x00B47BE0`, `getPobByCrcString = 0x00B497E0`,
`getExteriorAppearanceName = 0x00B47C90`.

Add + remove + **save** + pick + cell-resolution all exist on the retail client.

**Maintainer's firsthand report (2026-08-01), which this evidence explains:** in Utinni you can spawn
an armoire in open-world Naboo and manipulate it with a gizmo, and you can attach to an existing
in-world object and get a gizmo. That is `WorldSnapshot::addNode` + `clientWorld::collide` +
`setTransform_o2w` — all legacy-capable. The maintainer also correctly predicted the *actual* gap:
the **cantina-table case**, where the item is part of the building's interior structure.

**Note the inversion on cell resolution:** the ADVERTISED client needed a provider shim (v25
`object::getContainingBuildingId`) because `getParent` was not advertised — that was model-D's blocking
issue. The LEGACY client has had `Object::getParentCell` as a plain RVA all along.

## Revised floor — much HIGHER than first assessed

Milestone 9 is mostly a **harvest + vendoring** job, not a research/AOB-scan job:

- The RVAs already exist and are written down in `../Utinni`. **Harvest them; do not AOB-scan.**
- The D3D9 overlay is vendoring from a working implementation.
- The remaining genuine unknown is narrow: **the interior `.ilf` / cell-contained decoration case** —
  exactly the gap the maintainer identified. `getParentCell` yields the CELL; model-D additionally
  needs CELL → BUILDING and the derived-building-template rebind. Whether that composes from the
  legacy portal/object APIs is the one thing actually worth investigating.
- `.ilf` authoring itself is file-side and already build-agnostic in this toolkit — the in-client calls
  buy live rebind, not the edit.

Modern `../Utinni` has migrated to the advertised `engine_hookpoints.h` + `resolveFromExe()` model
(zero RVA literals in `endpoints.cpp` / `endpoints_bindings.cpp`; `Source::SwgemuRva` survives only as
drift telemetry), so the RVA reference is the **classic layer under `UtinniCore/swg/{scene,object,
appearance,game,client}/`** — still present in the working tree, not only in history.

## Likely achievable parity WITHOUT any RVAs

The toolkit **already edits `.ilf`/`.ws` out-of-process** — the whole model-D pipeline is build-agnostic
file I/O. The in-client `ws*` calls buy *live rebind without restart*. On legacy, keep the full authoring
loop and pay a scene reload / client restart instead. Loses WYSIWYG immediacy, keeps capability.

## Rough shape (not a plan)

- **D3D9 overlay path** — vendoring, not research. Utinni has a working D3D9 `Present` + ImGui hook on
  exactly this client. See `.planning/research/SPIKE-utinni-world-editor-gaps.md` and
  `CONSULT-UTINNI-SYNTHESIS.md`.
- **RVA harvest** for category-1 functions (mine Utinni first — harvest, don't AOB-scan, where a known
  literal already exists).
- **Out-of-process edit + reload** for category-2 functions.
- **Honest capability matrix** so the UI degrades *visibly* per build instead of silently — today a
  legacy attach shows no overlay and logs nothing, which reads as a bug.

## Scope note

Prior standing rule (memory `reference-live-target-builds-in-scope`): both SWGEmu (legacy known-RVA)
and swg-client-v2 (advertised) are in-scope live targets; **AOB / unknown-build / x64 was fenced**.
This milestone would deliberately reopen the AOB/scan fence. That is the maintainer's call and should
be recorded as an explicit decision when the milestone is created, not assumed from this note.
