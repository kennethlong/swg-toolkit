---
id: native-contract-conformance-test
title: Add native-binding ↔ contract conformance tests (catch field-shape drift)
created: 2026-06-24
origin: Phase 02 — 4 field-shape mismatches found at runtime during 02-02/02-03 verification
severity: high
area: harness / native-core / contracts
status: completed
completed: 2026-06-24
coverage: packages/harness/test/contract-conformance.test.ts (15 tests; 160 total suite green)
---

## Why

FOUR distinct native-binding ↔ `@swg/contracts` field-shape mismatches reached runtime this
phase, each invisible to existing tests and each producing a silent failure:
1. `resolveEntry` returned `{winner,tombstone,...}` but resolver read `.found` → everything missing.
2. `parseShader` slot key was `slotTag`, contract/consumers read `.slot` → textures never bound (white).
3. `parseDds` format is top-level `dds.format`, contract declared per-mip `mip.format` → all textures magenta.
   (Also LOD ordering — a semantic, not field, mismatch.)

Root cause: harness tests exercise the native binding in isolation (and often assert the binding's
OWN shape, e.g. the test asserted `slotTag`), while the renderer consumes the `@swg/contracts`
types. Nothing validates that the binding's actual returned object CONFORMS to the contract type.
TypeScript can't catch it because the binding is `require()`'d as `any`/hand-typed in index.d.ts,
which itself can disagree with @swg/contracts.

## What to build

A harness test suite that, for each parser binding (parseMesh, parseSkeletalMesh, parseSkeleton,
parseShader, parseDds, parseMeshLod, parseDetailAppearance, resolveEntry, resolveChain,
getMountEntriesColumnar, …), parses a REAL asset and asserts the returned object structurally
conforms to the corresponding `@swg/contracts` type:
- every required contract field is present and the right primitive type;
- field NAMES match exactly (this is what catches slotTag/found/format);
- no consumer reads a field the binding doesn't emit.
Implement with a runtime schema check (e.g. a hand-written validator, zod, or a generated guard
from the contract types). Make it CI-blocking. One real fixture per format is enough.

## Severity

HIGH — 02-04 (animation .ans binding) and 02-05 (export) will add more bindings; this prevents the
same class of silent-failure from recurring. Cheap relative to the debugging each mismatch cost.

Related: [[feedback-executor-integration-blind-spot]] (the "diff every nativeCore.* field access
against the real binding return shape" rule — this test automates exactly that).
