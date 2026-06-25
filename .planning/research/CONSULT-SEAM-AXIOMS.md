# LOCKED AXIOMS — white seams on animated skinned characters

Measured facts. **Treat as given. Do NOT re-derive or contradict.** Numbered for citation.

- **A1. Symptom:** A multi-part skinned character (ackbar: head+arms+body, ONE merged THREE.Skeleton,
  3 separate `THREE.SkinnedMesh` groups) shows **white/bright patches at the part seams**
  (shoulders, armpits, neck) that **appear/worsen during animation** (e.g. arms raised). At rest the
  seams look fine.
- **A2. Not missing textures:** every shader group on all 3 parts resolves a valid `MAIN` diffuse DDS
  (verified headlessly). So it is NOT the white-1×1 placeholder.
- **A3. Not a geometry gap / binding bug:** the parts deform together as one body (no visible gap to the
  dark background); skin binding into the merged skeleton is verified correct.
- **A4. Our VERTEX shader (`swgMaterial.ts`, verbatim, skinned=true):**
  ```glsl
  #include <skinning_pars_vertex>
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vViewDir; varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec3 transformed = vec3(position);
    #include <skinbase_vertex>
    #include <skinning_vertex>            // skins `transformed` (POSITION) only
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);   // uses the RAW bind-pose `normal` attribute
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
  ```
  (`normalMatrix` = THREE built-in = inverse-transpose of **modelViewMatrix**, i.e. VIEW space.)
- **A5. Our FRAGMENT shader lighting (verbatim, relevant lines):**
  ```glsl
  vec3 N = normalize(vNormal);                    // (+ optional tangent-space normal map)
  vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5));
  float NdotL = max(dot(N, lightDir), 0.0);
  vec3 V = normalize(vViewDir);
  vec3 H = normalize(lightDir + V);
  vec3 allDiffuse = clamp(vec3(0.3) + NdotL*vec3(0.7) + vec3(emisMask), 0.0, 1.0);
  vec3 litSurface = (diffuseColor * uMaterialColor.rgb * uTexFactor.rgb) * allDiffuse;
  float specInt = pow(max(dot(N, H), 0.0), uSpecPower);   // uSpecPower = 32
  vec3 spec = specInt * vec3(envMask);            // envMask = MAIN.alpha
  vec3 rgb = mix(litSurface, envColor, envWeight) + spec;   // envWeight=0 when bHasEnv=false
  gl_FragColor = vec4(rgb, 1.0); #include <colorspace_fragment>
  ```
- **A6. Geometry:** each part supplies its OWN `normal` attribute (from the `.mgn` group normals); the
  two parts meeting at a seam have INDEPENDENT normals at the boundary (separate meshes).
- **A7. Engine:** THREE.js r0.184, WebGL2. GPU skinning auto-enabled (SkinnedMesh + skinIndex/skinWeight +
  bound Skeleton). `<skinning_vertex>` transforms `transformed`; THREE also ships `<skinnormal_vertex>`
  (skins the normal) which this shader does NOT include.

## OPEN QUESTION
Why do the seams go white **during animation**, and what is the minimal correct fix? Diagnose against
A4–A6; do not assume the cause — derive it. (Candidate mechanisms to evaluate, not to assume: un-skinned
normal vs skinned position; view-space normal mixed with world-space light/view; additive specular blowout;
per-part normal discontinuity; envMask; tone-mapping. Find which actually produce the observed effect.)
