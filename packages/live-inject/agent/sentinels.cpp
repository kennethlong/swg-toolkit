/**
 * sentinels.cpp — 4-sentinel gate stubs.
 *
 * Full implementation in Plan 03-03.
 */

#include "sentinels.h"

SentinelResult checkTransform(const float* mat3x4) {
    // TODO: implement in Plan 03-03
    return { false, "not implemented" };
}

SentinelResult checkNetworkId(uint64_t id) {
    // TODO: implement in Plan 03-03
    return { false, "not implemented" };
}

SentinelResult checkTemplateName(const char* name, size_t maxLen) {
    // TODO: implement in Plan 03-03
    return { false, "not implemented" };
}

SentinelResult checkLiveness(bool playerNonNull, bool isOver, int loopCounterDelta) {
    // TODO: implement in Plan 03-03
    return { false, "not implemented" };
}

bool allSentinelsPassed(const SentinelResult results[4]) {
    // TODO: implement in Plan 03-03
    return false;
}
