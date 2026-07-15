# Cross-repo confirmation request: `Object::m_scale` per-build byte offset

**Status:** NON-BLOCKING BACKUP CONFIRMATION. The toolkit already unblocks itself this phase via a
live-validated member-offset read (see "How the toolkit already unblocks itself" below) — neither ask
below is required before Phase 05 can ship. This document supersedes the retired
`2026-07-08-phase05-getscale-accessor-request.md` ask (which chased an RVA/catalog binding for
`Object::getScale()` before the de-anchoring crew confirmed the accessor is inline with no standalone
address) with a narrower, offset-only request. That earlier file was never created in this repo — this
document is the first and only handoff for the `m_scale` offset ask.

## Symbol

`Object::m_scale` — a plain POD `Vector` member (3 floats), NOT a callable accessor.

From swg-client-v2 `Object.h:456`:
```cpp
Vector m_scale;
```

`Object::getScale()` is declared inline at `Object.h:512-515`:
```cpp
inline const Vector &getScale() const { return m_scale; }
```

Because `getScale()` is `inline` with no standalone out-of-line address on most builds, no RVA/catalog
binding can target it — this is the reason the toolkit reads `m_scale` directly, by byte offset, rather
than resolving and calling an accessor function pointer (the same mechanism this file's `+1432`
lookAt-target read already uses for legacy target resolution).

## Why this is needed

Phase 05's D-03 locked read-verify write guard requires a GENUINE live read of the object's current
scale to detect external tampering — feeding the guard its own last-known value back into itself is a
self-comparison that can never detect a third party changing the object's scale between polls (unlike
Transform, whose guard already compares a real `getTransform_o2w` read against the expected value every
iteration). See `05-03-PLAN.md`'s top-of-file REVISION NOTEs (the 2026-07-08 plan-check revision) for
the full defect history that led here.

## Planner-computed LEGACY candidate offset: `0x44` (68 decimal)

Derived this session by summing member sizes in Utinni's own `Object` struct — the SAME hand-verified
memory-layout reflection struct this file's other legacy literals (`networkId`, `parentObject`, etc.)
are harvested from (`D:/Code/Utinni/UtinniCore/swg/object/object.h:76-107`; the `scale` field is
declared at line 94), under the assumption of standard MSVC x86 alignment (`int64_t networkId` needs
8-byte alignment; no `#pragma pack` directive exists anywhere in `UtinniCore`, grep-confirmed) and
`swgptr` = 4 bytes (`utinni.h:36`):

```
vtbl + unk01 + unk02 + unk03 + objectTemplate + unk04 + name  = 7 x 4B = 28B
+ 4B alignment padding (to 8-align networkId)                 = 32B
+ networkId (int64_t, 8B)                                     = 40B
+ appearance + controller + unk07 + parentObject + unk08
  + dpvsObjects + rotations                       = 7 x 4B    = 28B
------------------------------------------------------------------
= 68B (0x44) total before `scale` (swg::math::Vector, swg_math.h:47-51,
  3 floats) begins.
```

This is a COMPUTED, NOT disassembly-confirmed, value — it carries the identical "VALIDATE LIVE"
posture the `+1432` legacy target-slot constant already carries elsewhere in this codebase. 05-12's UAT
is where a wrong computed offset would surface (a scale-guard false-fail or false-pass); if it does, a
live-observed value supersedes this one.

## Two distinct asks (each NON-BLOCKING)

1. **Utinni/legacy session** — CONFIRM or CORRECT the planner-computed `0x44` candidate against a live
   debugger read of the compiled legacy client (build `0.0.119.798`, or the maintainer's current build).
   This is a narrower, cheaper ask than an original "discover an RVA/offset from scratch" request, since
   a concrete starting hypothesis already exists.

2. **swg-client-v2/advertised session** — report the compiled `Object` class's `m_scale` member byte
   offset directly. No RVA/hookpoint-row addition is needed for this — it is a read-only offset, not a
   callable accessor. (The separate `object::setScale` WRITE-side hookpoint-row ask — D-09, letting Scale
   writes work on the advertised target — remains a distinct, already-tracked item in `05-03-PLAN.md`'s
   `user_setup` frontmatter; this document does not duplicate that ask.)

## How the toolkit already unblocks itself (non-blocking rationale)

`packages/live-inject/agent/agent_main.cpp` reads `m_scale` via a per-build-gated member-offset read:

- **Legacy:** UNCONDITIONAL — always reads three floats at `focus + kLegacyScaleOffset` (`0x44`, the
  candidate above), feeding the scale guard genuine external-tamper-detection parity with Transform.
- **Advertised:** GATED behind a `s_advertisedScaleOffsetConfirmed` bool, defaulting `false` (no
  confirmed advertised offset exists this session). While unconfirmed, the scale guard degrades
  honestly — it never latches a false `SCALE_REFUSED` tamper banner (falls back to comparing the
  toolkit's own expected value against itself, never worse than the pre-fix behavior) — and that
  degraded state is published as liveness bit5 `scaleGuardUnavailableOnBuild` so a downstream consumer
  can tell a "pass" apart from a "verified pass."

A response to either ask above lets a future patch flip `s_advertisedScaleOffsetConfirmed` (advertised)
or correct `kLegacyScaleOffset` (legacy) — but the phase does not wait on either.
