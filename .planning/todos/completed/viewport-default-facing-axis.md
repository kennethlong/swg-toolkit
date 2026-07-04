---
id: viewport-default-facing-axis
title: Viewport default facing differs from SIE/in-game — apply SWG forward-axis convention
created: 2026-06-24
origin: Phase 02 checkpoint testing (02-02 human-verify, protocol_droid_red)
severity: low
area: renderer / viewport orientation
status: done
resolves_phase: "04.4"
---

## Symptom

Meshes render at a different default yaw than Sytner's IFF Editor (SIE) / in-game — e.g.
protocol_droid_red faces "diagonally right" in SIE but "diagonally left" in our viewport.

## NOT a correctness bug (ground-truth verified 2026-06-24)

- Geometry is byte-identical to the independent `io_scene_swg_msh` importer (verts/tris/bbox).
- `io_scene_swg_msh` imports with a PURE ROTATION, no mirror: `__init__.py:332`
  `@orientation_helper(axis_forward='Z', axis_up='Y')` + `global_matrix = Matrix.Scale(1,4) @
  axis_conversion(...)`. No negative scale / reflection. (`export_msh.py:103` only
  `flip_normals()` when the user's object matrix determinant < 0, i.e. user-mirrored.)
- Therefore SWG meshes are NOT inherently mirrored; correct display needs a rotation, not a flip.
  Our droid is not mirrored — asymmetric detail is on the correct side.

## Cause

Our viewport (StaticMeshView/SkinnedMeshView/Viewport) loads raw SWG vertex axes into Three.js
with no orientation rotation. SWG forward = +Z, up = +Y. Three.js camera looks down -Z, so SWG's
forward maps to a different screen direction than SIE's view → different default yaw.

## Fix (when desired — cosmetic polish)

Apply the SWG→viewer axis convention once (a fixed rotation, NOT a scale/mirror — keep
determinant +1 so winding/normals stay correct) so a model's authored front faces the default
camera like SIE/in-game. Likely a single group rotation in the viewport (mirror the
`axis_forward='Z', axis_up='Y'` convention io_scene_swg_msh uses). Verify visually against SIE.
Related: 02-05 plan's export X-mirror is a SEPARATE concern (glTF/COLLADA handedness for external
tools) — do not conflate; the viewport fix is a rotation, the export transform is a reflection.

## Severity

Low / cosmetic — geometry is correct and orbit-able to any angle. Candidate for 02-03 (already
touching the viewport for materials) or a quick standalone polish.

## Resolution (2026-07-04, Phase 04.4-04, D-17 maintainer checkpoint)

Closed as verified. `SWG_ORIENTATION` was extracted into a single shared `orientation.ts` module
(imported by both `StaticMeshView.tsx` and `SkinnedMeshView.tsx`) and confirmed, via the D-17
human-verify checkpoint (protocol_droid_red + one asymmetric mesh vs SIE, two UAT rounds), to
already be correct as identity `(0, 0, 0)` — the mesh's authored front was never mirrored/rotated
wrong. The residual difference from SIE's default view was a camera-azimuth preference, not a mesh
issue: the default camera position was mirrored from the `+X/+Z` to the `-X/+Z` quadrant so the
viewport now opens on the character's right side, matching SIE's perceived default facing. A
related framing bug (feet-origin centered, head clipped) found during the same UAT round was also
fixed by retargeting `OrbitControls.target` to the mesh bounds center. Maintainer round-2 approval,
verbatim: "facing and framing look right now, approved". See
`.planning/phases/04.4-ux-polish-deploy-hardening/04.4-04-SUMMARY.md` for full detail, including the
explicit note that this consciously supersedes D-16's earlier "rotation, not camera" mechanism
claim with new maintainer-confirmed evidence.
