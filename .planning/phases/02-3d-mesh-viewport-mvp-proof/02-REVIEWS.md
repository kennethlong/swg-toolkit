---
phase: 2
round: 2
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-06-23
plans_reviewed: [02-01-PLAN.md, 02-02-PLAN.md, 02-03-PLAN.md, 02-04-PLAN.md, 02-05-PLAN.md]
method: >
  Post-replan VERIFICATION round. The round-1 --reviews replan (commit 90cc3a1) + upstream doc
  fixes (d10ea37) were re-checked by the consult crew. Each reviewer was handed NEUTRAL evidence
  (the plan's claim + the real ../swg-client-v2 source file) and asked to confirm/refute byte-for-byte
  — not to rubber-stamp. Non-overlapping angles. Disputed HIGHs were then fact-checked by the
  orchestrator directly against source before being accepted. Round-1 REVIEWS preserved in git history.
---

# Cross-AI Plan Review — Phase 2 (Round 2, post-replan verification)

The round-1 replan fixed the convergent animation byte-layout failure. This round VERIFIES the corrected
plans against ground truth. **Three independent source-readers (Codex, Cursor, Opus) confirmed the
byte-layout spine is now correct** — including the subtle CKAT `halfRange = baseSeparation` identity and
the SKMG 9×int32 / SKTM-BPMJ-version-branch fixes. **The lateral pass (Sonnet) caught one real HIGH byte
error the internal checker missed (CKAT SROT field order), plus a real `.apt` semantic gap and a COLLADA
scope bug.** Net: spine solid, three surgical corrections required before execute.

---

## Codex (02-04 animation byte tables + install() port) — CONFIRMED, 1 LOW

Opened all three animation loaders; confirmed 8/9 claims byte-for-byte:
- CKAT INFO = fps + 6×int16, frameCount FIRST (`CompressedKeyframeAnimationTemplate.cpp:1201-1212`) ✓
- KFAT-0003 INFO = fps + 6×int32, same order (`KeyframeSkeletalAnimationTemplate.cpp:1521-1532`) ✓
- CKAT XFIN = name+int8+int16+uint8+3×int16 (`:1221-1245`) ✓; KFAT XFIN = name+int8+int32+uint32+3×int32 (`:1541-1563`) ✓
- CKAT QCHN = int16 keyCount; uint8 x/y/z fmt ONCE PER CHANNEL; per-key int16 frame + uint32 packed (`:553-594`) ✓
- KFAT-0003 QCHN sparse = int32 keyCount; per-key int32 frame + read_floatQuaternion (`:521-553`) ✓
- on-disk (w,x,y,z) order ✓; 255-entry `formatId|baseIndex` table + doExpand ✓
- **CKAT SROT actual order = `uint8 xFmt, yFmt, zFmt` THEN `uint32 packed` (`:1265-1280`)** — see Agreed Concern #1.
- LOW: `w = sqrt(max(0,…))` is NOT a verbatim port — source does bare `sqrt(1-(x²+y²+z²))` (`:377-379`). The clamp is a deliberate (crew-approved) safety deviation; the plan should LABEL it as such, not as "verbatim".

## Cursor (02-01 / 02-02 mesh, skeleton, palette, texture wiring) — ALL CONFIRMED, 2 LOW

Byte-exact against source for every checked claim:
- `.pal` RIFF PAL: 24-byte header + entryCount×4; `versionOrComponentCount != 4 → alpha=255`; parser-native, not IFF (`PaletteArgb.cpp:411-522`) ✓ — actual file is `sharedMath/PaletteArgb.cpp`, plan cites `clientGraphics/` (LOW).
- LDTB distances inside INFO: int16 levelCount + per-level float32 (min,max), linear on disk, squared at runtime (`LodDistanceTable.cpp:145-173`) ✓
- Uint32 de-index ✓; static `.msh` LSPT-0001 stores **uint16** on disk → must widen (02-01 already documents) (`ShaderPrimitiveSetTemplate.cpp:935-966`)
- SKMG INFO = **9×int32 + 4×int16**, `transformWeightDataCount` read FROM INFO (`SkeletalMeshGeneratorTemplate.cpp:2258-2341`) ✓
- SKTM **BPMJ mandatory v0001 / absent v0002** (`BasicSkeletonTemplate.cpp:279-387`) ✓
- texture-byte plumbing 02-02→02-03 internally consistent ✓ — LOW: `02-PATTERNS.md` `AppearanceResolutionResult` snippet omits `slotBytes` on `ResolvedMaterial` (see Agreed Concern #4).

## Opus (compressed-quaternion math + export mirror algebra) — NO WRONG FORMULAS

Re-derived every constant from source:
- `halfRange = 0.5·calculateRange(shift) = 2/(2^shift+1) = baseSeparation` — algebraic identity, the plan's substitution is exact, and the de-anchoring note against the naive `half_range=1.0` was warranted (`CompressedQuaternion.cpp:393`).
- formatId map {0xFE…0x80}, baseIndexMask, baseCount=2^shift, `formatId|i` table build, expand 1023/511, x,y=11-bit z=10-bit, doExpand reconstruction — ALL confirmed (`:82-122,156-228,370-419`). w-clamp confirmed safe.
- 02-05 mirror: `flip·M·flip` conjugation correct; inverse-bind consistent (`mirror(M⁻¹)=mirror(M)⁻¹`); winding-reversal AND normal.x-negation are BOTH required (topology vs shading — not double-correct); quat `(w,x,−y,−z)` **independently derived as CORRECT** and matches the Blender reference (`export_animation.py:154-162`).
- MEDIUM clarifications (C1/C2): 02-05 should explicitly state that 02-04's tracks are **absolute local rotations** (not bind-relative deltas) and that translations are **local-space** — the prerequisites that make the dual matrix/closed-form mirror provably consistent. LOW guards: code-enforce (not just comment) the no-double-apply; derive inverse-bind by inverting the mirrored bind.

## Sonnet (lateral / new-fabrication hunt) — 3 HIGH (2 confirmed real, 1 = COLLADA scope), MEDIUM/LOW

- **H-1 CONFIRMED REAL (orchestrator-verified):** 02-04 line 163 CKAT SROT = `uint32 compressedRotation + uint8 xFmt,yFmt,zFmt` — **reversed**. Source reads formats FIRST (`:1273-1276`). Agrees with Codex #7. → Agreed Concern #1.
- **H-3 CONFIRMED REAL (orchestrator-verified vs source):** `.apt` is a single-string REDIRECTOR (`FORM APT → FORM 0000 → CHUNK NAME → read_string`; FATAL on multi-level), `AppearanceTemplateList.cpp:513-540`. Target may be `.msh`/`.lmg`/`.dtla` resolved by extension — NOT necessarily `.msh`. Plan oversimplifies + leaves oracle unpinned. → Agreed Concern #2.
- **H-2 (scope/expectation, real):** Three.js r0.184.0 `ColladaExporter` exports geometry+materials+textures only — **no skinning/animation**. "best-effort" mislabels it; VIEW-04 success criterion + human-verify expectation must say "geometry+materials only (glTF is the rigged path)". → Agreed Concern #3.
- M-1 (convergent w/ Cursor): `AppearanceResolutionResult`/material `slotBytes` ABI untyped across 02-02→02-03 + missing from PATTERNS; add a typed contract indexed by shader-group. → Agreed Concern #4.
- M-2: ansPickerOptions needs an explicit `.lat` parse step (LATX → resolve `.lat` → parse → `.ans` paths), or a documented same-name heuristic fallback. Plan's "and/or enumerate" is too vague. → Agreed Concern #5.
- M-4: make KFAT-0002 detection explicit at the FORM-version tag BEFORE any sub-form read (don't risk applying the 0003 XFIN parser to a 0002 file).
- M-3 **DISCARDED:** Sonnet flagged the quat mirror "suspicious / unverifiable" — but Opus independently DERIVED `(w,x,−y,−z)` is correct and it matches the Blender ref. False alarm; no change.
- LOW: L-3 SkeletonHelper mount belongs in `useEffect`, not `useFrame`; L-1 `Uint32BufferAttribute` exists (fine); L-2 DDS uncompressed-RGBA8 mip edge; L-4 add a no-double-apply comment in SkinnedMeshView.

---

## Consensus Summary

### Agreed Strengths (2+ reviewers, source-verified)
- The round-1 byte-layout corrections HELD: CKAT/KFAT INFO/XFIN/QCHN, SKMG 9×int32, SKTM BPMJ branch, `.pal`/`.dds` parser-native, Uint32 indices, `material.skinning` removed — all confirmed against `../swg-client-v2` by ≥2 independent readers.
- The compressed-quaternion `install()` port (incl. `halfRange=baseSeparation`) and the export mirror algebra (`flip·M·flip`, winding+normal, `(w,x,−y,−z)`) are mathematically faithful (Opus, deepest pass).

### Agreed Concerns (priority order — the round-2 fix list)
1. **[HIGH — Codex + Sonnet + source] 02-04 CKAT SROT byte order reversed.** Fix line 163 (+ must_haves §28, line 197) to: `uint8 xFormat; uint8 yFormat; uint8 zFormat; uint32 compressedRotation` (formats FIRST), decode via doExpand. Source: `CompressedKeyframeAnimationTemplate.cpp:1273-1276`. Without this, all CKAT static-rotation joints decode to garbage.
2. **[HIGH — Sonnet + source] 02-02 `.apt` redirector semantics + unpinned oracle.** `parseStaticAppearance` returns `{ redirectTarget: string }` from `FORM APT → FORM 0000 → CHUNK NAME → read_string` (error if target ends in `.apt`). Resolver resolves the target BY EXTENSION (.msh→parseMesh, .lmg→parseMeshLod, .mgn→skinned-leaf), not hard-assume parseMesh. Pin oracle to `AppearanceTemplateList.cpp:513-540` in read_first (drop "locate … when found").
3. **[MEDIUM(blocks VIEW-04 wording) — Sonnet] 02-05 ColladaExporter no skinning/animation in r0.184.0.** Relabel COLLADA path "geometry + materials only — no skeleton/animation (ColladaExporter limitation; glTF is the rigged export)". Disable/remove the COLLADA skeleton/animation toggles; update the success criterion + human-verify step 6.
4. **[MEDIUM — Sonnet + Cursor] `slotBytes` ABI untyped.** Add `AppearanceResolutionMaterial = { shaderResult; slotBytes: Partial<Record<ShaderSlotName, ArrayBuffer|null>> }` (indexed by shader-group) to `@swg/contracts` in 02-01; 02-02 produces, 02-03 consumes with the same index semantics; fix the PATTERNS snippet.
5. **[MEDIUM — Sonnet] 02-04 ansPickerOptions needs the `.lat` step** (LATX → resolve `.lat` → parse → collect `.ans`), or an explicit same-name heuristic fallback with a note.

### Lower-priority (fold in while touching the above)
- 02-04: label the w-clamp a deliberate deviation (Codex LOW); make KFAT-0002 detection explicit at FORM-version level (Sonnet M-4); SkeletonHelper in useEffect not useFrame (Sonnet L-3).
- 02-05: assert tracks = absolute local rotations + translations = local-space (Opus C1/C2); code-enforce no-double-apply (Opus/Sonnet).
- 02-01: `.pal` citation → `sharedMath/PaletteArgb.cpp` (Cursor LOW).

### Divergence resolved by fact-check
- Codex vs Sonnet on SROT: NOT a real disagreement — both read source as formats-first; the PLAN has it backwards. Confirmed HIGH (#1).
- Sonnet "quat mirror suspicious" vs Opus "derived correct": Opus wins (explicit derivation + Blender-ref match). No change.

### Bottom line
The round-1 replan's spine is **ground-truth-correct** — independently re-verified, not just internally consistent. Three surgical fixes remain (SROT order, `.apt` redirector, COLLADA scope) plus typed-contract + `.lat` plumbing. **Risk after these fixes: LOW.** Recommended: a TARGETED revision (not a full replan — a full re-derivation is what injected the SROT error in the first place).
