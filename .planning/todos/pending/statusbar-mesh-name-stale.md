---
id: statusbar-mesh-name-stale
title: Bottom status bar mesh name / vert count is stale — doesn't update per loaded mesh
created: 2026-06-24
origin: Phase 02 checkpoint testing (02-02 human-verify)
severity: low
area: renderer / status bar
status: pending
---

## Symptom

The global bottom status bar shows `shared_landspeeder.msh · 4,812 verts` regardless of which
mesh is actually rendered in the viewport. Observed across multiple loads during 02-02 testing
(tall-birch `.msh`, protocol-droid `.apt→.lod` chain) — the filename + vert count stayed pinned
to `shared_landspeeder.msh / 4,812 verts` while the viewport correctly showed the new mesh.

## Likely cause

The status-bar mesh-name/vert-count indicator is bound to a stale source (probably the first/last
SAB-proof mesh or a value set once and never updated on `loadComplete`). It should reflect the
currently rendered mesh from the viewport store (`parsedMesh` / active resolution), updating on
each `loadComplete`.

## Where to look

- The status-bar component (search packages/renderer/src for the bottom bar with
  `addon: native-core` / `zero-copy` / `mount: N archives` / `vfs: N files`).
- It should read the active mesh name + summed vertex count from the viewport store
  (`useViewportStore`) on each load, not a one-time value.

## Severity

Low / cosmetic — does not affect rendering or correctness. Fix opportunistically (e.g. in 02-03
when the viewport store is already being touched for materials).
