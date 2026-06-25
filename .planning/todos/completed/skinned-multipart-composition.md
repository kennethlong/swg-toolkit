---
id: skinned-multipart-composition
title: Composed .sat ignores extra skeletons + flattens multi-part .lmg meshes into the LOD array
created: 2026-06-25
origin: Phase 02 04 — ackbar.sat (multi-part, 2 skeletons) during animation testing
severity: medium
area: renderer / appearanceResolver + SkinnedMeshView
status: resolved
resolved: 2026-06-25
---

## RESOLVED 2026-06-25

Implemented full multi-part + multi-skeleton composition (crew-verified vs swg-client-v2; briefs
`CONSULT-MP-*`). `appearanceResolver.ts` now resolves ALL `skeletonRefs`, merges them into one skeleton
(`resolver/mergeSkeletons.ts` — concat in attach order, reparent attached root to its
attachmentTransform bone case-insensitively, first-wins collisions), and emits `parts[]` (each part its
own per-LOD meshes + materials). `Viewport`/`SkinnedMeshView` render ALL parts at the shared selectedLod
sharing ONE merged skeleton (bones[0] mounted once, one sampler, per-part material indexing). Verified
on ackbar.sat (3 parts + all_b/mon_m_face): renders whole and animates correctly. Guard:
`harness/test/merge-skeletons.test.ts`.

## Two bugs in the composed (.sat) resolver branch (appearanceResolver.ts ~579-631)

1. **Only `skeletonRefs[0]` is used** (line ~583). ackbar.sat has 2: body `all_b.skt` + face
   `mon_m_face.skt` (attachmentTransformName="head"). Attached/secondary skeletons are ignored, so
   face/attached meshes won't bind/animate.
2. **Multi-part `.lmg` meshes are flattened into the LOD array.** Each `.lmg` part → resolveLodMesh
   returns its 4 LODs; the loop does `allMeshes.push(...lodResult.meshes)`. ackbar has 3 body-part
   `.lmg`s (ackbar, ackbar_arms, ackbar_body) → allMeshes = [p1_l0..l3, p2_l0..l3, p3_l0..l3]. The
   viewport renders only `meshes[selectedLod]` = one LOD of ONE part. ALL parts must render together
   at the selected LOD.

## Fix

Restructure the composed result so meshes are grouped by PART, each part carrying its own LOD list;
the viewport renders part[i].meshes[selectedLod] for every part. Resolve + bind each skeletonRef
(attach secondary skeletons at their attachmentTransformName bone). Ground truth:
swg-client-v2 SkeletalAppearance / how multiple SkeletalMeshGenerators + skeletons compose.

## Severity

Medium — single-part single-skeleton `.sat` (e.g. protocol_droid_red.sat) doesn't need this; it's
the blocker for multi-part characters (most player/NPC appearances). Do after the core skinned-render
lockup (see handoff) is fixed.
