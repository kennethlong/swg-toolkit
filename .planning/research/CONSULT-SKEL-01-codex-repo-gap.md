# Codex task — repo data-flow gap trace (SWG-Toolkit)

Read the LOCKED axioms first: `.planning/research/CONSULT-SKEL-AXIOMS.md`. Do not contradict them.

You can read BOTH repos: `D:\Code\SWG-Toolkit` (ours) and `D:\Code\swg-client-v2` (ground truth).

## Your angle: trace OUR pipeline end-to-end and produce a precise GAP LIST.

Trace the skeleton+animation data path in SWG-Toolkit, with file:line citations at each hop:

1. **Native parse** — `packages/native-core/modules/core/formats/Skeleton.cpp` and `Skeleton.h`:
   what per-joint fields exist (preRot, postRot, bindPos, preRotOff, …), and exactly how many floats
   each chunk read consumes. Confirm/deny the BPRO-as-3-floats bug vs axiom A2. Note whether reading
   BPRO as 3 floats misaligns the per-joint stride (is BPRO the last data-bearing chunk, or do BPMJ/JROR
   follow, and are those skipped by tag-seek or by sequential read?).
2. **N-API binding** — `packages/native-core/src/*skeleton*` / `anim_binding.cpp`: which skeleton fields
   are marshalled to JS and under what key names. Is bindPoseRotation exposed at all?
3. **JS resolver** — `packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts`: the
   `SkeletonParseResult` mapping (~264-273). Which fields are kept/dropped.
4. **Renderer** — `packages/renderer/src/panels/viewport/SkinnedMeshView.tsx`: `buildSkeleton()` and the
   `useAnimationSampler` per-joint loop. What it sets on `bone.quaternion`/`bone.position`.

## Deliverable
A table: for each of {RPRE preMul, RPST postMul, BPTR bindTrans, BPRO bindPoseRot} →
[parsed? exposed over N-API? mapped in resolver? used in renderer?] with the exact file:line and the
field/key name at each layer. Then a concrete CHANGE LIST: which struct fields, binding `.Set(...)`
keys, contract types, resolver fields, and renderer sites must change to carry all four arrays through
to the renderer. Cite line numbers. Do not write code; just the precise gap + change list.
