---
id: phase5-plans-must-match-sketches
title: Phase 5 plans MUST name their governing sketches and enumerate every sketch element as must_haves
created: 2026-07-07
origin: Maintainer note during the pre-Phase-5 sketch session — "make a note for planning to use these sketches and match them in details."
severity: high (sketches are the UI contract per AGENTS.md; the version-graph drift incident is the scar)
area: planning / Phase 5 (WYSIWYG Live-Sync & Typed Editors)
status: pending
resolves_phase: "5"
related: feedback-sketches-are-ui-source-of-truth
---

## The contract

Phase 5's UI surfaces now have approved, governing sketches (session 2026-07-07). Any Phase 5 plan
touching one of these surfaces MUST name its sketch and enumerate that sketch's distinct visual
elements as `must_haves` — never a vague "render the editor". Verification diffs the built surface
against the sketch, element by element (observed / missing).

| Surface | Governing sketch | Winner / contract |
| --- | --- | --- |
| Viewport gizmo + live-sync HUD (LIVE-03) | `011-viewport-gizmo` | **B · Full overlay HUD** + **B2 revert/guard (approved)**: live-sync client card (client/pid/fps/last-sync/COW-snapshot rows), left gizmo-mode rail (W/E/R/Q), bottom transform readout bar with write-target indicator, live↔offline glyph+border+label (never color alone), file-patch fallback as first-class safe mode, **session write log w/ per-write revert + Revert ALL**, **read-verify guard row**, **guard-blocked state (bytes named, write refused, fails closed — no force-write)**, **reverted confirmation state (struck-through log)** |
| DTII datatable grid editor (DATA-01) | `014-datatable-grid-editor` | **D · Synthesis (B + C)**: grid + collapsible right rail (COLS/TYPE schema, selected-row inspector, gate accordion), `Grid \| Hex` segmented toggle with edited-cell bytes highlighted + fail-banner `Jump to bytes`, typed column badges (s/i/f), sort/filter/add/remove row, modified triple-encoding (cell warn-border+bg+● → row ● → tab ●), crumb `FORM DTII ▸ 0001 ▸ DATA`, action bar (Compare to base / Stage / Save·run gate), round-trip gate chip states (not run / re-encoding… / ✓ byte-exact / ✗ FAIL) + failure banner with offset+expected/got bytes and NOT-staged guarantee, content-width grid per 009's rule |
| .stf strings editor (DATA-02) | `018-stf-strings-editor` | **A · Flat key/value grid**: one table `key \| crc32 \| text`, one file = one locale, CRC read-only/machine-owned (`auto on save` for new keys), search filters keys AND text, ＋ Add key, modified triple-encoding + tab ●, same tabstrip/crumb/gate-chip anatomy as 014, gate message `✓ byte-exact round-trip · CRC index rebuilt` |

## How to apply

- `/gsd:ui-phase 5` (next step) loads these as locked decisions — UI-SPEC must cite them, not re-derive.
- `/gsd:plan-phase 5` — each UI plan's frontmatter/must_haves enumerates its sketch's elements above.
- Refactor caveat applies: reusing/relocating an existing component does NOT excuse divergence.
- Close this todo only when Phase 5 verification has diffed each built surface against its sketch.
