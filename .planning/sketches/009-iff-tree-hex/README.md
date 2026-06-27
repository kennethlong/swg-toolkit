---
sketch: 009
name: iff-tree-hex
question: "How should the IFF chunk tree + hex/struct inspector read — the core editing surface that makes this the successor to Sytner's IFF Editor?"
winner: "B (Tree + Typed Fields, with a grid for DATA)"
tags: [iff, editor, hex, chunk-tree, sie-successor, phase-1, phase-5]
---

# Sketch 009 — IFF Tree + Hex

## ✅ Decision — B (Tree + Typed Fields), with a real grid for DATA

Typed/decoded views win over raw hex as the **default** — B reads a chunk's *meaning*, with a
`Fields | Hex` toggle preserving SIE's hex-first heritage for when you need the bytes. Crucially, a
datatable's `DATA` chunk renders as a **grid** — B is the only variant that shows all rows as a table
(A is hex-only; C decodes a single row). The full multi-row spreadsheet editor (add/remove/sort/filter,
typed columns) is the dedicated **datatable editor — sketch 014**; B previews it inline.

Decoded detail views are **content-width / left-packed**, never stretched edge-to-edge: the DATA grid
columns size to data; COLS uses a fixed name column with the type badges aligned; ROWS / container
key-values use a fixed label column. Carries into UI-SPEC.md as a layout rule for the IFF editor's
decoded views.

## Design Question

An `.iff` file is a tree of `FORM <TAG>` containers and leaf data chunks. The SIE-successor
editing surface must let a modder navigate that chunk tree, see raw bytes, and (eventually) edit
typed fields. **How should the chunk tree + hex/struct inspector be laid out** so it is faithful to
SIE's hex-first heritage while opening the door to the typed editors planned for Phase 5?

Primary example is `weapon.iff`, a **DTII datatable** (`FORM DTII ▸ FORM 0001 ▸ COLS / TYPE / ROWS /
DATA`). The selected `DATA` chunk's ASCII gutter spells out real weapon names (`dl44_blaster`,
`t21_rifle`, `e11_carbine`). A collapsed second root — `FORM MESH ▸ FORM 0005 ▸ APPR / SHOT / FORM
SPS` — proves the tree handles other file types. All chunk tags (FORM, DTII, COLS, TYPE, ROWS, DATA,
MESH, SPS, APPR, SHOT, CSHD, SSHT) are real, grounded in `docs/02-formats/*` and `../swg-client-v2`.

## How to View

Open `index.html` in a browser. Use the top variant-nav to switch A / B / C. Tree rows expand /
collapse (FORM nodes) and select (any node). Selecting a chunk updates the hex, the interpreted
strip, and the struct/fields pane. In variant B the `Fields` / `Hex` segmented toggle swaps the
right pane. Theme picker (titlebar + bottom toolbar) and annotate toggle are live.

## Variants

- **A · Tree + Hex split (SIE-classic, path of least resistance).** Left = collapsible IFF chunk
  tree. Right = breadcrumb (`FORM DTII ▸ FORM 0001 ▸ DATA`) + chunk action-bar + 3-column hex dump
  (offset / 16 bytes grouped 8+8 / ASCII gutter) + an "interpreted" footer that decodes the leading
  fields (`0x000D int32 = 75 → min_damage`). The faithful SIE port.

- **B · Tree + Typed Fields.** Same tree; the right pane shows the chunk's **decoded** form instead
  of raw bytes — `DATA` renders as a spreadsheet preview (reuses `.dt`), `COLS`/`TYPE` as a column
  list, `ROWS` as a key/value. A `Fields` / `Hex` toggle in the pane header drops back to raw hex.
  Leans toward the Phase 5 typed editors.

- **C · 3-pane (tree | hex | struct).** Tree, hex, and an interpreted struct form all visible at
  once. Densest / power-user; no toggling, full context.

## What to Look For

- **Hex vs typed-fields tradeoff** — A is honest-to-the-bytes (what SIE users expect); B hides the
  bytes behind a friendlier decoded view. Which is the right *default* for a modern successor, and is
  the per-pane toggle (B) or always-on third pane (C) the better way to keep both?
- **2-pane vs 3-pane density** — does C's simultaneous hex+struct earn its horizontal cost, or does
  A's interpreted footer strip already deliver "enough" decoding without a third column?
- **Does the tree make FORM nesting legible?** — `FORM` containers vs leaf chunks use distinct
  glyphs (`⊞` vs `▦`/`▤`), size badges, and indentation. Is the `FORM DTII ▸ FORM 0001 ▸ DATA`
  hierarchy obvious at a glance, including across the second (mesh) root?
- **Editor affordances** — this is an *editor*, not a viewer: the modified `DATA` chunk triple-encodes
  state (glyph `●` + warn-colored left border + "modified" label — never color alone), and the chunk
  action-bar exposes `Add to patch / Stage` (ties into the deploy flow) and `Compare to base`. Do
  these read as first-class, and is the staging hook discoverable from the editing surface?
- **Breadcrumb + interpreted strip** — does the breadcrumb keep you oriented inside deep FORM nesting,
  and does the interpreted line ("offset 0x04: int32 = 5 (row count)") make the raw bytes legible to a
  modder who doesn't read hex fluently?
