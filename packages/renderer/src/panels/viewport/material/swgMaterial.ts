/**
 * packages/renderer/src/panels/viewport/material/swgMaterial.ts
 *
 * buildSwgMaterial — Factory for the SWG custom ShaderMaterial.
 *
 * Implements SWG's multi-map material pipeline:
 *   - Diffuse (MAIN slot → uDiffuseMap sampler2D)
 *   - Normal map (NRML/CNRM → uNormalMap; authored DOT3 when hasDot3Tangents, else dFdx/dFdy TBN)
 *   - Specular (SPEC → uSpecularMap + phong with uSpecPower)
 *   - Emissive (EMIS → uEmissiveMap)
 *   - Environment (ENVM → uEnvMap samplerCube, from drei <Environment> scene.environment)
 *
 * Customization channels (DISTINCT — see CustomizableShaderTemplate.cpp:1246-1286):
 *   A = palette-material-color   → uMaterialColor vec4  (affects ambient/diffuse tint)
 *   C = palette-texture-factor   → uTexFactor vec4      (texture factor multiply)
 *   Both default to (1,1,1,1) = identity (no tint).
 *
 * GPU skinning coexistence:
 *   When skinned=true: vertex shader includes <skinning_pars_vertex> at top and
 *   <skinning_vertex> after the position transform. Three.js r0.184+ activates
 *   GPU skinning automatically when skinIndex + skinWeight attributes exist AND
 *   a Skeleton is bound. DO NOT set material.skinning (removed in r140).
 *
 * ALL sampler uniforms declared in the FRAGMENT shader (not vertex).
 * Zero-alloc uniform mutation: uniforms.uTexFactor.value.set(r,g,b,a).
 *
 * Source: RESEARCH.md § Pattern 4 + synthesis §2 (GPU skinning chunks, uniforms, zero-alloc).
 *         swg-client-v2 CustomizableShaderTemplate.cpp:1246-1286 (pathways A/B/C).
 *         swg-client-v2 StaticShaderTemplate.cpp:32-36,123-128,482-565 (slot semantics).
 */

import * as THREE from 'three';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface SwgMaterialOptions {
  /** True for SkinnedMesh (includes <skinning_pars_vertex> + <skinning_vertex> chunks). */
  skinned: boolean;
  /** NRML/CNRM slot is present. */
  hasNormal: boolean;
  /** SPEC slot is present. */
  hasSpec: boolean;
  /** EMIS slot is present. */
  hasEmissive: boolean;
  /** ENVM slot is present (cube map from slotBytes[ENVM] or scene.environment). */
  hasEnv: boolean;
  /**
   * True when the SKMG group has a v0004 DOT3 tangent pool (hasDot3 from parsedMesh).
   * Controls TBN derivation strategy in the fragment shader.
   */
  hasDot3Tangents: boolean;
  /**
   * Blend state from the .eft effect (gap-closure 02-03).
   * When null: defaults to opaque (alphaBlend=false, alphaTest=false, zWrite=true).
   * Source: ShaderImplementationPass::load_0009 DATA chunk blend state fields.
   */
  effectBlend?: {
    alphaBlendEnable: boolean;
    blendSrc: number;
    blendDst: number;
    alphaTestEnable: boolean;
    alphaTestRef: number;
    zWrite: boolean;
  } | null;
  /**
   * MATL material colors (from ShaderParseResult.material). Only specular + specularPower are
   * consumed: spec is scaled by materialSpecularColor (per a_specmap_pp_ps20.psh) so skin/matte
   * surfaces aren't over-shiny, and the Phong exponent comes from MATL instead of a hardcoded 32.
   * Undefined ⇒ identity defaults (specular white, power 32) which preserve prior renders.
   * (ambient/diffuse/emissive are intentionally NOT applied — identity/zero in all measured
   * character shaders; wiring them adds risk with no visible gain.)
   */
  material?: {
    specular: [number, number, number];
    specularPower: number;
  } | null;
}

// ─── GLSL source ──────────────────────────────────────────────────────────────

