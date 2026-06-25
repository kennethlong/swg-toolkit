# Codex task — parseShader gaps + renderer change set (SWG-Toolkit)

Read LOCKED axioms first: `.planning/research/CONSULT-MAT2-AXIOMS.md`. Don't contradict them.
Repos: `D:\Code\SWG-Toolkit` + `D:\Code\swg-client-v2`.

## Angle: map exactly what our pipeline parses today and the precise change set for CSHD + MATL.

1. Native `parseShader` — `packages/native-core/modules/core/formats/Shader.cpp` (+ binding + index.d.ts +
   contracts ShaderParseResult). Trace: how it handles `FORM SSHT` vs `FORM CSHD`; whether it recurses
   into CSHD's nested SSHT; whether it reads the `MATL` chunk (material colors); what `ShaderParseResult`
   exposes today (slots, customizationVars, effectPath). Cite file:line.
2. Identify the minimal native change to (a) recurse CSHD→nested SSHT so the MAIN/TXMS texture slots are
   returned for CSHD shaders, and (b) read MATL (ambient/diffuse/emissive/specular ARGB + specularPower)
   and expose it on ShaderParseResult.
3. Renderer: `appearanceResolver.resolveShader` + `swgMaterial.ts` (uniforms) + `SkinnedMeshView`/
   `StaticMeshView` material build. Where does the spec get computed; what uniform(s) must be added to
   carry `materialSpecularColor` (+ specularPower already = uSpecPower 32); how to wire MATL through
   resolver→material. List every site.
4. Conformance: `packages/harness/test/contract-conformance.test.ts` — what to add (MATL fields present;
   CSHD returns MAIN). Note the conformance-guard rule (every new binding field gets a guard).

## Deliverable
Ordered change list (file:line → change) across native parse → binding → contract → resolver → material
shader/uniforms → tests, for BOTH (CSHD nested-SSHT recursion) and (MATL material colors / spec temper).
Flag anything that could regress the working SSHT path (red droid, ackbar, han_solo body). No code.
