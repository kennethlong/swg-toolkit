Read `.planning/research/CONSULT-COLOR-EVIDENCE.md` first (treat as given).

YOUR ANGLE: the StaticShader MATERIAL (MATL) chunk + how material colors modulate the texture in the real client.

Trace ../swg-client-v2:
1. `StaticShaderTemplate` / `StaticShader` — how is the Material (MATL) loaded and applied? What colors does a SWG Material carry (ambient/diffuse/specular/emissive), and where are they uploaded as pixel-shader constants or used in fixed-function? (`StaticShader::setMaterial`, the MATL/`Material` load path, the constant registers.)
2. Does `shader/c3po_red_all_aes17.sht` (SSHT) carry a MATL with a SATURATED RED diffuse/material color that multiplies the diffuse texture? DUMP the .sht's chunks (mount TREs via `require('D:/Code/SWG-Toolkit/packages/native-core')`, parseIff; the .sht is FORM SSHT — walk it and find MATL/`MATERIAL`/`TFAC`/`MCLT` chunks; decode the material color floats). Report the actual decoded material diffuse/ambient/emissive RGBA values.
3. Texture factor: does the shader set a TFAC color (per-texture-stage constant) that multiplies a stage? Decode it for this shader.
4. Conclude: is the SIE red produced by `texture * materialDiffuseColor` (or a texture factor) that we omit (we default uMaterialColor/uTexFactor to identity)? Give the exact decoded value + the swg-client-v2 file:line where it's applied, and the change we must make.

Output: the decoded MATL/TFAC values for c3po_red_all, the client's apply math (cited), and whether applying materialDiffuseColor/texFactor is the missing red. If MATL is white/identity (not the cause), say so and point at vertex colors or the lighting/pixel-shader constants instead.
