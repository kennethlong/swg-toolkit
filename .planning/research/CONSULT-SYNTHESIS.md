# Coverage-Audit Synthesis — docs/ vs. original transcript

**Date:** 2026-06-21 · **Method:** 4-consultant "phone a friend" crew, divergent neutral lenses.

| Consultant | Lens | Verdict |
|---|---|---|
| Cursor (CLI) | Code-sample fidelity | ~88% — Good; big blocks intact |
| Codex (CLI) | Structural coverage | 452/456 `##` blocks clean — strong |
| fresh Opus (Agent) | Semantics, lines 1–7700 | 0 HIGH / 2 MED / 4 LOW — very high, in places improves on source |
| fresh Sonnet (Agent) | Semantics 7700–end + intent | 1 HIGH / 6 MED / 7 LOW — good; intent layer largely survived |

Raw reports: `CONSULT-01-cursor.out`, `CONSULT-02-codex.out` (+ `.utf8.txt`), `CONSULT-03-opus.out`, `CONSULT-04-sonnet.out`.

## Convergence (the strong signal)
**All four** independently flagged the same #1 gap with no leading prompt: the **"everything is IFF /
beyond geometry" essay (5636–5690)** and the **Client Object Templates family (`STOT`/`SHOT`/`INTOT`)**
had zero doc home. Sonnet rated it HIGH. → Resolved by new `docs/02-formats/object-templates.md`.

## Consolidated findings & resolution

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| A | HIGH/MED ×4 | Object Templates `STOT`/`SHOT`/`INTOT` + "everything is IFF" unifying essay had no home | **NEW** `02-formats/object-templates.md` |
| B | MED (Cursor) | `PackageFractalToJsObject` (1834–1846) dropped | Restored → `terrain.md` |
| C | LOW (Cursor) | `SwgFractalRule` struct (816–821) dropped | Restored → `terrain.md` |
| D | MED (Opus/Codex) | Geo-triggered `.ws` ambient audio (region→ambiance via `.trn` bounds) uncaptured | Added → `audio-and-effects.md` + `world-snapshots.md` |
| E | MED (Sonnet) | `.mif` camera-path spline / R3F visualization opportunity dropped | Expanded → `properties-config-environment.md` |
| F | LOW (Sonnet) | `.wth` planet examples (Tatooine sandstorm / Endor fog) thin | Added → `properties-config-environment.md` |
| G | LOW (Opus) | `.cls` extension (src line 101) silently vanished | Noted (unverified) → `properties-config-environment.md` |
| H | MED/LOW (Sonnet) | `QueryOp` enum 0=Equals/1=Contains/2=GreaterThan/3=LessThan (N-API contract) absent | Added enum table → `datatables-and-strings.md` |
| I | LOW (Sonnet) | `baseDps` vs `burstDps` (max-dmg ceiling) distinction lost in prose | Clarified → `datatables-and-strings.md` |
| J | LOW (Opus) | DTII domain examples (32-profession `skills.iff`, `recipes.iff` experiment caps) dropped | Added → `datatables-and-strings.md` + captured in `object-templates.md` |
| K | LOW (Sonnet) | Anim-audio mixer `muteHumLoop` (mute blade hum independent of swings) glossed | Added → `audio-and-effects.md` |
| L | MED (Sonnet) | VCS: "do NOT commit raw retail `.tre` dumps — LFS is for *produced* mod assets only" diluted | Callout → `version-control-and-backup.md` |
| M | LOW (Sonnet) | Remote-sync "why" framing (raw HTTP dir streaming breaks bandwidth) dropped | Added → `version-control-and-backup.md` |
| N | LOW (Sonnet) | Server daemon C++ deps `httplib.h` + `nlohmann/json.hpp` stripped | Noted → `core3-parity.md` |
| O | MED (Sonnet) | "Procedural City Layout Planner" advanced module missing | Added → `workspace-layout.md` |
| P | MED (Sonnet) | Blender→collision-hull extraction workflow (sketch bbox/sphere → `.cdf`/`.pob` compiler) omitted | Added → `blender-integration.md` |
| Q | LOW (Sonnet) | Blender material mapping specifics (Principled BSDF image→Emissive → `.sht` PASS/ANIM) thin | Added → `blender-integration.md` |
| R | LOW (Codex/Sonnet) | Three.js capabilities (morph targets/shape keys, procedural mesh, post-processing, generic loaders) thin | Note → `architecture.md` |
| S | LOW (Opus) | Maintainer "complete editor" north-star workflow aside dropped | Added → `project-vision.md` + `object-templates.md` |
| T | LOW (Opus) | `SwgCfgManager` class prose-summarized, not listed | Restored full class → `iff-and-tre.md` |
| U | MED (Cursor) | Extraction silently "fixed" real source bugs (`info.As`→`info[n]` ~20 sites; malformed struct decl; `(val:float)`→`number`; CSS typo) — correct but inconsistent/undocumented | Provenance rule → `source-provenance.md` |

## Notes
- The silent bug-fixes (U) are genuine *improvements* over the AI source (the source had broken N-API
  arg indexing); the only issue was that they were undocumented. Codified as a provenance rule rather
  than reverted.
- Source defects the crew confirmed: line-4662 HTML-entity corruption (already flagged in `world-snapshots.md`);
  source typos `SwgGlfCompiler`→`SwgStfCompiler` and a `soundType` label (correctly fixed in docs).
