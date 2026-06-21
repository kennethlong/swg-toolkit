# Phase 0: Toolchain De-risk & App Shell - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 0-Toolchain De-risk & App Shell
**Areas discussed:** Build toolchain, Addon process placement, Monorepo & package manager, Pipeline-proof depth

---

## Build toolchain

| Option | Description | Selected |
|--------|-------------|----------|
| electron-vite + electron-builder | Mature, Vite-native, battle-tested; research's lean (Forge Vite plugin is "experimental") | |
| Electron Forge + Vite | Official Forge flow (our docs' original pick); Vite plugin carries experimental status | ✓ |
| Spike both in Phase 0 | Try each against the native-addon load, then lock the winner | |

**User's choice:** Electron Forge + Vite
**Notes:** User prefers the official Forge flow, accepting the experimental-plugin risk. CONTEXT notes the trigger to reconsider electron-vite if the Vite plugin fights the addon load or COOP/COEP.

---

## Addon process placement

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated utility process | Isolates native crashes from the window; adds a MessagePort hop | ✓ |
| Main process | Simpler, fewer hops; fastest to green | |
| Prove in main, then move | Wire in main for the proof, migrate to utility later | |

**User's choice:** Dedicated utility process
**Notes:** Crash isolation (memory injection + untrusted-binary parsing) judged worth the MessagePort hop.

---

## Monorepo & package manager

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm workspaces | native-core / backend / renderer / contracts; Blender plugin out-of-workspace; optional mcp-server | ✓ |
| npm workspaces | Same layout, npm | |
| You decide | Planner picks from reference-project conventions | |

**User's choice:** pnpm workspaces

---

## Pipeline-proof depth

| Option | Description | Selected |
|--------|-------------|----------|
| Full SharedArrayBuffer round-trip | C++ allocates SAB → MessageChannel → renderer reads it; COOP/COEP active. De-risks the 60fps channel now | ✓ |
| Hello-call only | Minimal native call; defer the SAB channel to the live-sync phase | |

**User's choice:** Full SharedArrayBuffer round-trip

---

## Claude's Discretion

- cmake-js vs node-gyp for the addon build (lean cmake-js; resolve against the real swg-client-v2 CMake/MSBuild setup).
- Testing framework, CI, linting, and dark-theme/dockview shell layout specifics.
- Whether the Phase-0 `native-core` is a throwaway proof or the seed of the real addon (lean: seed minimally).

## Deferred Ideas

- Reuse vs. rewrite of Utinni's C# format code (Phase 1).
- MCP server informed by `Utinni.Mcp` (Phase 8).
- Editor decomposition mirroring Utinni's editor phases (Phases 5/7).
- cmake-js wiring with swg-client-v2's MSBuild TRE sources (Phase 1).

## Mid-discussion references added by user (captured as canonical refs)

- `swg-client-v2/tools/tre-compare` + the C++ TRE tools (`TreeFile.cpp`, `TreeFileBuilder`/`TreeFileExtractor`) in swg-client-v2.
- The Utinni project for existing editors and formats (`UtinniCoreDotNet/Formats`, editor phase plans, fixtures, `Utinni.Mcp`).
