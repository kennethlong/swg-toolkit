# CONSULT-02 — Codex — Structural coverage audit

You are an independent reviewer auditing whether a large source transcript was faithfully distilled
into a documentation set. Your lens: **STRUCTURAL COVERAGE** — does every source topic-block have a
home in the docs? Other reviewers cover code fidelity and semantics — you focus on structure/mapping.

## Inputs (all under this repo, read-only)
- **Source transcript:** `.planning/research/source-transcript.txt` — 15,393 lines, an AI/Gemini research session. Topic blocks are delimited by lines of dashes (`------------------------------`) and `##` headers. **Large — read in line ranges, not all at once.**
- **Distilled docs:** `docs/` (25 markdown files; index `docs/README.md`).
- **Claimed mapping:** `.planning/research/COVERAGE-MAP.md` — which source ranges went to which doc.

## Your task
Walk the source's topic blocks in order. For each block, verify:
1. The coverage map assigns it to a doc, AND
2. That doc actually contains the block's substance (not just a passing mention).

Report **orphan blocks** (substantive source content with no doc home), **thin coverage** (a topic the map claims is covered but the doc barely touches), and **mapping errors** (content placed in the wrong doc). Pay special attention to the suspected weak spots called out at the bottom of the coverage map: lines 13–77 (Three.js capabilities overview) and 5636–5690 (the "beyond geometry / everything is IFF" overview essay).

Trace the whole 15,393 lines structurally (you don't need to read every word — scan headers, block boundaries, and confirm presence in docs). Removed conversational filler / citation markers / "would you like… next?" trailers are NOT misses.

## Output (print to stdout as a markdown report)
1. A coverage table: `| source lines | topic | status (COVERED / THIN / ORPHAN / MISPLACED) | doc | note |` — only list blocks that are anything other than cleanly COVERED, plus a count of how many were clean.
2. A short verdict: overall structural completeness and the biggest gap.
