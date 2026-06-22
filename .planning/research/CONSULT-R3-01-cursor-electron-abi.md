# CONSULT R3-01 — Cursor — Primary-source: is the Electron-ABI prebuild claim real?

Third review round. The plans have absorbed two rounds of fixes. Your job: primary-source
fact-check of a NEW claim the round-2 replan introduced — exactly the project's #1 risk pattern
(plausible-but-unverified, see docs/00-overview/source-provenance.md).

## LOCKED AXIOMS (settled — do NOT re-derive)
1. `Napi::SharedArrayBuffer` is experimental-gated (NAPI_EXPERIMENTAL + node-addon-api ≥ 8.6.0). Settled.
2. Whether utility→renderer SAB *sharing* works is a known likely-negative EXPERIMENT the phase
   deliberately tests; a failing cross-write is the EXPECTED, valuable finding, NOT a plan defect.
   Do not re-litigate it.
3. Electron `postMessage` transfer list = `MessagePortMain[]` only; SAB rides in `message`.

## THE NEW CLAIM TO VERIFY (your angle)
The round-2 replan added FND-02 wording: *"the prebuild targets the **Electron 42 ABI**, exercised
by the 00-05 packaged gate,"* and proves no-compiler resolution by moving `build/` aside and
asserting `node-gyp-build` resolves from `prebuilds/`. Check against PRIMARY sources
(prebuildify, node-gyp-build, @electron/rebuild docs/READMEs; Node/Electron ABI model):

1. **Can `prebuildify` actually emit an Electron-ABI prebuild?** prebuildify drives a build backend
   (node-gyp / cmake-js) against a runtime. Does it support targeting the **Electron** runtime/ABI
   directly, or does producing an Electron-ABI binary require **@electron/rebuild** (or
   `prebuildify --napi` semantics)? Note: a **Node-API (napi) addon** is ABI-STABLE across Node and
   Electron — so does the Electron-vs-Node ABI distinction even *apply* to this napi addon, or is the
   plan's emphasis on "Electron ABI" a category error (the whole point of N-API is you DON'T rebuild
   per-runtime)? Resolve this precisely: for a pure node-addon-api/N-API module, does the same
   `.node` load in both bare Node (vitest) and Electron's utility process unchanged?
2. **node-gyp-build runtime resolution.** At require-time, how does node-gyp-build pick the prebuild —
   by `process.platform`+`arch`+ABI tag? For a napi build it resolves `prebuilds/<plat>-<arch>/
   *.napi.node` by the napi tag, NOT `process.versions.modules`. Confirm whether the plan's
   `prebuilds/<platform>-<arch>/` layout + `__resolvedPath` assertion is correct for a **napi**
   prebuild, and whether a single prebuild then correctly serves BOTH the vitest (Node) and the
   Electron utility-process load — which would make the plan's "exercised under Electron ABI" framing
   either trivially-true (N-API) or wrong (if they think they need a separate Electron build).
3. **Net:** Is the round-3 FND-02 story internally correct, or did the replan introduce a NEW
   plausible-but-wrong ABI claim (over-engineering an Electron-specific rebuild that N-API makes
   unnecessary, or conversely under-specifying if they ship a non-napi build)?

## Deliverable
Verdict on the Electron-ABI prebuild claim: CORRECT / OVER-ENGINEERED(N-API-makes-it-moot) /
WRONG(real ABI gap), with primary-source citations. If N-API stability makes the "Electron ABI"
emphasis moot, say so plainly and recommend simplifying the wording — and confirm the
move-build-aside resolution test is still a valid no-compiler proof regardless.

## Files (read the real plans)
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-02-PLAN.md (Tasks 3,4 + interfaces)
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-01-PLAN.md (native-core package.json, CI)
- D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-RESEARCH.md (Standard Stack: prebuildify 6 / node-gyp-build 4 / @electron/rebuild 4)

Output: markdown, severity-tag HIGH/MEDIUM/LOW.