function buildVertexShader(skinned: boolean, hasDot3Tangents: boolean): string {
  // Three.js skinning conventions (r0.184):
  //   - #include <skinning_pars_vertex> declares uniforms (bindMatrix, boneTexture) + getBoneMatrix()
  //   - #include <skinbase_vertex>      declares boneMatX/Y/Z/W from skinIndex attribute
  //   - #include <skinning_vertex>      transforms `transformed` using skin matrices
  //   - `transformed` = built-in variable name Three.js uses for the pre-transform position
  //   - `normalMatrix` = built-in mat3 uniform set by Three.js (model-view normal transform)
  //   The `USE_SKINNING` define is set automatically by Three.js when the mesh is SkinnedMesh.
  return /* glsl */`
${skinned ? '#include <skinning_pars_vertex>' : ''}

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
${hasDot3Tangents ? 'attribute vec4 tangent;\nvarying vec4 vTangent;' : ''}

void main() {
  vUv = uv;

  // "transformed" is the Three.js convention for the current vertex position.
  vec3 transformed = vec3(position);

  // Declare objectNormal (= normal) BEFORE skinning so <skinnormal_vertex> can deform it.
  #include <beginnormal_vertex>

${skinned ? `
  // Skin BOTH position and normal. <skinbase_vertex> builds boneMatX/Y/Z/W;
  // <skinnormal_vertex> deforms objectNormal by the same skinMatrix; <skinning_vertex>
  // deforms the position. Skinning the NORMAL is essential: the real client bone-deforms
  // normals too (SoftwareBlendSkeletalShaderPrimitive.cpp). Lighting a bind-pose normal on
  // a deformed position is what made the seams blow out white during animation.
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
` : ''}

  // World-space position + view direction.
  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPos.xyz;

  // World-space normal, consistent with lightDir/vViewDir (which are world-space).
  // Do NOT use normalMatrix here — that is inverse-transpose of modelVIEW (view space),
  // which mismatched the world-space light/view vectors. mat3(modelMatrix) is correct for
  // rigid / uniform-scale model transforms. RENORMALIZE: the blended skinMatrix is not
  // length-preserving, so the skinned objectNormal is non-unit.
  vNormal = normalize(mat3(modelMatrix) * objectNormal);

  // Camera direction in world space.
  vViewDir = normalize(cameraPosition - worldPos.xyz);

${hasDot3Tangents ? '  // TODO: skin the tangent (USE_TANGENT/<skinnormal_vertex>) when DOT3 normal maps are active.\n  vTangent = tangent;' : ''}

  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`.trimStart();
}

