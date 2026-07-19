---
id: x64-live-inject-agent-support
title: Add x64 live-inject agent support (swg-client-v2 x64 + D3D11 build is a real target)
created: 2026-07-15
origin: Phase-5 UAT prep — maintainer confirmed swg-client-v2 (the instrumented client) has a real x64 build with a D3D11 option, not just x86. The current live-inject agent is x86-only, so it can only attach to the x86 build.
severity: medium (real capability gap now that an x64 client build exists; blocks live-sync against the x64+D3D11 client)
area: packages/live-inject (agent DLL + host inject_binding + channel struct layout)
status: pending
---

## Problem

The live-inject agent is x86 (Win32) only, so the toolkit can attach ONLY to swg-client-v2
running in x86 mode. The maintainer has confirmed the instrumented client also runs x64 (with
D3D11), which the current build cannot target — an x86 DLL cannot load into an x64 process.

Hardcoded-x86 sites (all must gain an x64 variant/branch):
- `packages/live-inject/agent/CMakeLists.txt` — `-A Win32`, comment "must be x86 to match the SWG
  client (x86)". Needs a parallel x64 agent build.
- `LiveState` channel struct — x86-packed layout (`channel.h` static_asserts, contracts
  `LIVE_CHANNEL_LAYOUT` 400-byte map). x64 pointer/alignment widths differ → needs an x64-packed
  variant or arch-parameterized layout.
- `packages/live-inject/src/inject_binding.cpp` — `IMAGE_NT_HEADERS32`, `TH32CS_SNAPMODULE32`,
  WOW64 cross-arch resolution all assume a 32-bit target under an x64 host. An x64 target is a
  same-arch (x64→x64) inject — different (simpler) path, no WOW64 snapshot needed.
- Raw-pointer identity ABA: [[raw-pointer-identity-aba-across-process-boundary]] notes x64 pointers
  would alias differently — revisit the identity cross-check for the x64 layout.

## Notes
- Not a Phase-5 regression — Phase 5 was scoped to x86 and is verified there. This is net-new scope.
- Decide: dual-arch agent (build both, pick by target PID's bitness at attach) vs. separate x64 track.
- Related: [[reference-live-target-builds-in-scope]] (x64 fence clarified 2026-07-15),
  [[live-connect-cross-arch-injection]], [[swg-client-v2-advertised-hooks]].
