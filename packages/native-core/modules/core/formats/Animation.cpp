/**
 * modules/core/formats/Animation.cpp — Engine-free C++20 .ans animation parser.
 *
 * PORT SOURCES (verbatim byte layout):
 *   CKAT-0001:
 *     CompressedKeyframeAnimationTemplate.cpp:1198-1313 (load_0001 top-level)
 *     CompressedKeyframeAnimationTemplate.cpp:553-594   (RotationChannel::load_0001 / QCHN)
 *     CompressedKeyframeAnimationTemplate.cpp:637-660   (TranslationChannel::load_0001 / CHNL)
 *     CompressedKeyframeAnimationTemplate.cpp:1273-1277 (SROT: uint8 xFmt,yFmt,zFmt + uint32 packed)
 *   KFAT-0003:
 *     KeyframeSkeletalAnimationTemplate.cpp:1518-1620   (load_0003 top-level)
 *     KeyframeSkeletalAnimationTemplate.cpp:521-553     (RotationChannel::load_0003 / QCHN)
 *     KeyframeSkeletalAnimationTemplate.cpp:574-608     (TranslationChannel::load_0002/0003 / CHNL)
 *     KeyframeSkeletalAnimationTemplate.cpp:1590        (SROT: read_floatQuaternion = 4×float32)
 *
 * DECIMATION CAVEAT: The client's loader decimates keys (s_rotationCompressionFix,
 * s_translationFix). This typed parser does NOT decimate — stores ON-DISK key counts.
 * The IFF-layer CORE-05 SC-5 round-trip is format-agnostic (not affected).
 */

#include "formats/Animation.h"
#include "math/CompressedQuaternion.h"

#include <cstring>
#include <sstream>
#include <algorithm>

namespace swg_core {
namespace formats {

// ─── Security caps (T-02-16) ─────────────────────────────────────────────────
static constexpr int32_t  MAX_TRANSFORM_INFO_COUNT  = 2048;
static constexpr int32_t  MAX_KEY_COUNT             = 100000;
static constexpr uint32_t MAX_NAME_LEN              = 256;

// ─── ChunkView (mirrors Skeleton.cpp pattern) ─────────────────────────────────

struct AniChunkView {
    const uint8_t* data;
    uint32_t       size;
    uint32_t       pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }

