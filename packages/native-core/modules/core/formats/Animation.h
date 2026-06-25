/**
 * modules/core/formats/Animation.h — Engine-free C++20 .ans animation parser.
 *
 * PORT SOURCES:
 *   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313 (CKAT load_0001)
 *   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:553-594   (CKAT QCHN/RotationChannel::load_0001)
 *   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:637-660   (CKAT CHNL/TranslationChannel::load_0001)
 *   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1273-1277 (CKAT SROT: uint8 x,y,zFmt + uint32 packed)
 *   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620   (KFAT load_0003)
 *   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:521-553     (KFAT QCHN/RotationChannel::load_0003)
 *   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:574-608     (KFAT CHNL/TranslationChannel::load_0003)
 *   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1590        (KFAT SROT: floatQuaternion)
 *
 * KEY GROUND-TRUTH FACTS (LOCKED — do NOT re-derive):
 *   CKAT-0001 INFO: float32 fps; then 6×int16 (frameCount,transformInfoCount,
 *     rotationChannelCount,staticRotationCount,translationChannelCount,staticTranslationCount)
 *   KFAT-0003 INFO: float32 fps; then 6×int32 (same fields)
 *   CKAT XFIN: string name; int8 hasAnimatedRotations; int16 rotationChannelIndex;
 *     uint8 translationMask; int16 ×3 translationChannelIndices
 *   KFAT XFIN: string name; int8 hasAnimatedRotations; int32 rotationChannelIndex;
 *     uint32 translationMask; int32 ×3 translationChannelIndices
 *   CKAT QCHN: int16 keyCount; uint8 xFmt,yFmt,zFmt ONCE per channel; per key int16 frame + uint32 packed
 *   KFAT QCHN: int32 keyCount; per key int32 frame + floatQuaternion(4×float32) in (w,x,y,z) order
 *   CKAT SROT: uint8 xFmt + uint8 yFmt + uint8 zFmt THEN uint32 packed (formats-FIRST, packed-LAST)
 *   KFAT SROT: floatQuaternion (4×float32, w,x,y,z)
 *   CKAT CHNL(translation): int16 keyCount; per key int16 frame + float32 value
 *   KFAT CHNL(translation): int32 keyCount; per key int32 frame + float32 value
 *   KFAT-0002 detected and DECLINED immediately (do not parse sub-forms).
 *   Keys are SPARSE (frame-indexed). Do NOT decimate keys on load (store ON-DISK counts).
 *   Keyframe ArrayBuffer is SPARSE: per-channel {keyCount, int32 frames[], float values[]}.
 *   Compressed quaternions: decoded by doExpandCompressedQuaternion() to (w,x,y,z) float32 at parse time.
 *   On-disk quaternion order: (w,x,y,z); THREE.Quaternion.set(x,y,z,w) reorder at render time.
 *
 * Security caps (T-02-16):
 *   transformInfoCount: cap 2048
 *   keyCount per channel: cap 100,000
 *   XFIN names: cap 256 bytes
 *   channel indices: bounds-checked against channel counts
 *
 * Decision D-02: C++20, engine-free.
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include "iff/Iff.h"

namespace swg_core {
namespace formats {

// Re-use FormatParseError from Mesh.h namespace (included by compilation units that need both)
// Declare locally to keep this header self-contained.
class AnimationParseError : public std::runtime_error {
public:
    explicit AnimationParseError(const std::string& msg) : std::runtime_error(msg) {}
};

// ─── Animation variant ────────────────────────────────────────────────────────

enum class AnimationVariant {
    CKAT_0001,              // Compressed keyframe (compressed quaternion)
    KFAT_0003,              // Uncompressed keyframe (float quaternion)
    KFAT_0002_UNSUPPORTED,  // Legacy Euler (declined)
};

// ─── Per-joint descriptor (from XFIN chunks in XFRM form) ────────────────────

struct AnimationJoint {
    std::string name;               // Joint name (XFIN string)
    bool        hasAnimatedRotation = false;
    int32_t     rotationChannelIndex = -1;  // into rotation channel array
    uint32_t    translationMask     = 0;    // bitmask: bit0=x, bit1=y, bit2=z
    int32_t     xTransChannelIndex  = -1;
    int32_t     yTransChannelIndex  = -1;
    int32_t     zTransChannelIndex  = -1;
};

// ─── Sparse rotation channel (QCHN) ──────────────────────────────────────────

/**
 * Decoded rotation channel — keys are SPARSE (not one per frame).
 * For CKAT: compressed quaternions decoded to (w,x,y,z) float32 at parse time.
 * For KFAT: floatQuaternion (w,x,y,z) read directly.
 * Frame numbers are int32 (stored as float in client, kept int32 here for binary search).
 */
