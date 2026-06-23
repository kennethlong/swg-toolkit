# Phase 2: 3D Mesh Viewport (MVP Proof) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 2-3D Mesh Viewport (MVP Proof)
**Areas discussed:** Scope & risk sequencing, Open-flow & appearance composition, Texture & palette-customization depth, Playback & export deliverables

---

## Scope & risk sequencing

### MVP-proof target

| Option | Description | Selected |
|--------|-------------|----------|
| Full ladder, .msh first as spine | Build all four VIEW reqs; sequence static .msh + textures first as the zero-copy spine, then skinned .mgn + skeleton + .ans on top | |
| Static-only MVP, skinned deferred | Ship only static .msh + textures + export; split skinned/skeleton/animation into a later phase | |
| Skinned-first (.mgn) as the real proof | Go straight at skinned .mgn + skeleton + animation (stresses zero-copy + GC most); static .msh falls out as the easy subset | ✓ |

**User's choice:** Skinned-first (.mgn) as the real proof.
**Notes:** Full VIEW-01..04 stays in one phase; static .msh is the easy subset, not deferred. Deliberate "attack the hard case first" call to stress the real risk.

### LOD / appearance-template depth

| Option | Description | Selected |
|--------|-------------|----------|
| Highest-detail LOD only | Resolve LOD 0 and render just that; skip LOD switching | |
| All LODs, user-selectable | Parse every LOD level and expose a selector | ✓ |
| You decide (research-driven) | Researcher picks minimum LOD handling needed | |

**User's choice:** All LODs, user-selectable.

---

## Open-flow & appearance composition

### Entry point + auto-composition

| Option | Description | Selected |
|--------|-------------|----------|
| Open .sat/.apt → auto-compose full graph | Double-click appearance template; viewer auto-resolves skeleton + .mgn LODs + shaders + textures | |
| Open any file → render what it is, manual attach | Open a .mgn → bind pose; user manually attaches skeleton/animation | |
| Both — smart open by file type | .sat/.apt auto-composes; leaf .mgn/.msh renders standalone (bind pose) + optional manual attach | ✓ |

**User's choice:** Both — smart open by file type.

### Missing-dependency handling

| Option | Description | Selected |
|--------|-------------|----------|
| Render partial + visible warning | Render what resolved, placeholder substitutes, "missing: X" warning panel | ✓ |
| Refuse + explain | Block render; tell user which dependency/mount is missing | |
| You decide | Pick during planning | |

**User's choice:** Render partial + visible warning.

---

## Texture & palette-customization depth

### Customization interactivity

| Option | Description | Selected |
|--------|-------------|----------|
| Interactive color swapping live | Render default customization AND expose customization variables as live color/palette pickers (real-time re-tint) | ✓ |
| Correct default customization only | Apply default palette indices correctly; no live re-tint UI this phase | |
| You decide | Planning weighs cost vs demo value | |

**User's choice:** Interactive color swapping live.

### Shader / material fidelity

| Option | Description | Selected |
|--------|-------------|----------|
| Diffuse + customization first, more maps if cheap | Resolve .sht→texture for main diffuse + customization; extra maps only if cheap | |
| Full multi-map material parity | Reproduce .sht faithfully — diffuse, normal, specular, environment/effects | ✓ |
| You decide | Researcher determines minimum chain | |

**User's choice:** Full multi-map material parity.

---

## Playback & export deliverables

### Animation playback UX

| Option | Description | Selected |
|--------|-------------|----------|
| Full transport: play/pause/scrub/loop + speed | Timeline scrubber, play/pause, loop, speed, + .ans picker | ✓ |
| Minimal: play/pause/loop | Just play/pause/loop + .ans picker; no scrub/speed | |
| You decide | Planning picks control set | |

**User's choice:** Full transport: play/pause/scrub/loop + speed.

### Skinning approach

| Option | Description | Selected |
|--------|-------------|----------|
| GPU skinning (Three.js SkinnedMesh) | Bone matrices to GPU; no per-frame geometry rebuild; avoids GC churn | ✓ |
| You decide (research-driven) | Researcher confirms bind-pose/bone-weight maps to SkinnedMesh | |

**User's choice:** GPU skinning (Three.js SkinnedMesh).

### Export scope

| Option | Description | Selected |
|--------|-------------|----------|
| glTF primary, rigged + animation | glTF primary (rigged); COLLADA optional; export-only | |
| glTF + COLLADA, both rigged | Both exporters with skeleton + animation | ✓ |
| Static geometry only, glTF | Baked static geometry to glTF; rigged deferred | |

**User's choice:** glTF + COLLADA, both rigged.

---

## Claude's Discretion

- DDS decode path (GPU compressed-texture upload vs CPU decode to RGBA).
- Appearance-resolver's home (native C++ lib vs TS/renderer) — payloads stay zero-copy regardless.
- Baseline viewport chrome (grid, lighting rig, background, wireframe, bounding box, camera framing).
- `.ans` compression variants (keyframe vs compressed-keyframe) — researcher determines v1 coverage.

## Deferred Ideas

- Re-import / round-trip of glTF/COLLADA back into SWG formats (Phase 2 export is one-way; authored `.ans` export is the Phase-6 Blender story).
- In-viewport mesh/UV/weight/rig editing (out of scope project-wide — bridge to Blender).
- Animation state graph / logical animation (`.ash`) authoring (Phase 2 only plays back `.ans`).
- Other appearance types (particles, terrain, portals/POB) — Phase 7 leaves.

**Scope flag:** Every gray-area decision went to the ambitious end — Phase 2 is a deliberately large, complete viewer-studio (the "wow moment" showcase), not a thin proof. Planner should wave it, not trim scope.
