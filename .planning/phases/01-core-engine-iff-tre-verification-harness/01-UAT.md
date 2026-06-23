---
status: complete
phase: 01-core-engine-iff-tre-verification-harness
source: [01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md]
started: 2026-06-23T17:15:31Z
updated: 2026-06-23T18:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean state, rebuild @swg/native-core (cmake-js, VS 2022) and launch the Electron app. Renderer loads with NO white-screen crash (0xC06D007F / ERROR_PROC_NOT_FOUND from missing host zlib symbols). The TRE VFS Browser empty state shows "No archive mounted" + "Mount Archive…" CTA.
result: pass
note: Clean cmake-js rebuild (vendored zlib + swg_core + binding) compiled cleanly; addon loads with all 22 exports; Electron booted with no zlib/white-screen crash; process exited code 0. User confirmed UI + empty state.

### 2. Harness Test Suite (CORE-05 + byte-exact gates)
expected: Run the vitest harness (`pnpm vitest run` or equivalent). All ~75+ tests pass GREEN, 0 failures. Covers TRE read round-trip, IFF parse + byte-exact round-trip, TreMount override resolution, async zero-copy, and TreBuilder determinism/repack. CORE-05 sweep gate passes (tre + iff formats both cite real loaderSource). The CI-BLOCKING field-order arbiter lane runs against real archives (after `node scripts/copy-real-fixtures.js`).
result: pass
note: 91/91 tests GREEN across 11 files, 0 failures. CORE-05 sweep present. Field-order arbiter real-asset-verified — native crc-first 200/200 on 3 stardust archives, v6000 tag confirmed on Restoration, v0005 fixture crc-first 3/3. Run by orchestrator.

### 3. Mount a TRE Archive (Surface 1)
expected: Click "Mount Archive…" → native OS file picker opens. Select a real `.tre` (e.g. from D:/SWG Infinity or D:/SWGEmu Client). Mount runs off the main thread (UI stays responsive, progress shown). On success the archive appears in the Mounted Archives list with a `#N` priority badge, a version chip (e.g. v0005/v0006/v5000/v6000), and an accurate entry count. StatusBar shows `mount: [N archives]` / `vfs: [N files]`.
result: pass

### 4. Browse the VFS Tree
expected: With an archive mounted, the VFS file tree lists the archive's entries. Clicking a file selects it. Entry counts and version chips reflect the real archive contents (not a hardcoded stub).
result: pass

### 5. Override Glyph + Shadow Chain
expected: Mount two archives where a higher-priority one overrides a file in a lower one (e.g. `mtg_planets.tre` + `mtg_patch_019.tre`, file `loveday_vendor.stf`). The overriding file shows the `⧉` override glyph (aria-label "Overrides N lower archive(s)"). Selecting it shows the shadow chain: "resolves from: {archive} ✓ wins" and "shadows: {archive}". Tombstoned entries show `⊘ deleted here`.
result: pass

### 6. v6000 Enumerate-Only (Encrypted) Handling
expected: Mount a v6000 archive (e.g. from Restoration). Its row shows the `≈ enumerate-only (encrypted)` warn chip (v0006/readable rows do NOT show this chip). Selecting an entry inside it shows `🔒 encrypted payload — not extractable` — extraction is refused, no crash.
result: pass

### 7. VFS Search (live count + glob)
expected: Type into the VFS search field — results filter to matching files after a short debounce, with a live match count. The `[*]` glob toggle switches between substring and glob (`*`/`?`) matching. An empty result shows `No files match "{query}"` + "Clear search".
result: pass

### 8. IFF Structure Tree on a Real Asset (Surface 2)
expected: Select a real `.iff` file from the VFS tree. The Structure tab auto-populates a recursive FORM/chunk tree (expand/collapse). FORM/LIST/CAT nodes are containers; leaf chunks show their FourCC tag. Any trailing bytes after the last top-level block surface as an explicit trailing-bytes node (not silently dropped).
result: pass

### 9. Hex Inspector + Selection/Hover Highlight (Surface 3)
expected: Selecting an IFF node auto-switches to the Hex tab showing a virtualized offset|hex|ascii grid (smooth scroll on large files — only visible rows rendered). The selected node's byte range is highlighted in the hex grid. Hovering a byte cross-highlights between hex and ascii columns.
result: pass
note: "Initially FAILED (hover cross-highlight invisible — used --color-surface-2, identical to odd-row bg). Diagnosed + fixed in HexInspector.tsx: hover now renders accent-dim fill + accent outline on both hex and ascii columns (outline alone was too thin on 10px ascii cells). Latent Rules-of-Hooks bug (visibleRows useMemo after early return) also hoisted/fixed. Re-verified live via Vite HMR — fixed. Typecheck clean."
severity: minor
scope: "Grid render + scroll + selected-node range highlight worked throughout; only the hover cross-highlight was dead, now fixed."

### 10. Byte-Exact Round-Trip Verification Status
expected: After selecting/parsing an IFF file, the Structure tree footer shows a verification status pill (triple-encoded glyph + color + caption) confirming serialize(parse(bytes)) == original bytes byte-for-byte. A clean real asset reports a passing/"byte-exact" status (no doubled checkmark).
result: pass

## Summary

total: 10
passed: 10
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Hovering a byte in the Hex Inspector cross-highlights the corresponding cell between the hex and ASCII columns"
  status: resolved
  reason: "User reported: hovering does not do as described, it does nothing"
  resolution: "Fixed in HexInspector.tsx — hover now uses accent-dim fill + accent outline (was invisible --color-surface-2). Also hoisted visibleRows useMemo above the empty-state early return (latent hooks-order fix). Re-verified live: fixed. Not yet committed (project rule: commit on request)."
  severity: minor
  test: 9
  scope: "Grid render + virtualized scroll + selected-node byte-range highlight all work; ONLY the hover cross-highlight (hex<->ascii) is dead"
  root_cause: "Hover cross-highlight is fully wired (onMouseEnter -> setHoveredByte -> store -> conditional style), but the hovered-cell background is set to var(--color-surface-2) which equals the odd-row background and is ~3% off the even-row background -> highlight renders but is visually imperceptible. Selection works because it uses the visible var(--color-accent-dim) token."
  artifacts:
    - path: "packages/renderer/src/panels/iff/HexInspector.tsx"
      issue: "Hover bg uses var(--color-surface-2) at hex cell :230 and ascii cell :272 — same color as odd-row bg (:188-190). Change to a contrasting token (e.g. accent-based)."
    - path: "packages/renderer/src/panels/iff/HexInspector.tsx"
      issue: "SECONDARY/latent (not the hover defect): visibleRows useMemo (:347) sits AFTER the empty-state early return (:321-333) — Rules-of-Hooks violation that throws if bytes toggles null<->non-null. Hoist above the early return."
  missing:
    - "Change hover-cell background in hex column (:230) and ascii column (:272) from var(--color-surface-2) to a token that contrasts against BOTH row backgrounds (e.g. var(--color-accent-dim), or a dedicated hover token). Optionally distinguish hover (outline/box-shadow) from selection (fill) so both remain separable when a byte is hovered AND selected."
    - "Optional: hoist visibleRows useMemo above the empty-state early return to fix the latent hooks-order violation."
  debug_session: "in-context (gsd-debugger, 2026-06-23) — high confidence"
