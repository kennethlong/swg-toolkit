You are reviewing a Three.js r0.184 rendering bug in this repo (read the real code).

Read `.planning/research/CONSULT-EFT-EVIDENCE.md` first (measured facts, treat as given).

Then READ these actual files and find the defect:
- `packages/renderer/src/panels/viewport/material/ddsTexture.ts` — `buildCubeTexture()` (S3TC path uses `THREE.CompressedCubeTexture`; CPU path builds `THREE.CubeTexture` from `DataTexture.image`).
- `packages/renderer/src/panels/viewport/material/swgMaterial.ts` — the `uEnvMap` uniform default + the GLSL `if (bHasEnv)` env-sampling block.
- `packages/renderer/src/panels/viewport/StaticMeshView.tsx` — where ENVM is wired to `mat.uniforms.uEnvMap.value`.

ANGLE (yours specifically): the Three.js **API correctness** of the cube construction. In r0.184, what is the exact correct way to build a GPU-compressed (S3TC/DXT3) cube texture and have a custom-ShaderMaterial `samplerCube` sample it? Check: Is `CompressedCubeTexture`'s constructor signature/`images` shape used correctly? Does it need `isCubeTexture`/`mapping`/per-face mipmaps in a specific structure? Is `needsUpdate`/`colorSpace` handled? Is passing `DataTexture.image` into `CubeTexture` (CPU path) valid, or is `.image` undefined? Quote the exact lines that are wrong and give the corrected code. Also: would a `samplerCube` uniform left at `null` while the shader samples it cause a whole-fragment black-out, and what is the minimal robust default?

Output: the specific defect(s) with file:line, the corrected Three.js r0.184 code, and the safest pattern for an OPTIONAL env cube (so a build failure never blacks out the mesh). Be concrete; cite Three.js r184 API behavior.