function buildFragmentShader(
  hasNormal: boolean,
  hasSpec: boolean,
  hasEmissive: boolean,
  hasEnv: boolean,
  hasDot3Tangents: boolean,
): string {
  return /* glsl */`
precision mediump float;

// ─── Sampler uniforms (ALL in fragment shader, never vertex) ──────────────────
uniform sampler2D uDiffuseMap;
uniform sampler2D uNormalMap;
uniform sampler2D uSpecularMap;
uniform sampler2D uEmissiveMap;
uniform samplerCube uEnvMap;

// ─── Customization uniforms ───────────────────────────────────────────────────
// Pathway A: palette-material-color → distinct material color tint
uniform vec4 uMaterialColor;
// Pathway C: palette-texture-factor → distinct texture factor multiply
uniform vec4 uTexFactor;

// ─── Surface uniforms ─────────────────────────────────────────────────────────
uniform float uSpecPower;
uniform vec3  uMatSpecular;   // = MATL.specularColor.rgb (identity = white); tempers the spec term
uniform bool bMainHasAlpha;   // false when MAIN is DXT1/no-alpha (its alpha is NOT a gloss mask)
uniform bool bHasNormal;
uniform bool bHasSpec;
uniform bool bHasEmissive;
uniform bool bHasEnv;

// ─── Varyings ─────────────────────────────────────────────────────────────────
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
${hasDot3Tangents ? 'varying vec4 vTangent;' : ''}

void main() {
  // ─── Normal ────────────────────────────────────────────────────────────────
  vec3 N = normalize(vNormal);
  vec3 geoN = N;   // smooth geometric (pre-normal-map) normal — used to tame specular
  if (bHasNormal) {
    vec3 tangentSpaceNormal = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
${hasDot3Tangents ? `
    // Authored DOT3 TBN from SKMG v0004 tangent pool
    vec3 T = normalize(vTangent.xyz);
    vec3 B = cross(N, T) * vTangent.w;
    mat3 TBN = mat3(T, B, N);
    N = normalize(TBN * tangentSpaceNormal);
` : `
    // Derivative TBN (fallback when no DOT3 pool)
    vec3 dPdx = dFdx(vWorldPos);
    vec3 dPdy = dFdy(vWorldPos);
    vec2 dUdx = dFdx(vUv);
    vec2 dUdy = dFdy(vUv);
    float det = dUdx.x * dUdy.y - dUdy.x * dUdx.y;
    if (abs(det) > 0.0001) {
      vec3 T = normalize((dPdx * dUdy.y - dPdy * dUdx.y) / det);
      vec3 B = normalize((dPdy * dUdx.x - dPdx * dUdy.x) / det);
      mat3 TBN = mat3(T, B, N);
      N = normalize(TBN * tangentSpaceNormal);
    }
`}
    // Normal-map LOD fade — fixes the distance-dependent "line / weird pattern on the face"
    // (visible zoomed out, perfect up close). Under minification each pixel spans many texels,
    // the derivative TBN samples across them, and the high-frequency normal map aliases into
    // patterns. Fade the bumped normal toward the smooth geometric normal as the surface
    // minifies (large screen-space UV gradient) — full bump detail close, clean shading far.
    float uvGrad   = max(length(dFdx(vUv)), length(dFdy(vUv)));
    float bumpFade = 1.0 - smoothstep(0.006, 0.025, uvGrad);   // 1 = up close, 0 = far/minified
    N = normalize(mix(geoN, N, bumpFade));
  }

  // ─── Diffuse sample ────────────────────────────────────────────────────────
  // NOTE: on SWG shader families (aes17/as8/...) the diffuse alpha is a SPECULAR/gloss
  // mask, NOT opacity. Meshes are opaque by default; true transparency/cutout comes from
  // the .eft effect (not parsed yet). Do NOT drive fragment alpha from diffuseSample.a.
  vec4 diffuseSample = texture2D(uDiffuseMap, vUv);

  // ─── Lighting setup ───────────────────────────────────────────────────────
  // SWG directional light (normalised) + ambient floor. (The proper scene light rig is the
  // VIEW-MAT-FIDELITY pass; a camera-relative variant was used briefly to confirm the face
  // artifact was texture, not lighting — see normal-map LOD fade above.)
  vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
  float NdotL   = max(dot(N, lightDir), 0.0);
  // Half-vector for Blinn-Phong specular (FIX 3/4 use V+L, not R)
  vec3 V = normalize(vViewDir);
  vec3 H = normalize(lightDir + V);

  // ─── FIX 4 — Emissive folded into the diffuse-light term ─────────────────
  // SWG: allDiffuseLight = saturate(NdotL*lightColor + ambient + emisMask)
  // emisMask = EMIS.a when bHasEmissive, else 0.0 (red droid has no EMIS slot).
  // Self-illum floor ensures emissive texels glow even with no direct light.
  float emisMask = 0.0;
  if (bHasEmissive) {
    emisMask = texture2D(uEmissiveMap, vUv).a;
  }
  // The old separate finalColor += emisSample is REMOVED; self-illum is inside the clamp.
  // Ambient floor = 0.40 (was 0.30): the real client's shadow side is lifted by the per-vertex
  // ambient+fill+bounce term (vertexDiffuse ≈ 0.38-0.42 outdoor midday), not a flat 0.30 — our
  // crushed dark side was simply the floor being too low. NdotL scale drops to 0.60 so the lit
  // side still peaks at exactly 1.0 at NdotL=1 (no overflow, lit side + spec/env unchanged).
  // NOTE: a full hemispheric model (colored sky/ground) needs scene-derived ambient color we
  // don't have yet — for a neutral viewer it collapses to this raised floor (see VIEW-MAT-FIDELITY).
  vec3 allDiffuse = clamp(vec3(0.40) + NdotL * vec3(0.60) + vec3(emisMask), 0.0, 1.0);

  // ─── FIX 3 — Env reflection is mix(), not additive ────────────────────────
  // Real HLSL (a_envmask_specmap_ps20.psh): result.rgb = lerp(litSurface, envColor, envMask) + specLight
  // envMask = MAIN.alpha (same alpha that was spec mask). Mean ~0.27 → subtle reflection.
  // Our old "finalColor += envSample * specMask" (additive, full-strength) was the pink wash.
  vec4  mainSample   = diffuseSample;        // already read above
  vec3  diffuseColor = mainSample.rgb;
  float envMask      = mainSample.a;         // MAIN.alpha = specular/gloss mask

  // Pathway A + C tints still applied (identity unless palette wired)
  vec3  tinted       = diffuseColor * uMaterialColor.rgb * uTexFactor.rgb;
  vec3  litSurface   = tinted * allDiffuse;

  // Specular: Blinn-Phong masked by the same envMask (per HLSL convention), GATED by NdotL.
  // The real client computes specular via the lit() instruction, which yields ZERO specular
  // when NdotL <= 0 (no highlight on faces turned away from the light). Without this gate a
  // grazing/incorrect normal produced a spurious highlight that — added on top of a saturating
  // diffuse and ACES-tonemapped — clipped to WHITE at the deformed part seams.
  // Faithful spec (a_specmap_pp_ps20.psh): allSpecular = (specInt * lightSpecColor *
  // materialSpecularColor) * specularMask. lightSpecColor is white in this viewport; the
  // material specular color (uMatSpecular, from MATL) tempers the highlight so skin/matte
  // surfaces aren't blasted to full-intensity white. specularMask = MAIN.alpha (envMask).
  // specularMask = MAIN.alpha — BUT only when MAIN actually HAS an alpha channel. A DXT1
  // (no-alpha) diffuse samples alpha as 1.0, which is the ABSENCE of a gloss map, not a
  // full-gloss surface. Treating that 1.0 as a mask blasts skin/matte DXT1 surfaces with
  // full specular (the over-bright Han Solo face: face=DXT1 no-alpha vs body=DXT5 mask≈0.6,
  // measured 1.64× peak spec). When there's no real mask, fall back to a moderate default
  // (~0.5 ≈ a typical authored gloss value) instead of 1.0 — keeps a modest highlight (small
  // DXT1 bits like eyes) without blowing out large skin surfaces.
  float specMask = bMainHasAlpha ? envMask : 0.5;
  // Specular uses a LESS-perturbed normal than diffuse. Our no-DOT3 path reconstructs the TBN
  // from screen-space derivatives (dFdx/dFdy), which jitter on curved/detailed normal maps and
  // make a single texel swing dot(N,H) toward 1 → firefly spec hotspots (bright patches on
  // shins/arms). Blending the bumped normal back toward the smooth geometric normal for the
  // SPEC lobe only kills those hotspots while diffuse keeps full normal-map detail.
  vec3  Nspec    = bHasNormal ? normalize(mix(geoN, N, 0.55)) : N;
  float specInt  = NdotL > 0.0 ? pow(max(dot(Nspec, H), 0.0), uSpecPower) : 0.0;
  vec3  spec     = specInt * uMatSpecular * specMask;  // material-tempered, gloss-masked

  // Env cube LERP (FIX 3): mix towards env only where gloss mask is high.
  // When bHasEnv=false: blend weight = 0.0 → pure litSurface (a_simple path).
  // env_theed.dds is an sRGB-authored LDR color cube (set NoColorSpace in ddsTexture, so the
  // GPU does NOT decode it). Decode sRGB→linear HERE so the mix happens in linear space — else
  // the env is ~2x too bright and a warm Theed cube washes the red base to brown.
  vec3 envColor  = bHasEnv ? pow(textureCube(uEnvMap, reflect(-V, N)).rgb, vec3(2.2)) : vec3(0.0);
  // Gate env to actual HIGHLIGHTS (envMask * specular intensity), NOT a flat 27% LERP over the
  // whole surface. env_theed is a bright gray-tan cube; a flat mask wash desaturates the maroon
  // base [128,72,84] to brown [128,90,90]. Crew-verified (4 AIs): the asset carries no extra red
  // (material/texfactor/vertex-color all white/absent) — the brown was OUR env wash. So show the
  // texture at face value and let env contribute only where it's actually glossy/highlighted.
  float envWeight = bHasEnv ? envMask * specInt : 0.0;
  vec3 rgb       = mix(litSurface, envColor, envWeight) + spec;

  // ─── FIX 2 — output encode (sRGB) ────────────────────────────────────────
  // Three.js ShaderMaterial with SRGBColorSpace output: must call the linearToOutputTexel
  // hook injected by WebGLProgram as #include <colorspace_fragment> (last line of main).
  // This encodes our linear-space rgb to sRGB for display. DO NOT also pow(2.2) — double-encode.
  gl_FragColor = vec4(rgb, 1.0);
  #include <colorspace_fragment>
}
`.trimStart();
}

