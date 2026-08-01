# CONSULT-72 — Cursor — Phase 05.1 replan verification: byte-layout audit

## Facts (treat as given — do NOT re-derive)

1. Repo: `D:\Code\SWG-Toolkit`. Phase plan dir: `.planning/phases/05.1-live-world-editor-productization/` (15 plans, `05.1-01-PLAN.md` … `05.1-15-PLAN.md`).
2. These plans were revised in git commit `f9711c4` in response to a prior cross-AI review (`05.1-REVIEWS.md` in the same dir). `git diff c4e0843..f9711c4 -- .planning/phases/05.1-live-world-editor-productization` shows the delta.
3. Ground truth for the current channel layout is the real source: `packages/live-inject/agent/channel.h`, `packages/live-inject/agent/channel.cpp`, `packages/live-inject/src/channel_binding.cpp`, `packages/contracts/src/live-inject.ts`, `packages/renderer/src/services/decorationChannel.ts`. The plans are proposals; the source is fact.

## Your task (your angle only: byte-map / offset correctness)

The revised plans grow the shared-memory `LiveState` channel from 1308 to a claimed 1864 bytes and add new field regions. Build the byte map yourself and check the plans' numbers:

1. From `channel.h` (current source), reconstruct the existing layout: every field, its offset, and the total size. Confirm or refute that the current size is 1308.
2. Collect every numeric offset and size the revised plans assert (search the 15 plans for offsets — e.g., capture-extension fields around 1308/1312, a host-command region, result fields near the claimed end 1856/1860, and the 1864 total). Lay them out as a table: region → plan-claimed offset/size → your computed offset/size given the declared field order and C++ alignment rules (struct packing, 4-byte alignment on x86).
3. Flag with severity HIGH any: overlapping regions, offsets that don't match between two plans, totals that don't add up to 1864, fields whose C++ alignment would silently shift the layout vs. the TS DataView offsets, or seqlock-guarded spans where a reader could see a torn write.
4. Also verify the plans' claimed current-source line citations for the size constants (`static_assert` in channel.cpp, `CHANNEL_BYTE_SIZE` in channel_binding.cpp) still point at real code.

## Output format

Markdown. Sections: `## Summary`, `## Byte map table`, `## Findings` (severity HIGH/MEDIUM/LOW, file:line evidence), `## Verdict` — `CONVERGED` or `CONCERNS` (list). Offsets and alignment only — do not review UX or process.
