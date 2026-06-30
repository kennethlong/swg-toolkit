# Cross-AI PLAN review — Phase 04.3 — angle: Pillar-B byte-fidelity + UI sketch-fidelity (Cursor)

You are reviewing IMPLEMENTATION PLANS (not yet-written code) for Phase 04.3 of the SWG-Toolkit repo.
You are the most detailed code reader on the crew. Do NOT trust the plans' claims — VERIFY them against
real source. Read the files yourself.

## Your specific angle (stay in this lane — others cover dependency-wiring/algorithm/blind-spots)

### Part A — Pillar B byte-fidelity (plans 03, 10, 11)
Verify the searchTOC/v6000 mount plans against GROUND TRUTH (the prime directive — the docs/ tree is
AI-distilled and frequently fabricated; trust ONLY real source + bytes):
- `../swg-client-v2` (canonical client SearchTOC/IFF/TRE parse — the #1 oracle)
- `../swg-blender-plugin/swg_pipeline/tre_reader.py` + `tre_decrypt.py` (working master-.toc reader +
  per-payload `try_read_tre_payload` decrypt pattern)
- In-repo verified ports: `packages/renderer/src/services/tocReader.ts`,
  `packages/native-core/.../tre/TreArchive.cpp`, `TreVersion.h`
Check:
1. **Master `.toc` entry sourcing (plan 11 Task 2):** is sourcing entries from `readTocIndex` (master
   index) + `TOCTreePath` prefix, and DEDUP (master is the single index, no internal-TOC double-count)
   faithful to how the real client resolves searchTOC? Any error in the 24-byte entry layout
   (compressor@0, treeFileIndex@2 u16, crc@4, fileNameLength@8, offset@12, length@16, compressedLength@20)?
2. **Per-payload inflate-then-classify (plan 10):** replacing the blanket `isEnumerateOnly(V6000)` with
   "try inflate; classify Restoration-encrypted only on real zlib failure" — does this match
   `tre_reader.py`/`tre_decrypt.py`? Is the V6000 stride-32 / CRC-first TOC layout correctly respected?
   Does extraction correctly use the EXTERNALLY-SUPPLIED descriptor (offset/len/comp from the master .toc)
   rather than the empty internal TOC of a numberOfFiles=0 container?
3. **Lazy searchPath (plan 11 Task 3):** is stopping upfront enumeration + resolving loose overrides
   on-demand (override still wins at resolve via `readVfsEntryBytes`, loose files NOT flat VFS rows)
   faithful to the real client's searchPath behavior + priority-DESC + tombstone resolution?
4. Any place a plan re-derives or contradicts the verified byte layout (e.g. reinstating "size-first" TOC).

### Part B — UI sketch-fidelity (plans 05, 06, 07, 08, 09)
The project rule: **sketches are the UI contract.** The authoritative gap list is
`.planning/phases/04.3-versioning-and-searchtoc-mount/04.3-01-CREW-GAP-REVIEW.md` — every CONFIRMED row
must become a concrete plan task with a CHECKABLE acceptance criterion. Cross-check:
- Does EVERY CONFIRMED gap row map to a task? (002: A1–A13; 005/006: D3–D17; 007: P1–P9; 008: S2,S4–S8.)
- Are any "render the panel"-style VAGUE tasks present (a planning gap)?
- Compare the plan tasks against the real sketch markup:
  `.planning/sketches/002-version-graph-timeline/index.html` (variant A),
  `005-deploy-inspect-tab/`, `006-combined-deploy-tab/`, `007-project-entry/`, `008-shell-composition/`.
- Deliberate divergences that MUST be preserved (not "fixed"): D-09 drops per-row Deploy/Revert (keeps
  "Branch from here"); D-13 collapses active/deployed into ONE live node. Confirm the plans encode these.
- S3 (VCS-tab placement) must stay AMBIGUOUS/deferred — confirm plan 09 does NOT silently move it.

## Files to read
- Plans `04.3-02-PLAN.md` … `04.3-13-PLAN.md`, plus RESEARCH.md, CONTEXT.md, the gap review, the sketches,
  and the ground-truth sources above.

## Output format (markdown)
1. **Summary** — one paragraph. 2. **Strengths** — bullets. 3. **Concerns** — bullets tagged
HIGH/MEDIUM/LOW with file:line / plan# / sketch-row evidence. 4. **Suggestions** — actionable.
5. **Risk Assessment** — LOW/MEDIUM/HIGH with justification.
Cite file:line. State explicitly when a plan's claim checks out (don't manufacture problems).
