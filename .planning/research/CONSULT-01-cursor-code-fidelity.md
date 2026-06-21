# CONSULT-01 — Cursor — Code-sample fidelity audit

You are an independent reviewer auditing whether a large source transcript was faithfully distilled
into a documentation set. Your lens: **CODE SAMPLE FIDELITY.** Other reviewers cover structure and
semantics — you focus only on code.

## Inputs (all under this repo, read-only)
- **Source transcript:** `.planning/research/source-transcript.txt` — 15,393 lines, ~88k words, an AI/Gemini research session full of C++/TypeScript/TSX/Python/GLSL code samples. **It is large — read in line ranges (e.g. 1000-line windows), not all at once.**
- **Distilled docs:** `docs/` (25 markdown files; index `docs/README.md`).
- **Claimed mapping:** `.planning/research/COVERAGE-MAP.md` — which source line ranges went to which doc.

## Your task
For each code sample in the source, confirm a faithful copy exists in the mapped doc. Report any code that was **dropped, truncated, or had its logic/identifiers/values altered.**

**CRITICAL — what is NOT a defect:** In the source, code is flattened onto single lines (a copy artifact, e.g. `class X {public:` or `import a;import b;`). The docs intentionally reformat it with proper line breaks and language fences. **Reformatting is expected and correct.** Only flag a difference if the *logic, identifiers, values, struct fields, or call signatures* changed, or if a whole block / function / case-branch is missing or cut off.

Work efficiently: use the coverage map to jump to a source range, note the code blocks there, then grep/open the mapped doc to confirm each is present and intact. Spot-check thoroughly across the whole document; prioritize the large code-heavy sections (terrain 784–2147, collision 9474–10616, viewport tools 3262–4314, audio/FX 5691–6234 & 12116–12383).

## Output (print to stdout as a markdown report)
1. A findings table: `| # | severity (HIGH/MED/LOW) | source lines | code block / function | problem (dropped / truncated / altered) | target doc |`
2. A short verdict: overall code-fidelity quality, and the single most important fix.
HIGH = whole code sample or critical logic missing/wrong. MED = partial truncation or a changed value. LOW = cosmetic/minor.
