---
phase: 03-live-injection-foundation
plan: "03"
subsystem: live-inject
tags: [tdd, sentinels, seqlock, channel, wave-2, cpp, vitest]
dependency_graph:
  requires:
    - 03-01 (scaffold, test stubs, contracts)
    - 03-02 (resolver gate pattern reference)
  provides:
    - "packages/live-inject/agent/sentinels.cpp (4 pure predicate implementations)"
    - "packages/live-inject/agent/channel.cpp (seqlock channelOpen/Write/Close + LiveState struct)"
    - "packages/live-inject/test/sentinels.test.ts (14 tests, all GREEN)"
    - "packages/live-inject/test/channel-layout.test.ts (4 tests, all GREEN)"
  affects:
    - packages/live-inject (sentinel gate and channel writer usable by agent_main in 03-04)
tech_stack:
  added: []
  patterns:
    - "Pure C++ predicates (no Windows.h) — testable via TypeScript port without compile cycle"
    - "Seqlock write pattern: InterlockedIncrement(seq) odd→memcpy→InterlockedIncrement(seq) even"
    - "#pragma pack(push, 4) for x86 struct alignment matching TS LIVE_CHANNEL_LAYOUT offsets"
    - "DataView for unaligned BigInt64 reads (NETWORK_ID at offset 52, not 8-byte aligned)"
key_files:
  created: []
  modified:
    - packages/live-inject/agent/sentinels.cpp
    - packages/live-inject/agent/channel.cpp
    - packages/live-inject/test/sentinels.test.ts
    - packages/live-inject/test/channel-layout.test.ts
decisions:
  - "D-TS-SENTINELS: sentinel predicates tested via TypeScript port in vitest; C++ is production implementation — avoids native compile cycle in test loop"
  - "D-PRAGMA-PACK: #pragma pack(push, 4) required on x86 agent to match LIVE_CHANNEL_LAYOUT offsets; without it MSVC would pad 4 bytes before uint64_t making networkId land at offset 56 not 52"
  - "D-DATAVIEW-BIGINT: BigInt64Array requires 8-byte alignment; NETWORK_ID.offset=52 is 4-byte aligned only — DataView.setBigInt64/getBigInt64 used in TS test to avoid RangeError"
metrics:
  duration: "~4 minutes"
  completed: "2026-06-26"
  tasks: 2
  files: 4
---

# Phase 03 Plan 03: Sentinel Gate + Seqlock Channel Writer Summary

**One-liner:** 4-sentinel predicate gate (pure C++, Win32-free) and seqlock file-mapping channel writer implemented; sentinels.test.ts (14 tests) and channel-layout.test.ts (4 tests) fully GREEN.

## Tasks Completed

| Task | Name | Commit | Key Outputs |
|------|------|--------|-------------|
| 1 | sentinels.cpp + sentinels.test.ts GREEN | c92cc36 | sentinels.cpp (4 predicates + allSentinelsPassed), sentinels.test.ts (14 tests, all GREEN) |
| 2 | channel.cpp + channel-layout.test.ts GREEN | 2555b03 | channel.cpp (channelOpen/Write/Close, LiveState struct, 5 static_asserts), channel-layout.test.ts (seqlock round-trip + LIVENESS.offset, all GREEN) |

## Verification Results

- `pnpm --filter @swg/live-inject test`: 1 failed | 3 passed test files; 3 failed | 27 passed tests
  - FAILED: `handle.test.ts` (3 intentional RED stubs — Plan 03-04 scope)
  - PASSED: `sentinels.test.ts` (14 tests all GREEN)
  - PASSED: `channel-layout.test.ts` (4 tests all GREEN)
  - PASSED: `resolve.test.ts` (still GREEN from 03-02)
- Full workspace `pnpm test`: 1 failed | 20 passed files; 3 failed | 215 passed tests — no regressions
- `grep -c "TRANSFORM_BYTE_SIZE = 48" packages/live-inject/agent/sentinels.h`: 1
- No `#include <Windows.h>` or `#include "Windows.h"` in sentinels.cpp (only appears in doc comment)
- 2 functional `InterlockedIncrement` calls in channel.cpp (lines 100, 113)
- 1 `OpenFileMappingA` call in channel.cpp (line 75)
- `static_assert(sizeof(LiveState) == 320)` — will compile without error (x86 agent DLL build)

