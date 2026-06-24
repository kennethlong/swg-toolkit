---
id: UI-REPO-TREE
title: Repository tree view — browse the VFS grouped by TRE directory structure (tabbed)
created: 2026-06-24
origin: Maintainer feature note during Phase 02 testing
status: backlog
kind: feature
suggested_milestone: post-v1.0 (or fold into a UI/Assets-panel milestone)
reference: Sytner's IFF Editor (SIE 3.11.6.8) left-hand repository tree (see protocol_droid_red SIE screenshot)
---

## What

Add a **Repository tree view**: a hierarchical browser where every VFS entry is grouped by its
TRE directory structure — a collapsible folder tree like Sytner's IFF Editor's left panel
(`abstract / animation / appearance / { ash, collision, component, lat, lod, mask, mesh,
skeleton, sprite, ssa } / camera / chat / clientdata / ...`). The user expands folders to drill
into the structure rather than scanning a flat list.

## How it fits the existing UI

- The Assets panel currently shows a **flat** VFS list (`VfsTree.tsx` — despite the name, it's a
  flat virtualized list of resolved entries).
- Make the Assets panel **tabbed**: Tab 1 = the current flat list (search-driven), Tab 2 = the
  new Repository tree (structure-driven). Both operate over the same mounted, shadow-resolved VFS.

## Technical notes (for whoever builds it)

- The data is already present: each `VfsEntry` has `segments` (the path split on `/`) and
  `winnerArchive*` / override / tombstone metadata — enough to build the folder hierarchy and
  carry the same override/⊘/⧉ indicators into the tree.
- **MUST be virtualized / lazy-expand.** The full set is ~244k entries / 27 archives. Build the
  tree lazily (expand a folder → materialize its children on demand) and window the visible rows,
  exactly like the perf lesson from `VfsTree` virtualization and `HexInspector` (don't build a
  244k-node tree eagerly — that was the >1min hang we already fixed once).
- Selecting a leaf reuses the existing `handleSelectEntry` path (resolveChain + viewport
  open-handler), so the viewport/IFF wiring is unchanged.
- Reuse the shadow-resolution model: a folder's leaf shows its winning archive; overrides/
  tombstones surface in the tree the same way the flat list shows them.

## Why backlog, not now

Pure UX enhancement; the flat + search view already covers navigation for the current milestone
(VIEW-01..04). Capture now, schedule later (own UI/Assets milestone or a polish pass).
