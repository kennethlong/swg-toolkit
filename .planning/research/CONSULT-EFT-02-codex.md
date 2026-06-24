Three.js r0.184 + DDS cube-map question. Read `.planning/research/CONSULT-EFT-EVIDENCE.md` first (measured facts, treat as given).

ANGLE (yours specifically): the **DDS byte layout + mip/face slicing** and how Three.js r0.184 ingests GPU-compressed cube data.

1. For a 128×128 DXT3 CUBE DDS with a full mip chain, what is the canonical on-disk order of the surface data per the Microsoft DDS spec — face-major (all mips of +X, then -X, …) or mip-major? Our `parseDds` yields a flat `mips[]` of length 48 (`{offset, byteLength, width, height}`); the renderer currently indexes `mips[face * mipCount + level]`. Is that the correct slicing for a DDS cube, and is the FACE order (+X,-X,+Y,-Y,+Z,-Z) matching Three.js's expected cube face order?
2. In Three.js r0.184, what does `CompressedCubeTexture` actually expect for its `images` argument to GPU-upload S3TC blocks per face+mip? (vs `CompressedTexture` for 2D.) Does it expect an array of 6 entries each being an array of `{data,width,height}` mip levels, or a flat array, or something else? What `format`/`type`/`mapping`/`colorSpace`/`needsUpdate` must be set so the WebGLCubeTexture uploader uploads compressed blocks rather than treating them as RGBA?

Read `packages/renderer/src/panels/viewport/material/ddsTexture.ts buildCubeTexture()` and judge whether the slicing + the `CompressedCubeTexture` construction match the spec + the r184 API. Output the corrected slicing + construction with citations to the DDS spec and Three.js r184 source/behavior.
