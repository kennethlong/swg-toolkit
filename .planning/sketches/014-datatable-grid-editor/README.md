---
sketch: 014
name: datatable-grid-editor
question: "How does the full DTII spreadsheet editor read — typed columns, row ops, cell editing, modified state, staging, and the byte-exact round-trip gate?"
winner: "D (synthesis: B's schema rail + C's Grid|Hex toggle)"
tags: [datatable, dtii, grid, editor, typed-editors, round-trip-gate, phase-5, phase-8]
---

# Sketch 014 · Datatable (DTII) Grid Editor

## ✅ Decision — D (B + C synthesis)

Maintainer pick (2026-07-07): **B's grid + schema rail wins, with C's `Grid | Hex` segmented
toggle folded in** — built as synthesis variant D (★). The DTII editor keeps the COLS/TYPE schema
rail + selected-row inspector + persistent gate accordion always visible, AND keeps raw `DATA`
bytes one toggle away (the fail banner's `Jump to bytes` lands on the mismatching bytes). Carries
into UI-SPEC.md as: typed-editor tabs use the 009 `decoded-default + Hex fallback` idiom, schema
stays visible in a collapsible right rail, and the round-trip gate is a footer chip + failure
banner + rail accordion (pass / running / FAIL-with-byte-diff, never staged on fail).

## Design Question

009-B decided a datatable's `DATA` chunk renders as a **grid**, and explicitly deferred the full
multi-row spreadsheet editor here. This sketch designs that editor — Phase 5's highest-frequency
editing surface (DATA-01): typed columns (`s`/`i`/`f` per the COLS/TYPE schema), add/remove/sort/
filter rows, cell editing with modified-state, stage-to-patch, and — the part no generic grid has —
the **byte-exact round-trip gate** as a first-class UI state (pass, running, FAIL-with-byte-diff).

Content is the real-ish `weapon.iff` DTII from 009 (`dl44_blaster`, `t21_rifle`, `e11_carbine`…,
`min_damage` int32 = 75). Decoded views stay **content-width / left-packed** per 009's locked rule.

## How to View

Open `index.html` in a browser (links `../themes/cyan.css`). Switch variants with the top tabs.

- **Double-click any cell** to edit; commit with Enter. Modified cells triple-encode state
  (warn left-border + tinted bg + ● suffix; row number and the file tab get a ● too).
- **Click column headers** to sort; the filter box filters by name; ＋/− Row work.
- **`Save · run gate`** fakes the DTII re-encode: chip goes `re-encoding…` → `✓ byte-exact
  round-trip` → staged chip appears, modified marks clear.
- **`demo: gate fail`** (bottom-right of the panel) shows the failure state: a danger banner with
  the exact mismatch offset/bytes and `View byte diff` / `Revert cell` actions — the file is NOT staged.
- In **C**, flip the `Grid | Hex` segmented toggle — the hex pane highlights the same
  `min_damage` bytes the grid edits; the fail banner's `Jump to bytes` lands there.

## Variants

- **A · Full-bleed spreadsheet** — path of least resistance. The whole tab is the grid; schema
  lives only in the column headers' type badges; gate status is a footer chip + failure banner.
- **B · Grid + schema rail** — right-hand collapsible rail keeps COLS/TYPE always visible, adds a
  selected-row vertical inspector (good for wide tables), and a persistent gate accordion.
- **C · Grid | Hex toggle** — 009's `Fields | Hex` idiom applied here: grid is the decoded view,
  raw `DATA` bytes one toggle away, with the edited cell's bytes highlighted. Strongest
  hex-heritage continuity with the IFF editor.

## What to Look For

- **Does the round-trip gate read as a gate?** Save is not "save" — it's "re-encode and prove
  byte-exactness before anything is staged." Does the pass→staged flow feel trustworthy, and does
  the FAIL state (offset, expected/got bytes, not-staged) read as diagnostic rather than scary?
- **Schema visibility** — are header type badges (A/C) enough to know what a column accepts, or
  does B's always-visible COLS/TYPE rail + row inspector earn its 250px?
- **Modified-state legibility** — cell ● + warn border + tinted bg, row ●, tab ●: is the
  chain from "this cell changed" to "this file has unsaved changes" obvious? (Never color alone.)
- **Hex continuity (C)** — does grid↔hex round-tripping (edit a cell, see its bytes) strengthen
  trust in the editor, or is it noise for the datatable case given 009 already owns hex?
- **Density** — compact DCC density per the shell; do 10 rows × 7 typed columns breathe at ~940px
  dock width, and does the grid stay content-width (not stretched) per 009's layout rule?
