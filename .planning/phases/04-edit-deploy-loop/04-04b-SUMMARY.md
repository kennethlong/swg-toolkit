---
phase: 04-edit-deploy-loop
plan: 04b
subsystem: deploy-ui
tags: [react, zustand, vitest, changeset-graph, tdd]
dependency_graph:
  requires:
    - 04-04  # changesetService (selectVersion, graph engine)
    - 04-02  # StagingPanel, workspace-config wiring, WorkspaceShell panelComponents
  provides:
    - ChangesetTimelinePanel (real implementation, panels/deploy/)
  affects:
    - packages/renderer/src/workspace/WorkspaceShell.tsx (panelComponents 'changesets' now real)
tech_stack:
  added: []
  patterns:
    - jsdom vitest test for React panel components (useChangesetStore.setState + vi.mock service)
    - branchSet() pure function for branch-start detection via chronological predecessor check
key_files:
  created:
    - packages/renderer/src/panels/deploy/ChangesetTimelinePanel.test.tsx
  modified:
    - packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx
decisions:
  - "Component defined as (): JSX.Element (no IDockviewPanelProps) — TypeScript allows assignment to React.FC<IDockviewPanelProps<any>> in panelComponents registry via parameter elision"
  - "Branch detection uses simple chronological sort + predecessor check — no SVG, no full DAG traversal; sufficient for alpha mod tooling"
  - "stale-deploy-warning uses class name (not just ⚠ text) so tests can querySelector('.stale-deploy-warning') reliably"
metrics:
  duration: "~15 min"
  completed: "2026-06-27"
  tasks_completed: 2
  files_changed: 2
---

# Phase 04 Plan 04b: ChangesetTimelinePanel Summary

**One-liner:** Graph-aware version timeline panel with branch-node detection, active/deployed pips, and stale-deployment badge wired to changesetService.selectVersion.

## What Was Built

Replaced the stub `ChangesetTimelinePanel.tsx` (merged from 04-02) with a real 90-line graph-aware display component. The component:

- Reads `manifest.changesets`, `activeVersionId`, `deployedVersionId` from `useChangesetStore`
- Computes branch-start nodes via `branchSet()` — a node is a branch start when its `parentId` differs from the chronologically preceding sibling's `id`
- Renders nodes sorted by timestamp (oldest-first) with:
  - `active-version-node` class + green ● pip for the active version
  - `deployed-version-node` class + blue ● pip for the deployed version
  - `branch-node` class + `data-branch="true"` + left-indent for branch nodes
  - `stale-deploy-warning` div when `activeVersionId !== deployedVersionId`
- Click handler: `() => selectVersion(node.id)` — zero graph walking in the component

## TDD Gate Compliance

| Phase | Commit | Status |
|-------|--------|--------|
| RED   | 871bc01 | test(04-04b): 5 failing tests + stub signature fix |
| GREEN | 0db1532 | feat(04-04b): real component, 28 tests pass |

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ChangesetTimelinePanel.test.tsx — 5 tests RED | 871bc01 | ChangesetTimelinePanel.test.tsx, ChangesetTimelinePanel.tsx (stub sig fix) |
| 2 | ChangesetTimelinePanel.tsx — make tests GREEN | 0db1532 | ChangesetTimelinePanel.tsx |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stub had IDockviewPanelProps causing test compilation failures**
- **Found during:** Task 1 TypeScript check
- **Issue:** The stub signature `_props: IDockviewPanelProps` required `api`, `containerApi`, `params` props when used in JSX, so `render(<ChangesetTimelinePanel />)` failed TSC with TS2739
- **Fix:** Updated stub to `(): React.JSX.Element` (no props). TypeScript allows assigning a zero-arg function to `React.FunctionComponent<IDockviewPanelProps<any>>` via parameter elision — the WorkspaceShell panelComponents registry type-checks correctly
- **Files modified:** `packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx`
- **Commit:** 871bc01

**2. [Rule 1 - Bug] "flatten" keyword in JSDoc comment triggered false-positive grep check**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The JSDoc comment said "this component never calls flatten()" which made `grep -c "flatten\|..."` return 1 instead of 0
- **Fix:** Removed the word "flatten" from the comment entirely; component name `branchSet()` makes intent clear
- **Commit:** 0db1532

**3. [Rule 1 - Bug] "components/" in test file comment triggered false-positive R2-B4 grep**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The comment `NOT components/` matched `from.*components/` grep pattern
- **Fix:** Rephrased comment to avoid the phrase
- **Commit:** 0db1532

## Acceptance Criteria — Final Check

| Criterion | Result |
|-----------|--------|
| pnpm test exits 0 (28 tests: 8 graph + 5 timeline + 5 cfgScan + 4 cfgActivator + 6 gitLfs) | PASS |
| pnpm tsc --noEmit exits 0 | PASS |
| selectVersion count in TSX (1+) | 3 |
| active-version-node\|activeVersionId count in TSX (1+) | 5 |
| deployed-version-node\|deployedVersionId count in TSX (1+) | 5 |
| branch-node\|isBranch\|data-branch count in TSX (1+) | 5 |
| stale-deploy-warning\|⚠ count in TSX (1+) | 2 |
| flatten\|parentId walk in TSX (0) | 0 |
| from components/ import in TSX (0) | 0 |
| Line count < 120 | 90 |
| from components/ in test file (0) | 0 |

## Known Stubs

None. The real component is fully implemented.

## Threat Flags

None. The component calls `selectVersion(id)` which already validates the id against `manifest.changesets` (T-04-15 in 04-04) before any filesystem mutation.

## Self-Check: PASSED

- `packages/renderer/src/panels/deploy/ChangesetTimelinePanel.tsx` — exists, 90 lines
- `packages/renderer/src/panels/deploy/ChangesetTimelinePanel.test.tsx` — exists, 5 tests
- Commits 871bc01 and 0db1532 verified in `git log --oneline`