struct RotationChannel {
    int32_t                  keyCount = 0;
    std::vector<int32_t>     frames;      // ON-DISK frame numbers (not decimated)
    std::vector<float>       quats;       // 4 floats per key: (w,x,y,z)
};

// ─── Static rotation (from SROT) ─────────────────────────────────────────────

struct StaticRotation {
    float w = 1.0f, x = 0.0f, y = 0.0f, z = 0.0f;  // (w,x,y,z) order
};

// ─── Sparse translation channel (CHNL) ───────────────────────────────────────

struct TranslationChannel {
    int32_t              keyCount = 0;
    std::vector<int32_t> frames;   // ON-DISK frame numbers
    std::vector<float>   values;   // float32 per key
};

// ─── Full animation parse result ──────────────────────────────────────────────

/**
 * AnimationResult: output of parseAnimation().
 *
 * keyframeBuffer: flat ArrayBuffer containing all sparse keyframe data packed as:
 *   Per rotation channel [rotationChannelCount entries]:
 *     int32 keyCount
 *     int32 frame[keyCount]    (4 bytes each)
 *     float quat[keyCount*4]   (w,x,y,z) (4 bytes each × 4)
 *   Per static rotation [staticRotationCount entries]:
 *     float (w,x,y,z)         (4 floats)
 *   Per translation channel [translationChannelCount entries]:
 *     int32 keyCount
 *     int32 frame[keyCount]
 *     float value[keyCount]
 *   Per static translation [staticTranslationCount entries]:
 *     float value
 *
 * channelTable: per-channel byte offsets + key counts so JS can address channels
 * without re-parsing the flat buffer.
 *
 * Binary contract: keyframeBuffer crosses as ArrayBuffer (AGENTS.md: binary-stays-binary).
 */
struct RotationChannelHeader {
    uint32_t byteOffset = 0;  // offset into keyframeBuffer
    int32_t  keyCount   = 0;
};

struct TranslationChannelHeader {
    uint32_t byteOffset = 0;
    int32_t  keyCount   = 0;
};

struct AnimationResult {
    AnimationVariant     variant     = AnimationVariant::KFAT_0002_UNSUPPORTED;
    float                fps         = 0.0f;
    int32_t              frameCount  = 0;

    std::vector<AnimationJoint>  joints;     // XFIN entries (transformInfoCount)

    // Decoded sparse keyframe data
    std::vector<RotationChannel>    rotationChannels;    // AROT/QCHN
    std::vector<StaticRotation>     staticRotations;     // SROT
    std::vector<TranslationChannel> translationChannels; // ATRN/CHNL
    std::vector<float>              staticTranslations;  // STRN

    // Per-channel header table for fast JS addressing
    std::vector<RotationChannelHeader>    rotChannelHeaders;
    std::vector<TranslationChannelHeader> transChannelHeaders;

    // Flat packed keyframe binary (crosses as ArrayBuffer)
    std::vector<uint8_t>  keyframeBuffer;

    // IFF round-trip status (passthrough from IFF parse layer)
    bool    roundTripPassed = true;
    int32_t roundTripFailOffset = -1;

    // Raw counts for JS
    int32_t staticRotationCount     = 0;
    int32_t staticTranslationCount  = 0;
    uint32_t staticRotByteOffset    = 0;  // byte offset of static rotations in keyframeBuffer
    uint32_t staticTransByteOffset  = 0;  // byte offset of static translations in keyframeBuffer
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * parseAnimation(root, srcData, srcSize) — Parse a .ans animation file.
 *
 * root: IffNode for the top-level FORM (CKAT or KFAT).
 * srcData/srcSize: original bytes for chunk payload access.
 *
 * Variant dispatch:
 *   FORM CKAT → FORM 0001 → CKAT-0001 path (int16 widths, compressed quaternion)
 *   FORM KFAT → version dispatch:
 *     FORM 0002 → KFAT-0002-unsupported (return immediately, no parse)
 *     FORM 0003 → KFAT-0003 path (int32 widths, float quaternion)
 *
 * Throws AnimationParseError on malformed input.
 *
 * Security: transformInfoCount capped at 2048; keyCount per channel capped at 100,000;
 *           XFIN name strings capped at 256 bytes; channel indices bounds-checked.
 */
AnimationResult parseAnimation(const swg_core::iff::IffNode& root,
                               const uint8_t* srcData, uint32_t srcSize);

} // namespace formats
} // namespace swg_core
