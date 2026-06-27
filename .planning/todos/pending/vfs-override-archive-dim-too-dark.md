---
id: vfs-override-archive-dim-too-dark
title: VfsTree non-override (gray) archive name reads as "deselected" — bump it a touch whiter
created: 2026-06-26
origin: Maintainer UI feedback while inspecting the resolved-dependency archive column
severity: low
area: renderer / TRE VFS browser (VfsTree winning-archive pip)
status: pending
---

## Symptom

In the VfsTree winning-archive pip, a non-override entry (`isOverride === false`) renders its
archive name in `var(--color-text-faint)`, which is dark enough that it reads like a
**deselected / disabled** row rather than "this is the sole-provider winner." Cyan
(`var(--color-accent)`, `isOverride === true`) reads fine. Both rows are authoritative winners —
the gray one just isn't overriding a lower archive — so the dimness over-signals.

## NOT a correctness issue

The color only encodes `isOverride` (override vs sole-provider). The archive name shown is the
real `winnerArchiveFilename` for both colors — gray does not mean "not loaded." See
`packages/renderer/src/panels/tre/VfsTree.tsx:360`:
`color: entry.isOverride ? 'var(--color-accent)' : 'var(--color-text-faint)'`.

## Fix (when desired — cosmetic)

Bump the non-override archive label from `--color-text-faint` to a slightly lighter token
(e.g. `--color-text-muted` or a dedicated mid-gray) so it reads as a real, readable label rather
than a deselected/disabled row — while still staying visually subordinate to the cyan override
accent. One-line style change in `VfsTree.tsx` (the winning-archive pip span). Eyeball against the
5 themes so it stays legible in each.

## Severity

Low / cosmetic — purely a legibility tweak; no behavior change. Maintainer flagged "fix later."
