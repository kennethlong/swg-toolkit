# Angle 4 (lateral / adversarial risk) — simplest robust mirror; pick the holes

FIRST read `.planning/research/CONSULT-P2-05-AXIOMS.md` (LOCKED ground truth L1–L7).

You are the lateral/adversarial reviewer. The current plan applies the X-mirror by hand-mutating
cloned geometry attributes + bone/bind matrices + animation tracks. Challenge it.

1. **Two strategies.** GLTFExporter bakes each node's WORLD matrix. Compare:
   (A) Hand-mirror every cloned attribute + matrix + track (plan's approach).
   (B) Wrap the export root in a parent `Object3D` with `scale.set(-1,1,1)` and let GLTFExporter bake
       the negative scale into world matrices.
   Which is more robust for a SKINNED + ANIMATED scene? Consider: does GLTFExporter bake skinned-mesh
   bind/inverse-bind under a scaled parent correctly? Does a negative-determinant node matrix survive
   the glTF export + Blender import (Blender's handling of negative scale / `glTF-Validator` warnings
   about non-invertible or mirrored node transforms)? Does negative scale silently break winding /
   backface culling / normal direction in the output?

2. **Winding + normals under det = -1.** If we use the hand-mirror (A), which of {triangle winding
   reversal, normal.x negation, tangent handedness} are MANDATORY and which does THREE/glTF recompute?
   What's the single most likely "inside-out / black faces" failure and how to detect it in gltf.report?

3. **Normal-map handedness.** Under an X-mirror, does the tangent-space normal map need any channel
   flip (green-channel invert) or `tangent.w` sign flip to stay correct? Or is mirroring geometry +
   tangent enough?

4. **Ordering.** Should ShaderMaterial→MeshStandardMaterial conversion happen BEFORE or AFTER the
   mirror, or are they independent? Any interaction?

5. **Highest-risk failure.** Name the ONE thing most likely to ship subtly wrong (mirrored-but-looks-
   ok on symmetric assets, or animation drift, or lost textures) and the cheapest empirical check to
   catch it before the human-verify checkpoint.

Output: a recommendation (A vs B vs hybrid) with the reasoning, plus a short risk list ranked by
likelihood × blast-radius. Disagreeing with the plan is welcome if you can justify it.
