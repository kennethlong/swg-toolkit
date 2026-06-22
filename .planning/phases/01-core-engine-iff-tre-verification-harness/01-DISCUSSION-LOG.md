# Phase 1: Core Engine — IFF + TRE + Verification Harness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 1-Core Engine — IFF + TRE + Verification Harness
**Areas discussed:** Native C++ reuse strategy, Phase 1 UI surface scope, Verification harness design, Target client & format scope

---

## Native C++ reuse strategy

### Q1 — How should IFF/TRE logic get into native-core?

| Option | Description | Selected |
|--------|-------------|----------|
| Port to clean C++ | Re-author TreeFile/Iff as fresh dependency-light C++, swg-client-v2 as spec, Utinni C# cross-check | ✓ |
| Compile swg-client-v2 .cpp directly | Vendor/shim sharedFoundation/Mutex/FileStreamer etc.; max fidelity, heavy deps | |
| Fresh impl, docs-first | Write from docs/ specs (flagged risky — docs are AI-distilled/fabricated) | |

**User's choice:** Port to clean **modern** C++ — "make sure we support all the TRE formats."
**Notes:** Ground-truth check showed `TreeFile.cpp` (971 lines) pulls in a dozen+ SOE engine headers, confirming "compile as-is" is not free. All TRE format variants are in scope.

### Q2 — Read/write scope split for TRE vs IFF in Phase 1

| Option | Description | Selected |
|--------|-------------|----------|
| IFF read+write, TRE read-only | TRE builder deferred to DEPLOY-01 / Phase 4 | |
| Full read+write for both now | Prove full TRE archive round-trip alongside IFF | ✓ |
| You decide | Planner picks based on reader/writer coupling | |

**User's choice:** Full read+write for both now.
**Notes:** Flagged that this pulls the `.tre` builder forward from DEPLOY-01 (Phase 4); planner to dedupe. Deepens the same CORE capability, stays in scope.

### Q3 — Structure of the ported parsing core

| Option | Description | Selected |
|--------|-------------|----------|
| Standalone engine-free lib | Pure C++ static lib, injectable IO, thin N-API binding, headless-testable, reusable by MCP/CLI | ✓ |
| Coupled into the addon | Parse directly against node-addon-api; less boilerplate, not reusable/testable headless | |
| You decide | Planner chooses | |

**User's choice:** Standalone engine-free lib.

---

## Phase 1 UI surface scope

### Q1 — How much visible UI should Phase 1 ship?

| Option | Description | Selected |
|--------|-------------|----------|
| Functional browser + IFF tree | TRE vfs browser (mount/override/search) + generic IFF FORM/chunk tree viewer; read-focused, no 3D | ✓ |
| Backend-only, thin smoke UI | Service/contracts layer + throwaway smoke panel; real UI waits for Phase 2 | |
| Browser + editable IFF tree | Above plus in-UI IFF editing with save-back; widens the phase | |

**User's choice:** Functional browser + IFF tree.

### Q2 — How are IFF leaf chunks shown without a typed editor?

| Option | Description | Selected |
|--------|-------------|----------|
| Structure tree + hex inspector | Tag/size/offset tree + raw hex/ASCII pane for selected chunk (SIE baseline) | ✓ |
| Structure tree only | No hex pane — weak for a byte-verification tool | |
| Best-effort typed decode | Decode known chunks now — scope creep toward Phases 5/7 (flagged) | |

**User's choice:** Structure tree + hex inspector.

---

## Verification harness design

### Q1 — Where do round-trip fixtures come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Layered: committed-small + local-real | Tiny committed fixtures (Utinni seeds) for CI + gitignored real-asset fixtures for the real gate | ✓ |
| Real assets only (local/self-hosted CI) | Strongest fidelity, but CI can't run on a clean clone | |
| Wrap tre-compare | Drive the external Python tool as oracle; couples gate to its install layout | |

**User's choice:** Layered (committed-small + local-real).

### Q2 — How is the gate packaged so later phases inherit it?

| Option | Description | Selected |
|--------|-------------|----------|
| Reusable assertRoundTrip + fixture registry | Shared API + registry sweep that fails CI on missing coverage; cited-source per fixture | |
| Custom Vitest matcher | `toRoundTripByteExact()`; ergonomic, needs separate coverage check | |
| You decide | Planner picks; requirement = reusable + coverage-enforced + cites loader source | ✓ |

**User's choice:** You decide.

---

## Target client & format scope

### Q1 — Which client's real assets are the priority gate target?

| Option | Description | Selected |
|--------|-------------|----------|
| SWG Infinity primary, SWGEmu secondary | Drive local-real gate off Infinity, SWGEmu cross-check | |
| SWGEmu primary | SWGEmu as primary (matches tre-compare verify-swgemu.cfg) | |
| Both equally, multi-client gate | Gate against Infinity AND SWGEmu equally from the start | ✓ |

**User's choice:** Both equally (multi-client gate).
**Notes:** Added operational rule — copy reference `.tre` into a gitignored working directory and run tests/writes on the copies, never the reference client files (no clobbering). All TRE format variants already in scope.

---

## Claude's Discretion

- Harness enforcement mechanism (reusable API vs Vitest matcher) — requirement only: reusable + coverage-enforced + cites loader source per fixture.
- Async worker model for CORE-06 (C++ AsyncWorker vs worker_threads vs Web Worker).
- TRE search semantics (substring/glob/regex) and IFF endianness handling — resolve from swg-client-v2 source.
- C++20 specifics, lib/binding file layout, cmake-js wiring.

## Deferred Ideas

- `.tre` patch-packaging / `.cfg` activation as a user workflow → Phase 4 (DEPLOY-01..04); planner to dedupe the TRE-write overlap.
- In-UI IFF chunk editing with save-back → past Phase 1 (write path proven via tests only here).
- Per-format typed decoders → Phases 2/5/7.
- MCP/CLI reuse of the standalone parsing lib → Phase 8 (enabled by the engine-free design).
