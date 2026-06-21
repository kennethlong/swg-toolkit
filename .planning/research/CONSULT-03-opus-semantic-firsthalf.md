# CONSULT-03 — fresh Opus — Semantic/technical completeness, FIRST HALF

You are an independent reviewer auditing whether a large source transcript was faithfully distilled
into a documentation set. Your lens: **SEMANTIC / TECHNICAL COMPLETENESS of source lines 1–7700.**
Did any format detail, struct field, algorithm, design decision, constraint, or caveat get lost or
distorted in the reorganization? (Another reviewer takes the second half; others take code and structure.)

## Inputs (all under this repo, read-only except your output file)
- **Source transcript:** `.planning/research/source-transcript.txt` — process **lines 1–7700 only**.
- **Distilled docs:** `docs/` (index `docs/README.md`).
- **Claimed mapping:** `.planning/research/COVERAGE-MAP.md`.

## Method (respect context limits)
**Do NOT read the whole range at once.** Process in ≤1500-line chunks: read a chunk, then Grep/Read
the mapped doc(s) for that range, compare the *meaning* (not formatting), record findings, discard the
chunk, continue. Keep only your findings list in working memory.

For each subsystem in 1–7700 (architecture/IPC, meshes & appearances, palettes, terrain, flora, TRE
packing, config, viewport tools, world snapshots, Recast, packaging, audio, particles, skeletons &
animation, datatables start), check the doc preserves: every named chunk/tag, every struct field and
its type/order, every algorithm step, every stated design decision or trade-off, every performance or
safety caveat, and every maintainer aside. Flag semantic losses or distortions — including any place
the doc states something the source did NOT (hallucinated additions).

Removed filler / citation markers / "would you like… next?" trailers are NOT misses.

## Output
Write a markdown report to `.planning/research/CONSULT-03-opus.out`:
1. Findings table: `| # | severity (HIGH/MED/LOW) | source lines | detail lost or distorted | target doc | suggested fix |`
2. Short verdict on first-half semantic fidelity + the most important fix.
HIGH = a format detail/algorithm/decision that would cause a wrong implementation if trusted. MED = a notable omission. LOW = minor.
