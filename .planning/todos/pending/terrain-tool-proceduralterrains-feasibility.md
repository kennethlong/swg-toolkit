---
id: terrain-tool-proceduralterrains-feasibility
title: Feasibility — using ProceduralTerrains (ZyFou) to create SWG terrain
created: 2026-06-27
origin: Maintainer research request — "could we use it to create terrain for SWG, and what would that entail?" repo: https://github.com/ZyFou/ProceduralTerrains
severity: research / scoping (not active work)
area: terrain (.trn / PTAT) — potential future tool
status: researched; verdict captured; not scheduled
---

## Verdict

**Feasible, but NOT a simple import — and the tool's most-exportable artifact (a heightmap PNG) is the
LEAST useful for SWG.** Verified against ground truth (two consult agents, 2026-06-27): the ProceduralTerrains
codebase + the real `swg-client-v2/sharedTerrain` loader. The fabricated `docs/02-formats/terrain.md`
was corrected to the real `PTAT` model as part of this.

## The two halves

**ProceduralTerrains = `terrain-studio` v0.9.6** (Three.js/WebGL, React+Vite). Terrain is a GPU
shader **height-field** (deterministic noise stack: FBM/ridged/billow/voronoi/dune/warp/terrace; Dave-
Hoskins hash + quintic value noise — NOT Perlin/Simplex). Has a real **export pipeline** (ZIP):
- GLB/OBJ **mesh** + collision mesh
- **heightmap PNG** (8-bit grayscale, 256-level)
- color / normal / **biome-splat** PNGs
- water mesh + **preset JSON** (re-importable params)
- The noise→height **CPU core is cleanly liftable** (`cpuNoise.js`/`noiseTypes.js`/`NoiseStack.js` — no
  Three.js import); the GPU height field + baked textures are renderer-bound.

**SWG terrain = `terrain/<name>.trn` = IFF `PTAT/0015`**, fully procedural (no baked heightmap). A tree
of `Layer` → Boundary(`BCIR/BREC/BPOL/BPLN`)/Filter(`FHGT/FFRA/FBIT/FSLP/...`)/Affector(`AHFR/AHCN/AHTR`
height, `ASCN/ASRP` texture, flora, ...). Height-fractal affectors reference a shared `FractalGroup`
**MultiFractal** by family id. Core3 parses the same `PTAT` server-side. (Full verified model now in
`docs/02-formats/terrain.md` §1–§2.)

## Why the obvious path is blocked

- **Heightmap → elevation: NOT supported.** The height-from-bitmap affector `AHBM` was REMOVED
  ("no longer exists", `TerrainGeneratorLoader.cpp:226–264`). So the tool's 8-bit heightmap PNG cannot be
  injected as SWG elevation.
- The only surviving raster path is `FBIT` — an 8-bit grayscale `.tga` used as a **mask/weight** (region
  gating *where* procedural affectors apply), not height. The tool's splat/region masks COULD feed this.

## The two real strategies

- **(A) Raster heightmap → faithful elevation:** not directly possible. Options: approximate as
  fractal+constant affectors (lossy), or use `FBIT` masks to region-gate procedural height (placement,
  not exact elevation).
- **(B) Procedural → procedural (the natural fit):** map the tool's noise bands → `FractalGroup`
  MultiFractal families + boundaries/filters → emit `AHFR`/`AHCN` affector layers. **Catch: fractal
  parity.** SWG's `sharedFractal` MultiFractal ≠ the tool's hash-noise, so the tool's preview won't
  reproduce in-game unless SWG's noise is ported (or divergence accepted).

## What building it would entail

1. A byte-exact **`PTAT/0015` IFF writer** (read offsets from `ProceduralTerrainAppearanceTemplate::write`
   `:1035–1113`; validate vs a real `.trn` hexdump — the old doc serializer was fabricated).
2. A **noise-params → FractalGroup + affector-tree** translator (the hard part: MultiFractal parity).
3. Consistent shared-group/family-id wiring (Fractal/Shader/Flora groups).
4. `BakedTerrain` + packed flora maps (collision/passability) — can start minimal.
5. **Client + server (Core3) parity** — the `.trn` must load on both.

Realistic near-term use: ProceduralTerrains as a **visual design/preview** tool; its **masks** feed
`FBIT`. A true "generate → export → load in SWG" pipeline ≈ building most of an SWG terrain authoring
tool (a TerrainEditor successor). Sizeable; its own milestone/phase if pursued.

## Noise-parity decision (maintainer Q, 2026-06-27) — reuse SWG MultiFractal, don't port foreign noise

The question: add Dave-Hoskins+quintic (the tool's noise) as a terrain alternative, OR add an SWG noise
generator to the app? **Decision: the latter — and via native-core reuse, not reimplementation.**

Deciding constraint: the **stock SWG client computes terrain noise itself (`MultiFractal`) and cannot
import a heightmap OR a foreign noise function.** Parity is only solvable at the authoring/preview end.

- **Dave-Hoskins as a terrain alternative:** to render in-game you'd have to add a NEW height-affector
  type to the client engine AND Core3 server (a fork-only engine change that breaks stock-SWGEmu/Core3
  compatibility). As a toolkit-only preview it's cheap but WYSIWYG-broken (won't match in-game). Reject
  for "author deployable SWG terrain."
- **SWG `MultiFractal` in the app (recommended):** author/preview with SWG's own noise → preview matches
  in-game → emit standard `PTAT`/`AHFR` → runs on stock clients + Core3, no engine changes. CHEAPER than
  it looks because the toolkit **already reuses `swg-client-v2` C++ via the native core** — expose
  `sharedFractal::MultiFractal` through N-API and use the SAME code path for preview AND `.trn` emission.
  Parity is then **free by construction** (identical math in preview and game), not something to chase.
- Reserve the ProceduralTerrains noise-stack / live-edit model as **UX inspiration**, not shipped math.
- Changes only if the goal is a general terrain playground that need not run in real SWG (then either
  noise is fine — but it isn't "SWG terrain").

## Done as part of this research
- Corrected `docs/02-formats/terrain.md` to the verified `PTAT` model (the draft was substantially
  fabricated — wrong FORM tag, wrong chunk tags, invented noise + serializer).
- Cloned repo for reading lives in scratch (not committed): `…/scratchpad/ProceduralTerrains`.
