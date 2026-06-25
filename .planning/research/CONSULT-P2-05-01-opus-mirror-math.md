# Angle 1 (math/spec) — exact coordinate + mirror transform for glTF export

FIRST read `.planning/research/CONSULT-P2-05-AXIOMS.md` (LOCKED ground truth L1–L7 + banned framings).

You are the math/spec oracle. Given the axioms, derive the EXACT, COMPLETE transform set that makes
the exported glTF open in Blender 4.x / gltf.report with **correct orientation AND correct chirality**
(left stays left). Let `flip = diag(-1, 1, 1)` (X-reflection, det = -1).

Answer each with a derivation, not assertion:

1. **Geometry/vertex attrs.** Confirm/correct: position `x→-x`; normal `nx→-nx`; tangent — does
   `tx→-tx` suffice, or must the tangent handedness sign (`tangent.w` in glTF's vec4 tangent) also
   flip? Triangle winding must reverse (swap 2nd/3rd index) under det=-1 — confirm and explain why.

2. **Quaternion mirror.** For a bone rotation quat `q=(w,x,y,z)` (w,x,y,z order), what is the quat that
   represents the SAME rotation conjugated by an X-reflection `flip·R·flip`? Derive rigorously
   (a reflection is improper — show how you map the improper conjugation back to a proper rotation
   quaternion). State the final formula in (w,x,y,z). Then give the glTF reorder to (x,y,z,w).

3. **Matrices.** Bind & inverse-bind matrices and bone local TRS: confirm `M' = flip·M·flip`
   (conjugation) is correct and equivalent to applying (1)+(2)+translation `x→-x` componentwise.

4. **Animation baking.** Per L5 the keyframe quats are NOT final local rotations. Confirm that the
   export clip must be built by SAMPLING the fully-composed local transform per frame
   (`postMul·(key·bindRot·preMul)`, additive translation) and then mirroring those, rather than
   mirroring the raw keys. Show why a closed-form mirror of raw keys would be WRONG here (it would be
   valid only if keys were already final local). Note sampling cost: sparse keys, ~N frames.

5. **Facing rotation?** `coords.py` mentions a "+90° CCW about X" object rotation on *static* import.
   Is any rotation (beyond the X-flip) required for a correct glTF, or is that +90° a Blender-Z-up
   artifact irrelevant to glTF's Y-up? Decide and justify.

Output: a numbered spec I can implement directly, plus any case where the plan's
"flip·M·flip applied to geometry/normals/tangents/winding/bind/bones/animation" is INCOMPLETE or WRONG.
