# CONSULT-P2-02 — Cursor — `.mgn` + `.msh` geometry BYTE-MAP (vertices, skin weights, indices, LOD)

## Your role
Most-detailed code reader. Produce a **byte-exact field-order map** of the SWG mesh geometry chunks,
with `file:line` citations from the real client source, cross-checked against the community Python
reader. We are writing a byte-exact parser + serializer and it must round-trip real assets.

## De-anchoring frame (READ FIRST)
- **Ground truth = real loader code in `../swg-client-v2` + the Python readers in
  `../swg-blender-plugin`.** Two independent oracles beat one.
- This repo's `docs/02-formats/meshes-and-appearances.md` is **AI-distilled (Gemini)** and has 18
  code blocks proposing layouts — **treat every one as an UNVERIFIED HYPOTHESIS.** For each layout
  claim you rely on, state CONFIRMED-vs-source or WRONG. Do not let the doc seed your answer.

## LOCKED ORACLES — read, cite file:line
Primary (C++):
1. Static mesh `.msh`:
   `../swg-client-v2/src/engine/client/library/clientObject/src/shared/appearance/MeshAppearanceTemplate.cpp`
   (+ `MeshAppearance.cpp`, `DynamicMeshAppearance.cpp`)
2. Skinned mesh generator `.mgn`:
   `../swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/appearance/SkeletalMeshGenerator.cpp`
   + `SkeletalMeshGeneratorTemplate.cpp`
3. LOD wrapping: `.../clientSkeletalAnimation/src/shared/appearance/LodMeshGeneratorTemplate.cpp`
   and `.../clientGraphics/src/shared/LodDistanceTable.cpp`
Secondary (Python — second oracle): `../swg-blender-plugin/swg_scene/mesh_static.py`,
`mesh_skeletal.py`, `mesh_lod.py` (and `mesh_static_export.py` / `mesh_skeletal_export.py` for the
WRITE side — field order on serialize must match).

## Your question (NON-OVERLAPPING — YOUR slice is the geometry byte layout; NOT the cross-file graph,
## NOT animation, NOT shaders)
For BOTH `.msh` (static) and `.mgn` (skinned), document the **exact on-disk layout** of the geometry:
1. **Per chunk:** the IFF chunk tag, then field-by-field: type, count, order, units. Cover at minimum:
   - vertex **positions**, **normals**, vertex **colors** (if any), **UV** sets (how many, which chunk)
   - **triangle index** lists (index width, winding, per-shader grouping)
   - **per-vertex skinning** (`.mgn` only): bone weight count per vertex, weight + bone-index encoding,
     and the **bone/joint name table** the indices reference
   - **shader/material binding** — how a geometry group names the `.sht` it uses (just the *reference*;
     shader internals are another consultant's slice)
   - **LOD structure** — how multiple LOD levels are stored/selected
2. **Endianness, alignment/padding, and any count-prefix vs terminator conventions** — exactly, because
   byte-exact serialize depends on reproducing these.
3. **Static vs skinned diff** — what `.mgn` adds over `.msh` (the skin data) and what's shared.
4. **Doc check:** for each layout the doc proposes, mark CONFIRMED / WRONG with the real field order.

## Output
- A **field-order table per chunk** (tag | field | type | count | notes | source file:line).
- Explicit **endianness + padding** statement.
- A **doc-verdict** list at the end (doc claim → CONFIRMED/WRONG → real value).
- Where C++ and the Python reader disagree, FLAG it — do not silently pick one.
