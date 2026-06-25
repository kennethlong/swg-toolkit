# Codex task — trace the uncompressed-DDS / normal-map upload path (SWG-Toolkit)

Read LOCKED axioms first: `.planning/research/CONSULT-NRMMIP-AXIOMS.md`. Repo: `D:\Code\SWG-Toolkit`.

## Angle: determine EXACTLY what happens to the RGBA8 face normal map end-to-end.

1. `packages/native-core` parseDds: what `format` string does it emit for an uncompressed RGBA8 DDS
   (`A8R8G8B8`? `RGBA8`?), and does it decode/expose the raw RGBA bytes + all 9 mip levels (offsets/
   sizes) over the bridge? Cite the binding + the DdsParseResult shape (contracts).
2. `ddsTexture.ts` `buildDdsTexture`: walk the branch an RGBA8 (non-cube, non-S3TC, non-DXT) input takes.
   Does it return `makeMagenta1x1()` (A3.3 else)? Is there ANY uncompressed path? Confirm the exact return.
3. `SkinnedMeshView.tsx` `buildSkinnedGroupMaterial` NRML/CNRM case: what texture object is assigned to
   `uNormalMap`, and does `bHasNormal` get set true for han_solo_face (so the shader runs the normal-map
   branch even if the texture is magenta/white)? Trace slot → parseDds → buildDdsTexture → uniform.
4. So: is the face normal map RENDERING, or is `uNormalMap` the magenta/white default? If magenta, what
   would `texture2D(magenta).xyz*2-1 = (1,-1,1)` do to N — a constant skew that the LOD-fade + derivative
   TBN would turn into the medium-zoom pattern? Reason it through.
5. Mip/filter/anisotropy: confirm the DXT path sets `LinearMipmapLinearFilter` (A3.2) but no anisotropy;
   the CPU/DXT path uploads only mip 0; no uncompressed mip upload exists.

## Deliverable
A precise end-to-end trace (file:line) of the face normal map: parseDds format → buildDdsTexture return →
uNormalMap value → shader. State definitively whether the normal map renders or is a default, and the
exact change set to add an uncompressed-RGBA8 upload that uses the DDS's 9 mips + mipmap filtering +
anisotropy. No code — the trace + change list.
