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
  /** ENVM slot is present (uses scene.environment cubemap). */
  hasEnv: boolean;
  /**
   * True when the SKMG group has a v0004 DOT3 tangent pool (hasDot3 from parsedMesh).
   * Controls TBN derivation strategy in the fragment shader.
   */
  hasDot3Tangents: boolean;
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

  // "transformed" is the Three.js convention for the current vertex position
  vec3 transformed = vec3(position);

${skinned ? `
  // Skinning: include base (computes boneMatX/Y/Z/W) then deform transform
  #include <skinbase_vertex>
  #include <skinning_vertex>
` : ''}

  // World-space position + view direction
  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPos.xyz;

  // World-space normal (normalMatrix is built-in Three.js mat3: inverse(transpose(modelViewMatrix)))
  vNormal = normalize(normalMatrix * normal);

  // Camera direction in world space
  vViewDir = normalize(cameraPosition - worldPos.xyz);

${hasDot3Tangents ? '  vTangent = tangent;' : ''}

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
  }

  // ─── Diffuse ───────────────────────────────────────────────────────────────
  vec4 diffuseSample = texture2D(uDiffuseMap, vUv);
  vec3 diffuse = diffuseSample.rgb;
  float alpha  = diffuseSample.a;

  // Pathway A (palette-material-color): distinct material color tint
  vec3 base = diffuse * uMaterialColor.rgb;

  // Pathway C (palette-texture-factor): distinct texture factor multiply
  vec3 finalColor = base * uTexFactor.rgb;

  // ─── Simple diffuse lighting ───────────────────────────────────────────────
  vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
  float NdotL = max(dot(N, lightDir), 0.0);
  finalColor = finalColor * (0.3 + 0.7 * NdotL);

  // ─── Specular ─────────────────────────────────────────────────────────────
  if (bHasSpec) {
    vec3 specSample = texture2D(uSpecularMap, vUv).rgb;
    vec3 R = reflect(-lightDir, N);
    float spec = pow(max(dot(vViewDir, R), 0.0), uSpecPower);
    finalColor += specSample * spec;
  }

  // ─── Emissive ─────────────────────────────────────────────────────────────
  if (bHasEmissive) {
    vec3 emisSample = texture2D(uEmissiveMap, vUv).rgb;
    finalColor += emisSample;
  }

  // ─── Environment map ──────────────────────────────────────────────────────
  if (bHasEnv) {
    vec3 envR = reflect(-vViewDir, N);
    vec3 envSample = textureCube(uEnvMap, envR).rgb;
    finalColor += envSample * 0.15; // subtle env contribution
  }

  gl_FragColor = vec4(finalColor, alpha * uMaterialColor.a * uTexFactor.a);
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
  } = opts;

  const material = new THREE.ShaderMaterial({
    vertexShader:   buildVertexShader(skinned, hasDot3Tangents),
    fragmentShader: buildFragmentShader(hasNormal, hasSpec, hasEmissive, hasEnv, hasDot3Tangents),
    uniforms: {
      // Sampler uniforms — default to white/black 1×1 placeholders
      uDiffuseMap:   { value: getWhite1x1() },
      uNormalMap:    { value: getWhite1x1() }, // neutral normal (0.5,0.5,1.0 in RGB) = (0,0,1) after decode
      uSpecularMap:  { value: getBlack1x1() },
      uEmissiveMap:  { value: getBlack1x1() },
      uEnvMap:       { value: null },          // wired from scene.environment in mesh view

      // Customization — pathway A (distinct from C)
      uMaterialColor: { value: new THREE.Vector4(1, 1, 1, 1) },

      // Customization — pathway C (distinct from A)
      uTexFactor: { value: new THREE.Vector4(1, 1, 1, 1) },

      // Surface
      uSpecPower: { value: 32.0 },

      // Bool flags (driven from opts, not changed at runtime)
      bHasNormal:   { value: hasNormal },
      bHasSpec:     { value: hasSpec },
      bHasEmissive: { value: hasEmissive },
      bHasEnv:      { value: hasEnv },
    },
    // DO NOT set `skinning` — removed in r140.
    // Skinning auto-enables from attributes + Skeleton.
    transparent: true,
    side: THREE.FrontSide,
    // Do NOT set glslVersion — Three.js automatically upgrades to GLSL3/300 es in WebGL2
    // (WebGLProgram.js:803-830) and adds #define aliases for texture2D/textureCube.
  });

  return material;
}