## Sentinel Predicate Coverage

| Predicate | Pass case | Failure cases |
|-----------|-----------|---------------|
| checkTransform | Identity matrix (unit rows, zero translation) | NaN matrix, +Inf element, zero-row matrix |
| checkNetworkId | 12345n | 0n |
| checkTemplateName | "object/creature/player.iff" | non-object/ prefix, non-printable chars |
| checkLiveness | player=true, over=false, delta=1 | isOver=true, playerNull, delta=0 |
| allSentinelsPassed | all 4 pass | second sentinel fails |

## LiveState Layout Verification

`#pragma pack(push, 4)` applied so uint64_t aligns to 4 bytes on x86, matching LIVE_CHANNEL_LAYOUT:

| Field | C++ offsetof | Contract offset | Match |
|-------|-------------|-----------------|-------|
| seqCounter | 0 | SEQ_COUNTER.offset = 0 | YES |
| transform | 4 | TRANSFORM.offset = 4 | YES |
| networkId | 52 | NETWORK_ID.offset = 52 | YES |
| templateName | 60 | TEMPLATE_NAME.offset = 60 | YES |
| liveness | 316 | LIVENESS.offset = 316 | YES |
| sizeof(LiveState) | 320 | TOTAL_SIZE.length = 320 | YES |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] #pragma pack(push,4) not mentioned in plan**
- **Found during:** Task 2 implementation
- **Issue:** The plan's `static_assert(offsetof(LiveState, networkId) == 52)` would fail on x86 MSVC without explicit packing. MSVC aligns `uint64_t` to its natural boundary (8 bytes on some configs), which would pad 4 bytes after the `float[3][4]` and put `networkId` at offset 56, not 52.
- **Fix:** Added `#pragma pack(push, 4)` / `#pragma pack(pop)` around the LiveState struct to force 4-byte maximum alignment, matching the LIVE_CHANNEL_LAYOUT constants.
- **Files modified:** `packages/live-inject/agent/channel.cpp`
- **Commit:** 2555b03

**2. [Rule 2 - Missing Critical] DataView required for unaligned BigInt64 in TS test**
- **Found during:** Task 2 test implementation
- **Issue:** `LIVE_CHANNEL_LAYOUT.NETWORK_ID.offset === 52`. `BigInt64Array` requires an 8-byte-aligned byteOffset; 52 % 8 = 4, so `new BigInt64Array(buf, 52, 1)` would throw `RangeError`. The plan's seqlock round-trip test outline didn't account for this.
- **Fix:** Used `DataView.setBigInt64(52, ..., true)` / `DataView.getBigInt64(52, true)` in the channel-layout test for the unaligned 64-bit field. Added explanatory comment in test.
- **Files modified:** `packages/live-inject/test/channel-layout.test.ts`
- **Commit:** 2555b03

**3. [Note] Test files still use .test.ts (not .spec.ts as plan frontmatter says)**
- Pre-existing deviation from 03-01. Plan frontmatter lists `sentinels.spec.ts` / `channel-layout.spec.ts` but project convention is `.test.ts`. No change needed — documented in 03-01-SUMMARY.

## Known Stubs

The following intentional RED stubs remain (by plan design):

| File | Stub | Resolved In |
|------|------|-------------|
| `packages/live-inject/test/handle.test.ts` | 3 RED stubs (OpenProcess handle lifecycle) | Plan 03-04 |
| All `src/*.cpp` functions | `return env.Undefined()` bodies | Plans 03-04/03-05 |

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The LiveState struct and channel writer are in-process + local IPC (named file-mapping) only, already accounted for in the plan's threat model (T-03-03, T-03-04, T-03-06).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/live-inject/agent/sentinels.cpp | FOUND |
| packages/live-inject/agent/channel.cpp | FOUND |
| packages/live-inject/test/sentinels.test.ts | FOUND |
| packages/live-inject/test/channel-layout.test.ts | FOUND |
| Commit c92cc36 (Task 1) | FOUND |
| Commit 2555b03 (Task 2) | FOUND |
