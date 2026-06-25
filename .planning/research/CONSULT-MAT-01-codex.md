Read `.planning/research/CONSULT-MAT-EVIDENCE.md` first (visual gaps + ground truth + code, treat as given).

YOUR ANGLE: the CUSTOMIZATION / PALETTE path — does `protocol_droid_red` get its RED from a runtime customization palette we are NOT applying?

Trace the real client (../swg-client-v2):
1. `CustomizableShaderTemplate` — how does a customizable shader (CSHD) define its customization variables (palette-material-color / palette-texture-factor / etc.)? How do those variables select a `.pal` palette and TINT the textures or material at render time? Which texture(s)/channel(s) does each customization pathway modify? (file:line)
2. The `.pal` palette format + how a customization index maps to a color ramp. For `protocol_droid_red`, what palette(s) does its CSHD reference, and is the RED a palette tint applied over a grey/neutral base diffuse — i.e. would the diffuse texture WITHOUT the palette read pale/desaturated (explaining our "faded pink")? Would different body regions (hands) use different palette entries (explaining our wrong hand color)?
3. In our code: `appearanceResolver.ts resolveShader` extracts `customizationVars` but our resolver does NOT store `.pal` bytes (the "palette missing" gap), and `swgMaterial`'s uMaterialColor/uTexFactor default to identity (1,1,1,1) — i.e. NO tint. Confirm whether wiring the palette (fetch `.pal`, resolve the customization index → tint color, feed uMaterialColor/uTexFactor) is what restores the SIE red. Spell out the exact data flow we must implement: which native parse (parsePalette?), which customization variable, how the index→color resolves, and how it feeds the shader uniforms per shader group.

Mount the real TREs to inspect (`require('D:/Code/SWG-Toolkit/packages/native-core')`, mountSearchableAsync, resolveEntry/readMountEntry). Look at `protocol_droid_red.sat`/`.cdf`/`.cstit` customization data if present, the CSHD `.sht`(s), and their `.pal`(s).

Output: definitive answer on whether the RED is a missing palette tint (YES/NO with evidence), the exact runtime customization→palette→tint data flow from swg-client-v2 (cited), and the concrete wiring we must add. If the red IS baked into the diffuse (not palette), say so and point at what else desaturates it.
