# Cursor task — verify multi-skeleton attachment + per-part binding (swg-client-v2)

Read LOCKED axioms first: `.planning/research/CONSULT-MP-AXIOMS.md`. Ground truth: `D:\Code\swg-client-v2`.
Cite file:line. Do not contradict the axioms.

## Angle: pin the exact semantics of combining N skeletons + binding N mesh parts to them.

1. **Combined transform-name map.** How does the engine build the unioned transform/bone name list across
   attached segments? Read `SkeletonTransformNameMap` / `SkeletonTemplateTransformNameMap` / `TransformNameMap`
   and `Skeleton::attachSkeletonSegment` + `findLocalTransformIndex`. Specifically: (a) is the combined index
   space simply segment0 bones, then segment1 bones, in attach order? (b) what happens on a **name collision**
   between two segments (e.g. both have "root")? first-wins? error? (c) is the lookup case-insensitive?
2. **Per-part → skeleton binding.** When a `.mgn` is skinned, are its XFNM transform names resolved against the
   FULL combined map (so any part can reference any segment's bones), or is each mesh tied to one specific
   skeleton template? Read `SkeletalMeshGeneratorTemplate` / where skin transform indices get mapped to the
   appearance's skeleton at runtime (`SkeletalAppearance2.cpp` bind path).
3. **Attached-root transform.** Confirm the attached segment's root joint is identity (or, if not, exactly how
   its jointToParent composes onto the parent "head" transform). Is there any additional attach offset stored
   in the `.sat` (per skeletonRef) beyond the attachment transform NAME? Read the SMAT/`.sat` skeleton-ref
   chunk layout (skeleton template name + attachment transform name — any transform/offset field?).
4. **LOD across parts.** Do the parts' `.lmg` LOD counts/distances have to match, or can they differ? How does
   the engine choose which LOD of each part to show (shared LOD index, or per-part distance)?

## Deliverable
For each of the 4 items: file:line evidence + a one-line definitive answer. Flag any case where our planned
"concatenate bones in attach order, reparent attached root to the head bone, remap every part's names against
the concatenated list" would diverge from the engine. No code.