// ─── White 1×1 default texture (module-scope to avoid re-allocation) ─────────

let _white1x1: THREE.DataTexture | null = null;

function getWhite1x1(): THREE.DataTexture {
  if (!_white1x1) {
    _white1x1 = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1, 1,
      THREE.RGBAFormat,
    );
    _white1x1.needsUpdate = true;
  }
  return _white1x1;
}

// ─── Black 1×1 default for non-emissive/non-spec slots ───────────────────────

let _black1x1: THREE.DataTexture | null = null;

function getBlack1x1(): THREE.DataTexture {
  if (!_black1x1) {
    _black1x1 = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]),
      1, 1,
      THREE.RGBAFormat,
    );
    _black1x1.needsUpdate = true;
  }
  return _black1x1;
}

// ─── 1×1 cube placeholder (valid samplerCube so uEnvMap is never null) ───────────
// Cursor cited WebGLUniforms.js:616 (null → emptyCubeTexture substitution); Sonnet warned
// ANGLE/D3D11 may still drop the draw on an unbound samplerCube. A valid 1×1 cube satisfies
// both: the uniform is always a complete bound cube. bHasEnv (set per-mesh) gates real sampling.
let _envCube1x1: THREE.CubeTexture | null = null;
function getEnvCube1x1(): THREE.CubeTexture {
  if (!_envCube1x1) {
    const face = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    face.needsUpdate = true;
    _envCube1x1 = new THREE.CubeTexture(
      [face, face, face, face, face, face] as unknown as HTMLImageElement[],
    );
    _envCube1x1.generateMipmaps = false;
    _envCube1x1.needsUpdate = true;
  }
  return _envCube1x1;
}

