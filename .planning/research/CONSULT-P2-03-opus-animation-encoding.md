# CONSULT-P2-03 — Opus — `.ans` animation encoding (keyframe + compressed) + coordinate convention

## Your role
Spec/math reasoner. Decode the SWG skeletal-animation `.ans` encoding precisely enough that we can
write a byte-exact parser AND drive Three.js GPU skinning + a glTF/COLLADA exporter from it. The
compression math is the hard part — be exact about quantization and bit-packing.

## De-anchoring frame (READ FIRST)
- **Ground truth = real loader code in `../swg-client-v2` + Python readers in
  `../swg-blender-plugin`.** Cite file:line.
- `docs/02-formats/skeletons-and-animation.md` is **AI-distilled (Gemini)**, 24 code blocks — every
  encoding/quantization claim is an **UNVERIFIED HYPOTHESIS**. Verify or refute each against the
  source. The math is where AI distillation fabricates most; trust the C++.

## LOCKED ORACLES — read, cite file:line
Primary (C++), under
`../swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/animation/`:
1. `KeyframeSkeletalAnimation.cpp` (+ `KeyframeSkeletalAnimationTemplate.cpp`) — uncompressed keyframe `.ans`
2. `CompressedKeyframeAnimation.cpp` (+ `CompressedKeyframeAnimationTemplate.cpp`) — compressed `.ans`
3. `AnimationCompressor.cpp` — the quantization/compression routine (the encoder side; reveals the format)
4. `SkeletalAnimation.cpp` — base class / shared keyframe sampling + interpolation
Secondary (Python — second oracle): `../swg-blender-plugin/swg_scene/animation.py`,
`animation_compressed.py` (+ `animation_export.py`, `animation_compressed_export.py` for the write side).
Skeleton bind-pose context (for joint count/order the channels map to):
`.../appearance/Skeleton.cpp`.

## Your question (NON-OVERLAPPING — YOUR slice is the ANIMATION encoding + coord math; NOT geometry
## bytes, NOT the appearance graph, NOT shaders)
1. **Container:** IFF FORM/chunk tag tree for `.ans` (both keyframe and compressed variants — what tag
   distinguishes them), and the header fields (frame count, frame rate / fps, joint/channel count).
2. **Channel model:** how rotation and translation are stored per joint per keyframe. Which joints get
   animated rotation vs static; how channels map to skeleton joints (by index? by name table?).
3. **Compression math (the crux):** in the compressed variant, exactly how are quaternions and
   translations quantized — bit widths, value ranges, any smallest-three / dropped-component scheme,
   per-channel min/max scale tables, and the unpack formula. Give the **decode formula** a parser
   would implement, with the source lines that prove it.
4. **Sampling/interpolation:** keyframe timing, whether interpolation is linear/slerp, looping.
5. **Coordinate convention:** SWG axis up/handedness + units, and what conversion an exporter needs for
   **glTF (Y-up, right-handed)** — and note the **Z-up→Y-up** mapping the future Blender bridge will
   need (informational for Phase 6, but settle it here while you're in the source).
6. **Doc check:** mark each doc encoding claim CONFIRMED / WRONG with the real value.

## Output
- The **decode formula(s)** for compressed rotation + translation, written so we can implement them.
- FORM/chunk tag tree + header field table, with file:line.
- Coordinate-conversion statement (SWG → glTF), explicit about axis + handedness + sign flips.
- A **doc-verdict** list at the end.
- Where C++ and Python disagree on the math, FLAG it.
