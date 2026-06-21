# Source Provenance & Trust Caveats

## Where these docs come from

This documentation set was distilled from **`SWG assets editor research.txt`** — an ~88,000-word, 15,393-line stream-of-consciousness research session between the project maintainer and **Google Gemini**. The session walks, subsystem by subsystem, through a near-complete design for the toolkit, with working-style code samples for nearly every SWG asset format and editor feature.

The reorganization preserved all substantive content and code while:
- splitting the single transcript into structured, navigable documents;
- removing conversational filler, citation markers, and "would you like to explore X next?" trailers;
- deduplicating repeated boilerplate (notably the generic IFF reader/writer);
- restoring code formatting that the copy/paste flattened onto single lines.

## ⚠️ Trust level of the content

**The source is AI-generated. Treat it accordingly.**

| Content type | Trust level | Notes |
|--------------|-------------|-------|
| High-level architecture & strategy | **High** | Stack choices, layering, data-flow, and workflow design are sound and match modern practice. |
| Three.js / R3F / React patterns | **High** | Standard, verifiable against library docs. |
| N-API / C++ bridge patterns | **Medium-High** | API usage is broadly correct; verify exact `Napi::` signatures against `node-addon-api`. |
| **SWG binary format & struct layouts** | **LOW — VERIFY** | Chunk tags, field orders, byte offsets, and sizes are **plausible reconstructions, frequently invented or approximated.** Do not trust them. |
| Core3 / SWGEmu file paths & Lua schema | **Medium** | Directionally right; confirm against the actual `Core3` tree. |

### Why format details are unreliable

Gemini does not have access to the proprietary SWG format specs. When it describes, e.g., the exact chunk order inside a `.trn` `FRAC` block or the byte layout of a `.skt` joint, it is **pattern-matching from general IFF knowledge**, not reading a spec. Tags like `BPOLY`, `ADAT`, `OTPL`, `NODD`, `SPWS`, `CDFS`, `TREE0005` may be partly or wholly fabricated.

### How to use the format docs

1. Treat each format doc as a **design template and integration plan**, not a wire-format spec.
2. Before implementing a parser, **diff the proposed layout against ground truth**:
   - the real client source in `../swg-client-v2` (search for the format's loader),
   - existing community parsers (`../io_scene_swg_msh`, `../swg-blender-plugin`, SIE behavior),
   - the SWGEmu/`Core3` server code where applicable.
3. Keep the proposed code's **structure** (the parser/serializer/registry/React-inspector pattern is genuinely good); replace the **field-level details** with verified ones.
4. When you confirm or correct a layout, update the doc and drop the "AI-proposed" caveat for that section.

## Canonical ground-truth sources

See the table in [`../README.md`](../README.md#reference-projects-local-on-the-maintainers-machine). The client source (`../swg-client-v2`) is the single most authoritative reference for client-readable formats; `../Core3` and `../swg-main` for server-side templates and data tables.

## Corrected-source-bugs rule

The source transcript's code contains real bugs (it is AI-generated). During distillation, obvious
defects were **silently corrected** — e.g. broken N-API argument indexing (`info.As<T>()` →
`info[n].As<T>()`, ~20 sites), a malformed `SwgBoneJoint` scalar-vs-array field declaration, a
`(val: float)` → `(val: number)` TypeScript type, and identifier typos (`SwgGlfCompiler` →
`SwgStfCompiler`). These are improvements, but to keep the docs trustworthy the rule is:

> When a doc corrects a source bug, the correction stands (don't propagate the bug), but it should be
> *technically sound* and ideally noted. Where a doc instead preserves a source bug verbatim, flag it
> with a "known source bug" note rather than leaving it silently wrong.

A few source bugs were preserved as-is in early docs (e.g. a stray `info.As` in `DeconstructCdfFile`,
a `Math.clamp` misuse); treat any N-API `info.As<...>()` that isn't reading argument 0 as suspect.

## Coverage audit (2026-06-21)

These docs were audited against the original transcript by a four-AI "phone a friend" crew (Codex,
Cursor, Opus, Sonnet) on divergent lenses. Overall fidelity was rated **high** (structural 452/456
blocks clean; first-half semantics 0 HIGH findings). All gaps the crew found were incorporated — see
[`../../.planning/research/CONSULT-SYNTHESIS.md`](../../.planning/research/CONSULT-SYNTHESIS.md) for the
full findings and resolution log. The largest gap (unanimous) was the missing Object Template family,
now covered in [object-templates.md](../02-formats/object-templates.md).