// ─── Material factory ─────────────────────────────────────────────────────────

/**
 * Build a custom ShaderMaterial implementing SWG's material model.
 *
 * DO NOT set material.skinning — it was removed in Three.js r140.
 * Skinning auto-enables from skinIndex/skinWeight attributes + bound Skeleton.
 *
 * Returns a ShaderMaterial with typed uniforms for zero-alloc mutation:
 *   material.uniforms.uTexFactor.value.set(r, g, b, a)    // pathway C
 *   material.uniforms.uMaterialColor.value.set(r, g, b, a) // pathway A
 */
export function buildSwgMaterial(opts: SwgMaterialOptions): THREE.ShaderMaterial {
  const {
    skinned,
    hasNormal,
    hasSpec,
    hasEmissive,
    hasEnv,
    hasDot3Tangents,
    effectBlend,
    material: matlColors,
  } = opts;

  // MATL material specular (rgb) + Phong power. Defaults preserve prior renders when MATL is
  // absent: white specular (matches the old un-tempered look) and the old hardcoded power 32.
  const matSpec = matlColors?.specular ?? [1, 1, 1];
  const matSpecPower = (matlColors?.specularPower && matlColors.specularPower > 0)
    ? matlColors.specularPower
    : 32.0;

  // Blend state from .eft effect (gap-closure 02-03).
  // Default = opaque (no alpha blend, no alpha test, depth write on).
  // Source: ShaderImplementationPass::load_0009 DATA chunk (ShaderImplementation.cpp:1692-1738).
  const blend = effectBlend ?? null;
  const alphaBlendEnabled = blend?.alphaBlendEnable ?? false;
  const alphaTestEnabled  = blend?.alphaTestEnable  ?? false;
  const zWriteEnabled     = blend?.zWrite            ?? true;

  // For Three.js: transparent=true enables WebGL alpha blending.
  // alphaTest: 0 = disabled; >0 = fragment discarded when alpha <= alphaTest.
  // depthWrite: false when zWrite=false (transparent surfaces).
  const isTransparent = alphaBlendEnabled;
  const alphaTestThreshold = alphaTestEnabled
    ? (blend ? (blend.alphaTestRef / 255.0) : 0)
    : 0;

  const material = new THREE.ShaderMaterial({
    vertexShader:   buildVertexShader(skinned, hasDot3Tangents),
    fragmentShader: buildFragmentShader(hasNormal, hasSpec, hasEmissive, hasEnv, hasDot3Tangents),
    uniforms: {
      // Sampler uniforms — default to white/black 1×1 placeholders
      uDiffuseMap:   { value: getWhite1x1() },
      uNormalMap:    { value: getWhite1x1() }, // neutral normal (0.5,0.5,1.0 in RGB) = (0,0,1) after decode
      uSpecularMap:  { value: getBlack1x1() },
      uEmissiveMap:  { value: getBlack1x1() },
      uEnvMap:       { value: getEnvCube1x1() }, // valid 1×1 cube default (never null); real cube wired in mesh view

      // Customization — pathway A (distinct from C)
      uMaterialColor: { value: new THREE.Vector4(1, 1, 1, 1) },

      // Customization — pathway C (distinct from A)
      uTexFactor: { value: new THREE.Vector4(1, 1, 1, 1) },

      // Surface
      uSpecPower:    { value: matSpecPower },
      uMatSpecular:  { value: new THREE.Vector3(matSpec[0], matSpec[1], matSpec[2]) },
      // Default true; the mesh view sets false when the bound MAIN DDS has no alpha channel.
      bMainHasAlpha: { value: true },

      // Bool flags (driven from opts, not changed at runtime)
      bHasNormal:   { value: hasNormal },
      bHasSpec:     { value: hasSpec },
      bHasEmissive: { value: hasEmissive },
      bHasEnv:      { value: hasEnv },
    },
    // DO NOT set `skinning` — removed in r140.
    // Skinning auto-enables from attributes + Skeleton.
    //
    // Blend state from .eft (gap-closure 02-03):
    //   - transparent=true enables WebGL alpha blending (from alphaBlendEnable)
    //   - alphaTest=0 disables; >0 discards fragments with alpha <= threshold (from alphaTestEnable)
    //   - depthWrite=false when the .eft says zWrite=false (transparent surfaces)
    //   When no .eft is present: opaque defaults (transparent=false, alphaTest=0, depthWrite=true).
    transparent: isTransparent,
    alphaTest: alphaTestThreshold,
    depthWrite: zWriteEnabled,
    side: THREE.FrontSide,
    // Do NOT set glslVersion — Three.js automatically upgrades to GLSL3/300 es in WebGL2
    // (WebGLProgram.js:803-830) and adds #define aliases for texture2D/textureCube.
  });

  return material;
}
