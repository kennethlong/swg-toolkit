---
id: viewport-shader-blend-mode
title: Per-shader alpha mode (opaque / alpha-test cutout / alpha-blend) from the .eft effect
created: 2026-06-24
origin: Phase 02 03 testing — all meshes rendered semi-transparent (diffuse alpha treated as opacity)
severity: medium
area: renderer / material + native shader/effect parsing
status: pending
---

## Context

swgMaterial originally output `gl_FragColor.a = diffuseSample.a` with `transparent:true`, so every
mesh rendered semi-transparent (the droid was see-through). On SWG shader families (aes17/as8/...)
the diffuse alpha is a SPECULAR/gloss mask, not opacity. Fixed in 02-03 by defaulting to OPAQUE
(`alpha=1.0`, `transparent:false`).

## The real model (for later)

SWG transparency/cutout is NOT in the `.sht` — it's in the `.eft` EFFECT the shader references
(blend state, alpha-test). We don't parse `.eft` yet. So the current opaque default is correct for
the common case (characters, objects) but will render genuinely-transparent assets wrong:
- **Alpha-blend** (glass, water, some FX, holograms): should blend.
- **Alpha-test / cutout** (foliage leaf-cards, fences, hair): should `discard` below a threshold.
  NOTE: do NOT use alphaTest on spec-in-alpha shaders — it would punch holes in the spec mask.

## Fix (when desired)

1. Parse the `.eft` effect (or extract the blend/alpha-test state) referenced by the shader; expose
   an alpha-mode enum on the shader parse result (opaque | mask | blend) + alphaTest threshold.
   Ground truth: ../swg-client-v2 effect/shader implementation (StaticShader/Effect/.eft loader).
2. swgMaterial: set transparent/alphaTest/depthWrite per that mode. Keep opaque as the default
   when unknown.
3. Verify foliage (decd_tallbirch leaf-cards → cutout) and an opaque character both look right.

## Severity

Medium — opaque default is correct for most assets and unblocked 02-03. Transparent/cutout assets
look wrong until this lands. Candidate for a later rendering-fidelity pass.
