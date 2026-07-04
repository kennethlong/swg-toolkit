/**
 * packages/renderer/src/panels/viewport/orientation.ts
 *
 * Single source of truth for the SWG→viewer facing rotation (D-16). Both
 * StaticMeshView.tsx and SkinnedMeshView.tsx import SWG_ORIENTATION from here —
 * do NOT re-declare a second local copy (pathSafety.ts single-source-of-truth
 * discipline, replicated here per 04.4-04 Task 1).
 *
 * ─── History (carried forward verbatim from the pre-extraction duplicated
 *     comments in StaticMeshView.tsx / SkinnedMeshView.tsx — do not lose this) ───
 *
 * SWG: forward=+Z, up=+Y. Three.js camera looks down -Z. A 180° Y rotation
 * brings SWG's authored front (+Z) to face the default camera. Mesh is
 * already correctly oriented (Y-up matches Three.js; geometry verified
 * faithful — protocol_droid_red_l0 verts/tris/bbox byte-identical to the
 * independent io_scene_swg_msh importer, Phase 02 Plan 02).
 *
 * The 180° Y guess was TRIED (Phase 02-03) and FALSIFIED: it showed the
 * model's BACK ("facing away"); identity (0°) shows its front. Do NOT
 * re-test rotateY(Math.PI) — that hypothesis is closed.
 *
 * The residual left-vs-right difference from SIE was concluded (Phase 02-03,
 * re-confirmed by direct source read 2026-07-03) to be a default CAMERA-AZIMUTH
 * preference, not a mesh rotation — tracked in
 * .planning/todos/pending/viewport-default-facing-axis.md (D-17 human-verify
 * checkpoint exists specifically to confirm or refute this against SIE).
 * Identity here keeps winding/normals correct (determinant +1, never a mirror).
 *
 * ─── 04.4-04 Task 2 derivation (this phase's re-attempt under D-17) ───
 *
 * SWG's up-axis (+Y) already matches Three.js's up-axis — unlike the Blender
 * case (io_scene_swg_msh __init__.py:332-355, @orientation_helper(axis_forward=
 * 'Z', axis_up='Y'), which converts FROM Blender's default -Y-forward/+Z-up),
 * no Y/Z axis swap is needed for the Three.js viewer. Combined with the
 * already-tried-and-falsified 180°Y result (identity shows the front, not the
 * back), any further discrepancy vs SIE is necessarily a residual AZIMUTH
 * offset, not a missing axis remap.
 *
 * This executor pass could NOT visually iterate Y-only candidates against SIE
 * (no screen-capture/visual-compare capability available to this agent — only
 * the maintainer can eyeball the live viewport next to SIE). Per this plan's
 * explicit instruction ("If NO Y-only candidate visually improves on identity
 * ... leave SWG_ORIENTATION as identity and proceed to Task 3 anyway — do NOT
 * force a non-identity value"), the committed candidate remains identity,
 * deferring the visual call entirely to the D-17 maintainer checkpoint (Task 3).
 * This is a legitimate, documented outcome — not a failure to route around.
 */

import * as THREE from 'three';

export const SWG_ORIENTATION = new THREE.Euler(0, 0, 0);
