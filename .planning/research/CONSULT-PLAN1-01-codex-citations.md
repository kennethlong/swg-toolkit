# Consult task — Codex — Phase 1 plan review (ANGLE: ground-truth citation verification)

You are one of four independent reviewers. Review ONLY through your assigned lens below; the
other three cover other angles. Do not try to cover everything — go deep on yours.

## Treat as given (do NOT re-derive; these are the project's locked facts)
- This repo (`D:\Code\SWG-Toolkit`) is a greenfield SWG modding suite. Phase 1 builds an
  engine-free C++20 static library that ports IFF + TRE (archive) read/write from existing source.
- The #1 project rule: the `docs/` tree is AI-distilled and frequently fabricated. A parser is only
  trustworthy if it cites a REAL loader source AND round-trips real bytes. **Citations that don't
  match the cited source are the single worst failure mode.**
- Reference (ground-truth) projects you CAN read: `..\swg-client-v2` (canonical client IFF/TRE —
  `TreeFile.cpp`, `TreeFile_SearchNode.*`, `Iff.cpp`, `IffWriter`/`TreeFileBuilder.cpp`),
  `..\Utinni` (C# `Formats/{Iff,Tre}` — `TreFile.cs`, `TreVersion(s).cs`, `IffReader/IffWriter.cs`),
  `..\swg-blender-plugin\swg_pipeline\tre_reader.py` / `tre_decrypt.py`.

## The plans under review (read them in full)
- `.planning\phases\01-core-engine-iff-tre-verification-harness\01-01-PLAN.md`
- `.planning\phases\01-core-engine-iff-tre-verification-harness\01-02-PLAN.md`
- `.planning\phases\01-core-engine-iff-tre-verification-harness\01-03-PLAN.md`
- `.planning\phases\01-core-engine-iff-tre-verification-harness\01-04-PLAN.md`

## YOUR ANGLE — citation / call-graph verification
The plans cite specific `file:line` ranges in the ground-truth sources (e.g.
`TreeFile_SearchNode.cpp:227-330`, `TreVersion.cs:60-105`, `TreFile.cs:649-679`,
`Iff.cpp:508-555` / `:1076-1095` / `:1144`, `IffWriter.cs:98-187`, `TreeFileBuilder.cpp:773-833`,
`TreWriter.cs:166-174`). For EACH such citation you can find in the plans:
1. Open the cited file in the sibling project and check whether the cited lines actually implement
   what the plan says they implement. Quote the real code briefly.
2. Flag MISMATCHES: citation points at the wrong logic, the line range is off, the function does
   something materially different, or the cited source does not exist. These are HIGH severity.
3. Flag claims with NO citation that assert a specific byte layout / field order / algorithm — those
   need a source and don't have one.
Do not evaluate UI, scope, or test strategy — other reviewers own those.

## Output format (markdown)
1. **Summary** — one paragraph: are the plans' ground-truth citations trustworthy?
2. **Verified citations** — bullets: `<plan citation>` → confirmed (one-line what the real code does)
3. **Concerns** — bullets, each tagged HIGH / MEDIUM / LOW, with the file:line you checked
4. **Suggestions** — concrete fixes
5. **Risk Assessment** — LOW / MEDIUM / HIGH for citation integrity, with justification
