---
id: vcs-panel-sketch-and-placement
title: Version Control panel has no governing sketch — interior never designed; S3 placement decision still open
created: 2026-07-06
origin: Maintainer question during 04.4-15 D-22 UAT — "on the Version Control tab, did we sketch that out anywhere?" Answer: no.
severity: medium (panel now carries real product surface — Git/LFS + Server Push — with no UI contract; sketches are the UI source of truth per AGENTS.md)
area: renderer / VcsPanel + .planning/sketches
status: pending
related: server-binding-post-create-ux
---

## Problem — VcsPanel grew real features with no sketch

Sketch coverage today (checked 2026-07-06):
- 008-shell-composition (+ MANIFEST warning) defines only the panel's EXCLUSION: the Deploy tab
  is ONE DeployPanel; "VCS (Git/LFS) stays its own separate tab". That is the entire spec —
  placement by negation, zero interior design.
- Note the tension: 008's README says the right dock group has "exactly two tabs — Inspect and
  Deploy", yet VCS docks `within` that same group (WorkspaceShell PANEL_REOPEN_POSITIONS), making
  it a third tab. This is the still-open S3 (VCS tab placement) ambiguity from 04.3-09.
- Since then, 04.4-12 added the Server Push section (flavor chip, path, Push to Server / Reset,
  per-flavor guidance copy) directly from plan spec — no sketch governs it.

## Wanted

A /gsd-sketch session (next number, e.g. 018-version-control-panel) covering:
- S3 placement decision: third tab in the Inspect group vs elsewhere — decided by the maintainer
  looking at variants, closing the 04.3-09 open question.
- Interior layout: Git/LFS status/actions + Server Push section (including the empty/unbound
  state proposed in server-binding-post-create-ux) + where a future server-log/console hook lives.
- Per AGENTS.md sketch rules, once approved it becomes the UI contract and any later VcsPanel
  plan must enumerate its elements as must_haves.