    int8_t readI8() {
        if (!canRead(1)) throw AnimationParseError("Animation ChunkView: unexpected end (I8)");
        return static_cast<int8_t>(data[pos++]);
    }
    uint8_t readU8() {
        if (!canRead(1)) throw AnimationParseError("Animation ChunkView: unexpected end (U8)");
        return data[pos++];
    }
    int16_t readI16LE() {
        if (!canRead(2)) throw AnimationParseError("Animation ChunkView: unexpected end (I16)");
        int16_t v; std::memcpy(&v, data + pos, 2); pos += 2; return v;
    }
    uint16_t readU16LE() {
        if (!canRead(2)) throw AnimationParseError("Animation ChunkView: unexpected end (U16)");
        uint16_t v; std::memcpy(&v, data + pos, 2); pos += 2; return v;
    }
    int32_t readI32LE() {
        if (!canRead(4)) throw AnimationParseError("Animation ChunkView: unexpected end (I32)");
        int32_t v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    uint32_t readU32LE() {
        if (!canRead(4)) throw AnimationParseError("Animation ChunkView: unexpected end (U32)");
        uint32_t v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    float readF32() {
        if (!canRead(4)) throw AnimationParseError("Animation ChunkView: unexpected end (F32)");
        float v; std::memcpy(&v, data + pos, 4); pos += 4; return v;
    }
    std::string readString() {
        std::string s;
        uint32_t count = 0;
        while (pos < size && count < MAX_NAME_LEN) {
            char c = static_cast<char>(data[pos++]);
            if (c == '\0') break;
            s += c;
            ++count;
        }
        // consume remaining bytes if name was truncated or null not found
        if (pos < size && count >= MAX_NAME_LEN) {
            while (pos < size) {
                if (data[pos++] == '\0') break;
            }
        }
        return s;
    }
    void skip(uint32_t n) {
        if (n > size - pos)
            throw AnimationParseError("Animation ChunkView: skip past end");
        pos += n;
    }
};

static AniChunkView chunkPayload(const swg_core::iff::IffNode& leaf,
                                  const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw AnimationParseError("Animation: chunkPayload called on form node");
    uint32_t payloadStart = leaf.byteOffset + 8;
    uint32_t payloadLen   = leaf.declaredLength;
    if (payloadStart + payloadLen > srcSize)
        throw AnimationParseError("Animation: chunk extends beyond source buffer");
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── IFF tree navigation helpers ──────────────────────────────────────────────

static const swg_core::iff::IffNode* findLeaf(
    const swg_core::iff::IffNode& parent, const char* tag)
{
    for (const auto& c : parent.children)
        if (!c.isForm && strncmp(c.tag, tag, 4) == 0) return &c;
    return nullptr;
}

static const swg_core::iff::IffNode* findForm(
    const swg_core::iff::IffNode& parent, const char* subType)
{
    for (const auto& c : parent.children)
        if (c.isForm && strncmp(c.subType, subType, 4) == 0) return &c;
    return nullptr;
}

// ─── keyframeBuffer packing helpers ──────────────────────────────────────────

static void packI32(std::vector<uint8_t>& buf, int32_t v) {
    uint8_t tmp[4]; std::memcpy(tmp, &v, 4);
    buf.insert(buf.end(), tmp, tmp + 4);
}
static void packF32(std::vector<uint8_t>& buf, float v) {
    uint8_t tmp[4]; std::memcpy(tmp, &v, 4);
    buf.insert(buf.end(), tmp, tmp + 4);
}

// ─── CKAT-0001 parser ─────────────────────────────────────────────────────────

/**
 * Parse CKAT-0001 rotation channel (QCHN).
 * Oracle: CompressedKeyframeAnimationTemplate.cpp:553-594
 *
 * CKAT QCHN layout:
 *   int16 keyCount
 *   uint8 xFormat, uint8 yFormat, uint8 zFormat  ← ONCE per channel (not per key)
 *   per key: int16 frame + uint32 compressedRotation
 * NO decimation: store all on-disk keys.
 */
static RotationChannel parseCkatQchn(
    const swg_core::iff::IffNode& node,
    const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(node, srcData, srcSize);
    RotationChannel ch;

    // int16 keyCount (line 558: read_int16)
    int16_t keyCount16 = cv.readI16LE();
    int32_t keyCount = static_cast<int32_t>(keyCount16);
    if (keyCount < 0 || keyCount > MAX_KEY_COUNT)
        throw AnimationParseError("CKAT QCHN: keyCount out of range");
    ch.keyCount = keyCount;

    // uint8 xFormat, yFormat, zFormat — ONCE per channel (line 561-563)
    uint8_t xFmt = cv.readU8();
    uint8_t yFmt = cv.readU8();
    uint8_t zFmt = cv.readU8();

    ch.frames.reserve(static_cast<size_t>(keyCount));
    ch.quats.reserve(static_cast<size_t>(keyCount) * 4);

    for (int32_t i = 0; i < keyCount; ++i) {
        // int16 frame (line 574: read_int16)
        int16_t frame16 = cv.readI16LE();
        int32_t frame = static_cast<int32_t>(frame16);

        // uint32 compressedRotation (line 575: read_uint32)
        uint32_t packed = cv.readU32LE();

        // Decode compressed quaternion → (w,x,y,z) float at parse time
        float w = 0.0f, x = 0.0f, y = 0.0f, z = 0.0f;
        swg_core::math::doExpandCompressedQuaternion(packed, xFmt, yFmt, zFmt, w, x, y, z);

        ch.frames.push_back(frame);
        ch.quats.push_back(w);
        ch.quats.push_back(x);
        ch.quats.push_back(y);
        ch.quats.push_back(z);
    }

    return ch;
}

/**
 * Parse CKAT-0001 translation channel (CHNL).
 * Oracle: CompressedKeyframeAnimationTemplate.cpp:637-660
 *
 * CKAT CHNL layout:
 *   int16 keyCount
 *   per key: int16 frame + float32 value
 * NO decimation.
 */
static TranslationChannel parseCkatChnl(
    const swg_core::iff::IffNode& node,
    const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(node, srcData, srcSize);
    TranslationChannel ch;

    int16_t keyCount16 = cv.readI16LE();
    int32_t keyCount = static_cast<int32_t>(keyCount16);
    if (keyCount < 0 || keyCount > MAX_KEY_COUNT)
        throw AnimationParseError("CKAT CHNL: keyCount out of range");
    ch.keyCount = keyCount;

    ch.frames.reserve(static_cast<size_t>(keyCount));
    ch.values.reserve(static_cast<size_t>(keyCount));

    for (int32_t i = 0; i < keyCount; ++i) {
        int16_t frame16 = cv.readI16LE();
        ch.frames.push_back(static_cast<int32_t>(frame16));
        ch.values.push_back(cv.readF32());
    }

    return ch;
}

/**
 * parseCkat0001: full CKAT-0001 load.
 * Oracle: CompressedKeyframeAnimationTemplate.cpp:1198-1313
 */
static AnimationResult parseCkat0001(
    const swg_core::iff::IffNode& formCkat,
    const uint8_t* srcData, uint32_t srcSize)
{
    AnimationResult result;
    result.variant = AnimationVariant::CKAT_0001;

    // FORM CKAT → FORM 0001 (line 1198)
    const auto* form0001 = findForm(formCkat, "0001");
    if (!form0001)
        throw AnimationParseError("CKAT: missing FORM 0001");

    // INFO chunk (lines 1201-1212)
    const auto* infoLeaf = findLeaf(*form0001, "INFO");
    if (!infoLeaf)
        throw AnimationParseError("CKAT 0001: missing INFO chunk");

    int32_t transformInfoCount      = 0;
    int32_t rotationChannelCount    = 0;
    int32_t staticRotationCount     = 0;
    int32_t translationChannelCount = 0;
    int32_t staticTranslationCount  = 0;

    {
        auto cv = chunkPayload(*infoLeaf, srcData, srcSize);
        result.fps       = cv.readF32();                // float32 fps
        result.frameCount = static_cast<int32_t>(cv.readI16LE());  // int16
        transformInfoCount      = static_cast<int32_t>(cv.readI16LE());
        rotationChannelCount    = static_cast<int32_t>(cv.readI16LE());
        staticRotationCount     = static_cast<int32_t>(cv.readI16LE());
        translationChannelCount = static_cast<int32_t>(cv.readI16LE());
        staticTranslationCount  = static_cast<int32_t>(cv.readI16LE());
    }

    // Security cap (T-02-16)
    if (transformInfoCount < 0 || transformInfoCount > MAX_TRANSFORM_INFO_COUNT)
        throw AnimationParseError("CKAT 0001: transformInfoCount out of range");
    if (rotationChannelCount    < 0 || translationChannelCount < 0 ||
        staticRotationCount     < 0 || staticTranslationCount  < 0)
        throw AnimationParseError("CKAT 0001: negative channel count");

    // XFRM form → XFIN × transformInfoCount (lines 1215-1248)
    const auto* xfrmForm = findForm(*form0001, "XFRM");
    if (!xfrmForm)
        throw AnimationParseError("CKAT 0001: missing FORM XFRM");

    // Collect XFIN leaves in order
    result.joints.reserve(static_cast<size_t>(transformInfoCount));
    int32_t xfinCount = 0;
    for (const auto& child : xfrmForm->children) {
        if (child.isForm || strncmp(child.tag, "XFIN", 4) != 0) continue;
        if (xfinCount >= transformInfoCount)
            throw AnimationParseError("CKAT 0001: more XFIN entries than transformInfoCount");

        auto cv = chunkPayload(child, srcData, srcSize);
        AnimationJoint joint;
        joint.name = cv.readString();  // NUL-terminated

        joint.hasAnimatedRotation = (cv.readI8() != 0);

        // int16 rotationChannelIndex (line 1227)
        joint.rotationChannelIndex = static_cast<int32_t>(cv.readI16LE());

        // uint8 translationMask (line 1229)
        joint.translationMask = static_cast<uint32_t>(cv.readU8());

        // int16 ×3 translation channel indices (lines 1230-1232)
        joint.xTransChannelIndex = static_cast<int32_t>(cv.readI16LE());
        joint.yTransChannelIndex = static_cast<int32_t>(cv.readI16LE());
        joint.zTransChannelIndex = static_cast<int32_t>(cv.readI16LE());

        // Bounds-check channel index (T-02-16)
        if (joint.hasAnimatedRotation &&
            joint.rotationChannelIndex >= 0 &&
            joint.rotationChannelIndex >= rotationChannelCount)
            throw AnimationParseError("CKAT XFIN: rotationChannelIndex out of bounds");

        result.joints.push_back(std::move(joint));
        ++xfinCount;
    }

    // AROT form → QCHN × rotationChannelCount (lines 1252-1263)
    if (rotationChannelCount > 0) {
        const auto* arotForm = findForm(*form0001, "AROT");
        if (!arotForm)
            throw AnimationParseError("CKAT 0001: missing FORM AROT");

        int32_t qchnIdx = 0;
        for (const auto& child : arotForm->children) {
            if (child.isForm || strncmp(child.tag, "QCHN", 4) != 0) continue;
            if (qchnIdx >= rotationChannelCount) break;
            result.rotationChannels.push_back(parseCkatQchn(child, srcData, srcSize));
            ++qchnIdx;
        }
        if (static_cast<int32_t>(result.rotationChannels.size()) < rotationChannelCount)
            throw AnimationParseError("CKAT AROT: fewer QCHN than rotationChannelCount");
    }

    // SROT chunk: uint8 xFmt + uint8 yFmt + uint8 zFmt + uint32 packed (lines 1265-1281)
    // ORDER: formats FIRST, packed LAST (CompressedKeyframeAnimationTemplate.cpp:1273-1276)
    if (staticRotationCount > 0) {
        const auto* srotLeaf = findLeaf(*form0001, "SROT");
        if (!srotLeaf)
            throw AnimationParseError("CKAT 0001: missing SROT");
        auto cv = chunkPayload(*srotLeaf, srcData, srcSize);
        result.staticRotations.reserve(static_cast<size_t>(staticRotationCount));
        for (int32_t i = 0; i < staticRotationCount; ++i) {
            uint8_t xFmt = cv.readU8();   // format bytes FIRST (line 1273)
            uint8_t yFmt = cv.readU8();   // (line 1274)
            uint8_t zFmt = cv.readU8();   // (line 1275)
            uint32_t packed = cv.readU32LE();  // packed LAST (line 1276)
            float w = 0.0f, x = 0.0f, y = 0.0f, z = 0.0f;
            swg_core::math::doExpandCompressedQuaternion(packed, xFmt, yFmt, zFmt, w, x, y, z);
            result.staticRotations.push_back({ w, x, y, z });
        }
    }

    // ATRN form → CHNL × translationChannelCount (lines 1283-1297)
    if (translationChannelCount > 0) {
        const auto* atrnForm = findForm(*form0001, "ATRN");
        if (!atrnForm)
            throw AnimationParseError("CKAT 0001: missing FORM ATRN");

        int32_t chnlIdx = 0;
        for (const auto& child : atrnForm->children) {
            if (child.isForm || strncmp(child.tag, "CHNL", 4) != 0) continue;
            if (chnlIdx >= translationChannelCount) break;
            result.translationChannels.push_back(parseCkatChnl(child, srcData, srcSize));
            ++chnlIdx;
        }
        if (static_cast<int32_t>(result.translationChannels.size()) < translationChannelCount)
            throw AnimationParseError("CKAT ATRN: fewer CHNL than translationChannelCount");
    }

    // STRN chunk (lines 1299-1313)
    if (staticTranslationCount > 0) {
        const auto* strnLeaf = findLeaf(*form0001, "STRN");
        if (!strnLeaf)
            throw AnimationParseError("CKAT 0001: missing STRN");
        auto cv = chunkPayload(*strnLeaf, srcData, srcSize);
        result.staticTranslations.reserve(static_cast<size_t>(staticTranslationCount));
        for (int32_t i = 0; i < staticTranslationCount; ++i)
            result.staticTranslations.push_back(cv.readF32());
    }

    result.staticRotationCount    = staticRotationCount;
    result.staticTranslationCount = staticTranslationCount;

    return result;
}

// ─── KFAT-0003 parser ─────────────────────────────────────────────────────────

/**
 * Parse KFAT-0003 rotation channel (QCHN).
 * Oracle: KeyframeSkeletalAnimationTemplate.cpp:521-553
 *
 * KFAT QCHN layout:
 *   int32 keyCount
 *   per key: int32 frame + floatQuaternion (4×float32, w,x,y,z)
 * NO decimation.
 */
static RotationChannel parseKfatQchn(
    const swg_core::iff::IffNode& node,
    const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(node, srcData, srcSize);
    RotationChannel ch;

    // int32 keyCount (line 526: read_int32)
    int32_t keyCount = cv.readI32LE();
    if (keyCount < 0 || keyCount > MAX_KEY_COUNT)
        throw AnimationParseError("KFAT QCHN: keyCount out of range");
    ch.keyCount = keyCount;

    ch.frames.reserve(static_cast<size_t>(keyCount));
    ch.quats.reserve(static_cast<size_t>(keyCount) * 4);

    for (int32_t i = 0; i < keyCount; ++i) {
        // int32 frame (line 537: read_int32)
        int32_t frame = cv.readI32LE();
        // floatQuaternion (w,x,y,z) — 4×float32 (line 538: read_floatQuaternion)
        float w = cv.readF32();
        float x = cv.readF32();
        float y = cv.readF32();
        float z = cv.readF32();

        ch.frames.push_back(frame);
        ch.quats.push_back(w);
        ch.quats.push_back(x);
        ch.quats.push_back(y);
        ch.quats.push_back(z);
    }

    return ch;
}

/**
 * Parse KFAT-0003 translation channel (CHNL — same layout as load_0002).
 * Oracle: KeyframeSkeletalAnimationTemplate.cpp:574-608 (load_0002 called from load_0003)
 *
 * KFAT CHNL layout:
 *   int32 keyCount
 *   per key: int32 frame + float32 value
 * NO decimation.
 */
static TranslationChannel parseKfatChnl(
    const swg_core::iff::IffNode& node,
    const uint8_t* srcData, uint32_t srcSize)
{
    auto cv = chunkPayload(node, srcData, srcSize);
    TranslationChannel ch;

    int32_t keyCount = cv.readI32LE();
    if (keyCount < 0 || keyCount > MAX_KEY_COUNT)
        throw AnimationParseError("KFAT CHNL: keyCount out of range");
    ch.keyCount = keyCount;

    ch.frames.reserve(static_cast<size_t>(keyCount));
    ch.values.reserve(static_cast<size_t>(keyCount));

    for (int32_t i = 0; i < keyCount; ++i) {
        ch.frames.push_back(cv.readI32LE());
        ch.values.push_back(cv.readF32());
    }

    return ch;
}

/**
 * parseKfat0003: full KFAT-0003 load.
 * Oracle: KeyframeSkeletalAnimationTemplate.cpp:1518-1620
 */
static AnimationResult parseKfat0003(
    const swg_core::iff::IffNode& formKfat,
    const uint8_t* srcData, uint32_t srcSize)
{
    AnimationResult result;
    result.variant = AnimationVariant::KFAT_0003;

    // FORM KFAT → FORM 0003 (line 1518)
    const auto* form0003 = findForm(formKfat, "0003");
    if (!form0003)
        throw AnimationParseError("KFAT: missing FORM 0003");

    // INFO chunk (lines 1521-1532)
    const auto* infoLeaf = findLeaf(*form0003, "INFO");
    if (!infoLeaf)
        throw AnimationParseError("KFAT 0003: missing INFO chunk");

    int32_t transformInfoCount      = 0;
    int32_t rotationChannelCount    = 0;
    int32_t staticRotationCount     = 0;
    int32_t translationChannelCount = 0;
    int32_t staticTranslationCount  = 0;

    {
        auto cv = chunkPayload(*infoLeaf, srcData, srcSize);
        result.fps        = cv.readF32();      // float32 fps
        result.frameCount = cv.readI32LE();    // int32
        transformInfoCount      = cv.readI32LE();
        rotationChannelCount    = cv.readI32LE();
        staticRotationCount     = cv.readI32LE();
        translationChannelCount = cv.readI32LE();
        staticTranslationCount  = cv.readI32LE();
    }

    // Security cap (T-02-16)
    if (transformInfoCount < 0 || transformInfoCount > MAX_TRANSFORM_INFO_COUNT)
        throw AnimationParseError("KFAT 0003: transformInfoCount out of range");
    if (rotationChannelCount < 0 || translationChannelCount < 0 ||
        staticRotationCount  < 0 || staticTranslationCount  < 0)
        throw AnimationParseError("KFAT 0003: negative channel count");

    // XFRM form → XFIN × transformInfoCount (lines 1535-1566)
    const auto* xfrmForm = findForm(*form0003, "XFRM");
    if (!xfrmForm)
        throw AnimationParseError("KFAT 0003: missing FORM XFRM");

    result.joints.reserve(static_cast<size_t>(transformInfoCount));
    int32_t xfinCount = 0;
    for (const auto& child : xfrmForm->children) {
        if (child.isForm || strncmp(child.tag, "XFIN", 4) != 0) continue;
        if (xfinCount >= transformInfoCount)
            throw AnimationParseError("KFAT 0003: more XFIN entries than transformInfoCount");

        auto cv = chunkPayload(child, srcData, srcSize);
        AnimationJoint joint;
        joint.name = cv.readString();

        joint.hasAnimatedRotation = (cv.readI8() != 0);

        // int32 rotationChannelIndex (line 1547)
        joint.rotationChannelIndex = cv.readI32LE();

        // uint32 translationMask (line 1549)
        joint.translationMask = static_cast<uint32_t>(cv.readI32LE());

        // int32 ×3 translation channel indices (lines 1550-1552)
        joint.xTransChannelIndex = cv.readI32LE();
        joint.yTransChannelIndex = cv.readI32LE();
        joint.zTransChannelIndex = cv.readI32LE();

        // Bounds-check (T-02-16)
        if (joint.hasAnimatedRotation &&
            joint.rotationChannelIndex >= 0 &&
            joint.rotationChannelIndex >= rotationChannelCount)
            throw AnimationParseError("KFAT XFIN: rotationChannelIndex out of bounds");

        result.joints.push_back(std::move(joint));
        ++xfinCount;
    }

    // AROT form → QCHN × rotationChannelCount (lines 1570-1580)
    if (rotationChannelCount > 0) {
        const auto* arotForm = findForm(*form0003, "AROT");
        if (!arotForm)
            throw AnimationParseError("KFAT 0003: missing FORM AROT");

        int32_t qchnIdx = 0;
        for (const auto& child : arotForm->children) {
            if (child.isForm || strncmp(child.tag, "QCHN", 4) != 0) continue;
            if (qchnIdx >= rotationChannelCount) break;
            result.rotationChannels.push_back(parseKfatQchn(child, srcData, srcSize));
            ++qchnIdx;
        }
        if (static_cast<int32_t>(result.rotationChannels.size()) < rotationChannelCount)
            throw AnimationParseError("KFAT AROT: fewer QCHN than rotationChannelCount");
    }

    // SROT chunk: floatQuaternion × staticRotationCount (line 1590)
    if (staticRotationCount > 0) {
        const auto* srotLeaf = findLeaf(*form0003, "SROT");
        if (!srotLeaf)
            throw AnimationParseError("KFAT 0003: missing SROT");
        auto cv = chunkPayload(*srotLeaf, srcData, srcSize);
        result.staticRotations.reserve(static_cast<size_t>(staticRotationCount));
        for (int32_t i = 0; i < staticRotationCount; ++i) {
            float w = cv.readF32();
            float x = cv.readF32();
            float y = cv.readF32();
            float z = cv.readF32();
            result.staticRotations.push_back({ w, x, y, z });
        }
    }

    // ATRN form → CHNL × translationChannelCount (lines 1596-1606)
    if (translationChannelCount > 0) {
        const auto* atrnForm = findForm(*form0003, "ATRN");
        if (!atrnForm)
            throw AnimationParseError("KFAT 0003: missing FORM ATRN");

        int32_t chnlIdx = 0;
        for (const auto& child : atrnForm->children) {
            if (child.isForm || strncmp(child.tag, "CHNL", 4) != 0) continue;
            if (chnlIdx >= translationChannelCount) break;
            result.translationChannels.push_back(parseKfatChnl(child, srcData, srcSize));
            ++chnlIdx;
        }
        if (static_cast<int32_t>(result.translationChannels.size()) < translationChannelCount)
            throw AnimationParseError("KFAT ATRN: fewer CHNL than translationChannelCount");
    }

    // STRN chunk (lines 1609-1619)
    if (staticTranslationCount > 0) {
        const auto* strnLeaf = findLeaf(*form0003, "STRN");
        if (!strnLeaf)
            throw AnimationParseError("KFAT 0003: missing STRN");
        auto cv = chunkPayload(*strnLeaf, srcData, srcSize);
        result.staticTranslations.reserve(static_cast<size_t>(staticTranslationCount));
        for (int32_t i = 0; i < staticTranslationCount; ++i)
            result.staticTranslations.push_back(cv.readF32());
    }

    result.staticRotationCount    = staticRotationCount;
    result.staticTranslationCount = staticTranslationCount;

    return result;
}

// ─── keyframeBuffer builder ───────────────────────────────────────────────────

/**
 * Build the flat sparse keyframe binary buffer and populate channel headers.
 * Layout (per plan):
 *   Per rotation channel: int32 keyCount + int32 frame[kc] + float (w,x,y,z)[kc*4]
 *   Static rotations:     float (w,x,y,z)[staticRotationCount*4]
 *   Per translation channel: int32 keyCount + int32 frame[kc] + float value[kc]
 *   Static translations:     float value[staticTranslationCount]
 */
static void buildKeyframeBuffer(AnimationResult& result) {
    auto& buf = result.keyframeBuffer;
    buf.clear();

    // Rotation channels
    result.rotChannelHeaders.resize(result.rotationChannels.size());
    for (size_t i = 0; i < result.rotationChannels.size(); ++i) {
        const auto& ch = result.rotationChannels[i];
        result.rotChannelHeaders[i].byteOffset = static_cast<uint32_t>(buf.size());
        result.rotChannelHeaders[i].keyCount   = ch.keyCount;

        packI32(buf, ch.keyCount);
        for (int32_t f : ch.frames) packI32(buf, f);
        for (float   q : ch.quats)  packF32(buf, q);
    }

    // Static rotations
    result.staticRotByteOffset = static_cast<uint32_t>(buf.size());
    for (const auto& sr : result.staticRotations) {
        packF32(buf, sr.w); packF32(buf, sr.x);
        packF32(buf, sr.y); packF32(buf, sr.z);
    }

    // Translation channels
    result.transChannelHeaders.resize(result.translationChannels.size());
    for (size_t i = 0; i < result.translationChannels.size(); ++i) {
        const auto& ch = result.translationChannels[i];
        result.transChannelHeaders[i].byteOffset = static_cast<uint32_t>(buf.size());
        result.transChannelHeaders[i].keyCount   = ch.keyCount;

        packI32(buf, ch.keyCount);
        for (int32_t f : ch.frames)  packI32(buf, f);
        for (float   v : ch.values)  packF32(buf, v);
    }

    // Static translations
    result.staticTransByteOffset = static_cast<uint32_t>(buf.size());
    for (float v : result.staticTranslations) packF32(buf, v);
}

// ─── Public entry point ───────────────────────────────────────────────────────

AnimationResult parseAnimation(
    const swg_core::iff::IffNode& root,
    const uint8_t* srcData, uint32_t srcSize)
{
    // Initialize compressed-quaternion lookup table on first call (thread-safe enough for single-threaded Node)
    swg_core::math::installCompressedQuaternion();

    if (!root.isForm)
        throw AnimationParseError("parseAnimation: root must be a FORM node");

    // Discriminate by root subType: CKAT or KFAT
    if (strncmp(root.subType, "CKAT", 4) == 0) {
        auto result = parseCkat0001(root, srcData, srcSize);
        buildKeyframeBuffer(result);
        return result;
    }

    if (strncmp(root.subType, "KFAT", 4) == 0) {
        // Version dispatch: look for FORM 0002 or FORM 0003 child
        const auto* form0002 = findForm(root, "0002");
        if (form0002) {
            // KFAT-0002 (legacy Euler) — DECLINED immediately (T-02-18)
            AnimationResult declined;
            declined.variant    = AnimationVariant::KFAT_0002_UNSUPPORTED;
            declined.fps        = 0.0f;
            declined.frameCount = 0;
            return declined;
        }
        const auto* form0003 = findForm(root, "0003");
        if (form0003) {
            auto result = parseKfat0003(root, srcData, srcSize);
            buildKeyframeBuffer(result);
            return result;
        }
        throw AnimationParseError("KFAT: unrecognized version (no FORM 0002 or FORM 0003)");
    }

    throw AnimationParseError(
        std::string("parseAnimation: unrecognized root subType '") +
        std::string(root.subType, 4) + "'");
}

} // namespace formats
} // namespace swg_core
