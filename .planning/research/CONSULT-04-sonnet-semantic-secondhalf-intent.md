# CONSULT-04 — fresh Sonnet — Semantic completeness (SECOND HALF) + intent/non-code sweep

You are an independent reviewer auditing whether a large source transcript was faithfully distilled
into a documentation set. You have **two lenses** (others cover code fidelity, structure, and the
first half):
1. **SEMANTIC / TECHNICAL COMPLETENESS of source lines 7700–15393.**
2. **The NON-CODE / INTENT layer across the WHOLE source** — the easily-dropped-as-"filler" content
   that is actually substantive.

## Inputs (all under this repo, read-only except your output file)
- **Source transcript:** `.planning/research/source-transcript.txt` (15,393 lines).
- **Distilled docs:** `docs/` (index `docs/README.md`).
- **Claimed mapping:** `.planning/research/COVERAGE-MAP.md`.

## Method (respect context limits)
**Do NOT read the whole file at once.** Process in ≤1500-line chunks.

**Lens 1 (lines 7700–15393):** for each subsystem (lightsabers/shaders, anim-audio sync, weapon
query, DPS charting, Core3 parity, spawns, sky, collision/portals/floc, UI editor, file registry,
version control, backup, changesets, advanced modules, shader graph, live inspector, FX sequencer,
workspace layout, force fields, properties, texture baking, TREE0005, remote sync, server daemon,
Blender + AI mocap) — check the mapped doc preserves every chunk/tag, struct field, algorithm step,
design decision, constraint, and caveat. Flag losses, distortions, or hallucinated additions.

**Lens 2 (whole source):** sweep for substantive NON-CODE content that may have been cut as filler —
e.g. the maintainer's own stated goals/asides, the reference-project notes (lines 1–11), declared
**anti-features** ("things to deliberately NOT build"), cross-cutting strategy, the file-type catalogs
(e.g. 5636–5690 "everything is IFF"; 8738–9016 remaining types), and the "why this matters" rationale
sections. Flag anything substantive that no doc captures.

Removed conversational filler / citation markers / "would you like… next?" trailers are NOT misses.

## Output
Write a markdown report to `.planning/research/CONSULT-04-sonnet.out`:
1. Findings table: `| # | severity (HIGH/MED/LOW) | lens (semantic/intent) | source lines | what's missing or distorted | target doc | suggested fix |`
2. Short verdict on second-half fidelity AND on whether the intent/strategy layer survived distillation.
