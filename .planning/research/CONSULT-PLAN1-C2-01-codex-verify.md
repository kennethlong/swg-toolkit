# Consult task — Codex — Phase 1 plan review CYCLE 2 (verification: are cycle-1 HIGHs resolved?)

The Phase 1 plans were revised after a first cross-AI review. Your job: verify the revision actually
RESOLVED the cycle-1 HIGH concerns and did NOT inject new fabricated citations. Review through the
citation/ground-truth lens only.

## Already orchestrator-confirmed (treat as given — do NOT re-spend effort here)
- `Utinni/UtinniCoreDotNet/Formats/Tre/TreVersion.cs`: `IsEnumerateOnly => v==V6000` (line 85);
  `RecordStride => v==V6000 ? 32 : 24` (line 94); `IsCrcFirst => V6000||V5000` (line 104); V0006 and
  V6000 are distinct enum values. `0006` is readable size-first 24B; only `6000` is encrypted/32B.
- `swg-client-v2/.../ZlibCompressor.cpp:169` = `deflateInit(&z, Z_DEFAULT_COMPRESSION)` (level 6).

## Read
- Revised plans: `.planning\phases\01-core-engine-iff-tre-verification-harness\01-01-PLAN.md` … `01-04-PLAN.md`
- The cycle-1 findings being checked: `.planning\phases\01-core-engine-iff-tre-verification-harness\01-REVIEWS.md` (Consensus Summary)
- Ground truth: `..\swg-client-v2`, `..\Utinni`, `..\swg-blender-plugin\swg_pipeline\tre_reader.py`

## Verify each cycle-1 HIGH is resolved in the revised plans
1. **TRE version matrix** — do the plans now use a runtime `isCrcFirst(v)`/`recordStride(v)` dispatch
   (NOT "CRC-first for all"), with an honest oracle-disagreement note? Is the "CRC-first for all
   versions" axiom GONE?
2. **Wave-0 arbiter CI-blocking** — is the real-asset field-order arbiter now a must-run-and-green
   gate (not silently skipped), incl. hexdumping the literal version tag to settle 0006 vs 6000?
3. **v0006 vs v6000** — are enumerate-only / encrypted / warn-chip / 32B now scoped to `6000` ONLY,
   with `0006` treated as readable? Any remaining self-contradiction?
4. **TRE byte-identity** — split into self-determinism vs retail raw-slice identity; miniz forbidden
   on write; zlib level pinned with the correct `ZlibCompressor.cpp:169` citation?
5. **IFF trailing-bytes/pad** — relabelled "toolkit invention, not ported"; "no pad ever" corrected
   to "write none, read tolerates"; clean-container-emits-full-span guarantee + gapped-FORM fixture?

ALSO: scan every NEW `file:line` citation the revision added and flag any that does NOT match the
real source (a revision-injected fabrication is the worst outcome).

## Output (markdown)
1. **Resolution table** — for each of the 5 HIGHs: RESOLVED / PARTIAL / NOT RESOLVED, one-line why.
2. **New fabrications** — any revision-added citation that doesn't match source (with the real line).
3. **Remaining or new HIGH concerns** — bullets (or "None").
4. **Verdict line** — exactly: `CITATION_HIGHS_REMAINING: <integer>`
