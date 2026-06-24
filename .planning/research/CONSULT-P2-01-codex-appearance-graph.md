# CONSULT-P2-01 — Codex — Skinned appearance LOAD call-graph & dependency resolution

## Your role
Repo tracer / call-graph specialist. Trace the **real load path** in the SWG client source. You read
the actual C++ and report what it does, with `file:line` citations. Do NOT theorize from docs.

## De-anchoring frame (READ FIRST)
- **Ground truth = the real loader code in `../swg-client-v2` + the community Python readers in
  `../swg-blender-plugin`.** Cite those.
- This repo's `docs/` were **AI-distilled (Gemini) and frequently fabricate struct layouts / chunk
  tags.** `docs/02-formats/meshes-and-appearances.md` and `docs/02-formats/skeletons-and-animation.md`
  contain *code examples* — treat them as **UNVERIFIED HYPOTHESES**. Where you cite the real source,
  explicitly note whether the doc's example matches or is WRONG. Never let the doc lead your answer.

## LOCKED ORACLES — read these, cite file:line (do not contradict without showing the bytes)
Primary (C++ — the #1 oracle), all under
`../swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/appearance/`:
1. `SkeletalAppearanceTemplate.cpp` + `SkeletalAppearance2.cpp` — the `.sat` skeletal appearance template (entry point for a skinned object)
2. `MeshGenerator.cpp` / `MeshGeneratorTemplate.cpp` / `MeshGeneratorTemplateList.cpp` — `.mgn` mesh-generator base + the template registry (how `.mgn` files are looked up/loaded)
3. `SkeletalMeshGenerator.cpp` / `SkeletalMeshGeneratorTemplate.cpp` — the skinned mesh generator
4. `LodMeshGeneratorTemplate.cpp` / `BasicMeshGeneratorTemplate.cpp` — LOD wrapping over mesh generators
5. `Skeleton.cpp` / `BasicSkeletonTemplate.cpp` — the `.skt` skeleton template
Secondary (community Python — second oracle): `../swg-blender-plugin/swg_scene/mesh_skeletal.py`,
`mesh_lod.py`, and `../swg-blender-plugin/swg_blender/import_skeletal.py`.

## Your question (NON-OVERLAPPING — this is YOUR slice; others cover byte-layout, animation, shaders)
Trace and report the **dependency/composition graph** for loading a skinned appearance, end to end:
1. **Entry → leaves.** When the client loads a `.sat`, what does it read and what dependent files
   does it pull in (skeleton(s) `.skt`, mesh generator(s) `.mgn`, and how it references shaders)?
   Give the call chain with `file:line`.
2. **IFF FORM/chunk tag tree** for `.sat`, `.skt`, and the `.mgn` *container* level (top-level FORMs +
   immediate child chunks and their order). Geometry chunk *internals* are another consultant's job —
   you map the **structure/skeleton of the file + cross-file references**, not vertex byte offsets.
3. **Dependency name resolution.** How does the loader turn a referenced name into a file path /
   TreeFile lookup? (We need to replicate this resolver to auto-compose an appearance across mounted
   `.tre` archives.) Note any naming conventions, default dirs, or fallbacks.
4. **Multiple skeletons / LOD selection** — how a `.sat` can bind several skeletons + LOD levels, and
   how a mesh generator maps to a skeleton (joint/bone name binding).
5. **Doc check:** open `docs/02-formats/meshes-and-appearances.md` + `skeletons-and-animation.md`,
   find their `.sat`/`.mgn`/`.skt` chunk-tag claims, and state which match the source and which are
   fabricated/wrong.

## Output
- Lead with the **dependency graph** (ascii tree) and the **FORM/chunk tag tree** per file type.
- Every structural claim cites `file:line` in `../swg-client-v2` (or the blender `.py`).
- End with a short **"doc verdict"** list: doc claim → CONFIRMED / WRONG (with the real value).
- Be concrete. We are porting this resolver to C++/TS; ambiguity costs us.
