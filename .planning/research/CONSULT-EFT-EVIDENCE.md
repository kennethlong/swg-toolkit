# Evidence (treat as GIVEN — measured facts, do not re-derive)

## Stack
- Three.js **r0.184.0**, WebGL2, Electron renderer. Custom `THREE.ShaderMaterial` (raw GLSL, not MeshStandardMaterial).
- Fragment shader declares `uniform samplerCube uEnvMap;` and samples it as
  `vec3 envSample = textureCube(uEnvMap, reflect(-vViewDir, N)).rgb;` inside `if (bHasEnv) { ... finalColor += envSample * specMask; }`.
- `uEnvMap` default uniform value is `null`. `bHasEnv` is a `uniform bool`.

## The texture
- `env_theed.dds`: **128×128, DXT3** (DXT3 → `COMPRESSED_RGBA_S3TC_DXT3_EXT` = 0x83F2), it is a **cube map** (DDS header `caps2 & 0x200`, all 6 face bits set).
- Our native `parseDds` returns `mips.length === 48` for it (a flat array). For a 128×128 cube with full mip chain that is **6 faces × 8 mip levels**. Each mip entry = `{ offset, byteLength, width, height }` into the raw DDS ArrayBuffer. We do NOT know for certain whether the on-disk order is face-major (`face*8 + level`) or interleaved — verify against the Microsoft DDS spec.

## Symptom (measured)
- When the env cube is built and bound to `uEnvMap`, the affected meshes render **fully BLACK** (the entire fragment, not just the env term), and some draw calls disappear.
- Setting `bHasEnv=false` (so `textureCube` is never sampled) restores the correct solid diffuse render.
- Conclusion so far: a **null or malformed `samplerCube`** that is actually sampled blacks out the whole fragment.

## Current build code under suspicion
`packages/renderer/src/panels/viewport/material/ddsTexture.ts` → `buildCubeTexture()` (uses `THREE.CompressedCubeTexture` for the S3TC path; for CPU path builds `THREE.CubeTexture` from `DataTexture.image`). Also `swgMaterial.ts` (uniform defaults, GLSL) and `StaticMeshView.tsx` / `SkinnedMeshView.tsx` (where ENVM is wired to `mat.uniforms.uEnvMap.value`).

## The question (per consultant's angle below)
What is the CORRECT Three.js r0.184 way to build a **DXT3 compressed cube map** from raw DDS bytes and bind it to a custom-ShaderMaterial `samplerCube` so it renders a reflection — and what specifically in the current code causes the whole-fragment black-out?
