# Handoff — Frontier UI sketches 007–011 + 016 (DONE, committed + pushed)

**Date:** 2026-06-27 · **Branch:** `main` · **Status:** DONE — all 6 sketches have winners; committed
`73e1e5e` and **pushed** (`7c4eb80..73e1e5e`). This was a `/gsd-sketch` frontier-mode session that
designed the **editing surfaces** (the deploy UI was already done in 001–006) and the **project front
door**. Layers on top of the Phase-4 redesign handoff (`2026-06-27-phase4-uat-findings-redesign.md`) —
several of that doc's gaps now have an approved sketch.

> Mockups are throwaway HTML in `.planning/sketches/`. Open `index.html` in a browser (no build).
> Shared chrome ("chrome kit") was extracted from sketch 001 — see **Chrome kit** below.

---

## What was built + the winners (all marked ★ in nav + README frontmatter + MANIFEST)

| # | Sketch | Winner | The decision that carries into UI-SPEC |
|---|--------|--------|-----------------------------------------|
| 007 | project-entry | **Synthesis** (A header + C wizard + B first-run) | Header-embedded `＋ Project ▾` + `Mount` front door; New-Project **wizard**; first-run welcome state |
| 008 | shell-composition | **A + B** | 006-D Deploy tab composes into the real 001 shell; right dock = ONE `Inspect \| Deploy` tab group; **Deploy auto-widens ~440px** |
| 009 | iff-tree-hex | **B** (typed fields + DATA grid) | SIE-successor IFF editor: chunk tree + **typed/decoded** default w/ `Fields\|Hex` toggle; DTII `DATA` renders as a **grid**; decoded views are **content-width, never edge-stretched** |
| 010 | inspector-properties | **C** (Hybrid) | Inspect-tab = pinned **stat-chip summary** + Transform/Materials open, rest collapsed; per-shader cards w/ diffuse/normal/spec mini-grid. Resolves the 001 inspector stub |
| 011 | viewport-gizmo | **B** (Full overlay HUD) | Phase-5 viewport: live-sync client card + gizmo-mode bar + transform readout bar; **live↔offline** (file-patch fallback) is first-class, glyph+border+label |
| 016 | new-object-from-template | **A** (type-grid wizard) | "New Object" = pick a **fixed engine type** → **derive** an instance (`@base`) → name/path → client+server (Core3) sides → open in 009 |

---

## New product decisions captured this session (feed PROJECT.md / UI-SPEC at build time)

1. **Project ↔ client binding is the workflow front door** (007). One project binds to one client
   install (deploy target). Seeds assets from the client TRE set **or** starts empty + mounts loose
   archives. (Realizes the prior handoff's `project-entry-point-and-shadow-redesign.md` todo.)
2. **Optional local-server association** (007 wizard step 3). On first open, ask if a local server runs;
   capture **type** (Core3/WSL2 · SWG Source/Docker), **path**, **host:port** (`127.0.0.1:44463`). Wires
   server-side deploy + client↔server parity (Phase 8). Surfaces in the inspector's Project-binding group.
3. **Unconfirmed-directory branch → non-client projects are first-class** (007). If a browsed folder
   can't be confirmed as a client install, ask "Is this a client install?" → **Yes** (treat as client) or
   **No** (non-client project: no bound client, deploy-to-client disabled, assets/server-only).
4. **Object types are engine-defined; modders derive instances, never author types** (016). Verified vs
   Core3 `Shared*ObjectTemplate` (~26 closed classes) + the `@base` derivation chain. The type picker is
   **harvested** from Core3 + client template defs, not hardcoded. **Now documented** in
   `docs/02-formats/object-templates.md` (new "Template *types* are engine-defined" section).
5. **Decoded-view layout rule** (009): content-width / left-packed, never stretched edge-to-edge
   (DATA grid columns size to data; COLS = fixed name col + aligned type badges; key/values = fixed label
   col). The maintainer flagged full-width stretch as hard-to-read three times — treat as a UI-SPEC rule.

---

## Chrome kit + a real CSS bug fixed across the whole set

- **Chrome kit** (shared CSS/JS/toolbar lifted from sketch 001) lives at
  `…/scratchpad/CHROME-KIT.md` (session scratchpad — **not** committed). Copy it verbatim into any new
  sketch so the set stays visually consistent. It now contains the fixed `.panel-tabs` rule.
- **Scroll-arrow bug (fixed):** `.panel-tabs { overflow-x: auto }` with default `overflow-y: visible`
  makes browsers compute `overflow-y: auto`; the active-tab underline at `bottom: -1px` is the 1px of
  vertical overflow → phantom vertical scroll-arrows on **every** tab strip. Fix = `overflow-y: hidden`
  **and** move the underline to `bottom: 0`. Applied to 007–011 + 016 **and** retro-fixed in
  **001/002/004** (003/005/006 have no `overflow` on `.panel-tabs`, so were unaffected). If you build
  more sketches from older copies, watch for this.

---

## MANIFEST state + open follow-ups (proposed, NOT built)

`.planning/sketches/MANIFEST.md` has all winners. Renumbered/added proposals still open:
- **012** docking affordances (drag preview, live 5-way drop zones, split/merge feel)
- **013** panel chrome & density (header/tab/accordion, number-drag fields, hit targets)
- **014** datatable / DTII **grid editor** — the full multi-row spreadsheet (009-B only *previews* it inline)
- **015** compare-to-base / diff view (referenced by 006 + 009, never designed)

---

## Next steps (pick up here)

1. **Optional:** `/gsd-sketch --wrap-up` → package these design decisions into a reusable build skill
   (`sketch-findings-*`), so the Phase-4 redesign + Phase-5 builds inherit the contracts.
2. **Feed the winners into UI-SPEC** when building: the 007 front door, 008 `Inspect|Deploy` dock group +
   auto-widen, 009 IFF-editor layout, 010 Inspect content, 011 viewport HUD, 016 New-Object wizard.
3. **Cross-link to Phase-4 redesign todos** — 007 answers `project-entry-point-and-shadow-redesign.md`;
   008 + 006-D answer `deploy-tab-combine-staging-and-changesets.md`. The redesign session can now build
   against approved mockups, not fresh designs.
4. **Still proposed, not built:** sketches 012–015 (above). 014 (datatable grid) is the most load-bearing
   — it's the real editor that 009-B defers to.

**Nothing is blocked. Everything is committed + pushed.**
