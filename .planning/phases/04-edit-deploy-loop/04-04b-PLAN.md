---
phase: 04-edit-deploy-loop
plan: 04b
type: execute
wave: 3
depends_on:
  - 04-04
  - 04-02
files_modified:
  - packages/renderer/src/components/ChangesetTimelinePanel.tsx
  - packages/renderer/src/components/ChangesetTimelinePanel.test.tsx
autonomous: true
requirements:
  - DEPLOY-03

must_haves:
  truths:
    - "ChangesetTimelinePanel renders the full changesets[] graph (not just a flat linear list); each node shows its label, timestamp, and its parentId connection."
    - "activeVersionId has a distinct visual marker (e.g. green ring or bold border) — different from deployedVersionId marker (e.g. blue ring)."
    - "When activeVersionId !== deployedVersionId, the panel renders a stale-deployment warning badge so the user knows their deployed patch is not the current edit version."
    - "Clicking a node calls selectVersion(node.id); the panel does NOT implement flatten or parent-chain walking itself — it calls selectVersion from changesetService."
    - "A node that is on a branch (parentId points to a non-tail node) shows a branch divergence indicator (e.g. different indent or branch icon) so the user can see the graph structure."
  artifacts:
    - path: packages/renderer/src/components/ChangesetTimelinePanel.tsx
      provides: Graph-aware timeline panel; branch-divergence display; active/deployed pips; selectVersion wiring
    - path: packages/renderer/src/components/ChangesetTimelinePanel.test.tsx
      provides: 5 unit tests for rendering, active/deployed pips, stale badge, click→selectVersion, branch indicator
  key_links:
    - from: packages/renderer/src/components/ChangesetTimelinePanel.tsx
      to: packages/renderer/src/services/changesetService.ts
      via: "selectVersion(id) from '../../services/changesetService'"
      pattern: "selectVersion"
    - from: packages/renderer/src/components/ChangesetTimelinePanel.tsx
      to: packages/renderer/src/state/changesetStore.ts
      via: "useChangesetStore hooks for activeVersionId, deployedVersionId, changesets"
      pattern: "useChangesetStore"
---

## Phase Goal

**As a** SWG mod developer, **I want to** stage edited files in a project workspace and build a deployable `.tre` patch that activates via the client config, **so that** I can iterate on mod changes in-game, roll back to any prior state, and version my work safely via Git/LFS.

<objective>
Implement the ChangesetTimelinePanel — the graph-aware version history UI that replaces the prior flat-list "changesets" display.

This plan requires the graph engine from 04-04 (changesetService: flatten, sealVersion, selectVersion) and the Dockview panel wiring from 04-02 (workspace-config.ts).

Key requirements from the REFINED model (D-04-05..08):
- The panel must show branch divergence (nodes whose parentId is not the immediately preceding node in chronological order are on a branch).
- Two separate visual markers: activeVersionId (current editing pointer) vs deployedVersionId (what is live in the client).
- Stale-deployment indicator when the two pips diverge.
- Clicking a node calls selectVersion(id) (from changesetService), which updates the manifest AND materializes the staging store — the UI does not do this itself.

Output: ChangesetTimelinePanel.tsx (graph visualization with branch display) + ChangesetTimelinePanel.test.tsx (5 tests GREEN).
</objective>

<execution_context>
@D:\Code\SWG-Toolkit\.claude\get-shit-done\workflows\execute-plan.md
@D:\Code\SWG-Toolkit\.claude\get-shit-done\templates\summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/04-edit-deploy-loop/04-CONTEXT.md
@.planning/phases/04-edit-deploy-loop/04-PATTERNS.md

<interfaces>
<!-- changesetStore selectors -->
useChangesetStore(s => s.manifest)          // WorkspaceChangesetManifest | null
useChangesetStore(s => s.manifest?.activeVersionId)
useChangesetStore(s => s.manifest?.deployedVersionId)
useChangesetStore(s => s.manifest?.changesets)  // SwgChangeset[]

<!-- selectVersion from changesetService -->
import { selectVersion } from '../../services/changesetService';
selectVersion(id: string | null): void
// Updates manifest.activeVersionId AND restores stagingStore.entries via flatten(id)
// The UI just calls this and reacts to store updates

<!-- Graph layout algorithm for the panel (keep simple — this is a mod tool, not GitHub) -->
// All changesets sorted by timestamp (newest first or oldest first — user preference from 04-CONTEXT.md: oldest first, simplest).
// A node is a BRANCH START if its parentId does NOT match the immediately preceding node's id in chronological order.
// Branch nodes indent by 1 level (left-pad with a connector).
// The main chain (root → latest linear descendant) renders at indent 0.
// Branch chains render at indent 1 (sub-indent) under their branch point.
// This is a simplified graph visualization; CSS border/background shows the tree structure.
// No SVG required — pure div/CSS is fine for the alpha release.

<!-- SwgChangeset (from contracts — 04-01) -->
interface SwgChangeset {
  id: string;
  parentId: string | null;
  label: string;
  timestamp: string;
  sealedBy: 'manual' | 'pack';
  deltas: FileDelta[];
  deployRecord?: CfgDeployRecord;
}
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: ChangesetTimelinePanel.test.tsx — 5 tests for graph display, active/deployed pips, stale badge, branch indicator</name>
  <files>
    packages/renderer/src/components/ChangesetTimelinePanel.test.tsx
  </files>
  <read_first>
    packages/renderer/src/components/StagingPanel.tsx and any adjacent .test.tsx files — read for the exact Vitest + React Testing Library pattern used in the renderer.
    packages/renderer/src/state/changesetStore.ts — read the full store shape (04-01 revised) to write accurate test setup.
    packages/renderer/src/state/stagingStore.ts — read restoreEntries (used indirectly via selectVersion, mock it in tests).
    packages/renderer/src/services/changesetService.ts — read the selectVersion export (04-04).
  </read_first>
  <behavior>
    - Test 1: Given manifest with 3 changesets (linear chain), panel renders all 3 labels. Each node shows its label text.
    - Test 2: The node whose id matches activeVersionId has a data-active or aria-current="step" attribute (or distinctive class 'active-version-node'); other nodes do not.
    - Test 3: The node whose id matches deployedVersionId has a 'deployed-version-node' class; when activeVersionId !== deployedVersionId, a '[STALE]' or '⚠' text or aria-label is present in the panel.
    - Test 4: Clicking a node calls selectVersion with that node's id. Use vi.mock to mock changesetService so selectVersion is a vi.fn(). Verify it was called with the clicked node's id.
    - Test 5: Given manifest with a branch (3 nodes: root → v1 → v2 linear, plus v3 branching off root), the branch node (v3) has a 'branch-node' class or data-branch="true" attribute. The non-branch nodes do not have this attribute.
  </behavior>
  <action>
    Import { render, screen, fireEvent } from '@testing-library/react'. Import { describe, it, expect, vi, beforeEach } from 'vitest'. Import ChangesetTimelinePanel from './ChangesetTimelinePanel'. Import { useChangesetStore } from '../state/changesetStore'.

    vi.mock('../services/changesetService', () => ({ selectVersion: vi.fn() })).
    import { selectVersion } from '../services/changesetService';

    Helper: buildManifest(nodes: Partial<SwgChangeset>[]): WorkspaceChangesetManifest — creates a manifest from partial changesets with auto-filled defaults.

    For each test, call useChangesetStore.setState({ manifest: testManifest }) in a beforeEach or within the test.

    Test 5 branch setup: { id:'root', parentId:null }, { id:'v1', parentId:'root' }, { id:'v2', parentId:'v1' }, { id:'v3', parentId:'root' } — v3 branches off root directly (not off v2).

    Write tests to compile (RED); component is created in Task 2.
  </action>
  <verify>
    <automated>pnpm --filter @swg/renderer exec tsc --noEmit 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    pnpm --filter @swg/renderer exec tsc --noEmit exits 0.
    grep -c "active-version-node\|aria-current\|data-active" packages/renderer/src/components/ChangesetTimelinePanel.test.tsx gives 1+.
    grep -c "deployed-version-node\|data-deployed" packages/renderer/src/components/ChangesetTimelinePanel.test.tsx gives 1+.
    grep -c "STALE\|stale\|⚠\|stale.*badge" packages/renderer/src/components/ChangesetTimelinePanel.test.tsx gives 1+.
    grep -c "branch-node\|data-branch\|branch.*true" packages/renderer/src/components/ChangesetTimelinePanel.test.tsx gives 1+.
    grep -c "selectVersion" packages/renderer/src/components/ChangesetTimelinePanel.test.tsx gives 1+.
  </acceptance_criteria>
  <done>ChangesetTimelinePanel.test.tsx written with 5 test cases; TypeScript compiles; tests RED until Task 2.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: ChangesetTimelinePanel.tsx — graph visualization, pips, stale badge, selectVersion — make tests GREEN</name>
  <files>
    packages/renderer/src/components/ChangesetTimelinePanel.tsx
  </files>
  <read_first>
    packages/renderer/src/components/StagingPanel.tsx — read for the panel wrapper pattern (className, overflow, padding conventions).
    packages/renderer/src/state/changesetStore.ts — read to confirm selector shape for manifest.changesets, activeVersionId, deployedVersionId.
    packages/renderer/src/components/ChangesetTimelinePanel.test.tsx — read (Task 1) to confirm data-attributes the component must provide.
    04-CONTEXT.md §D-04-06 — timeline shows labels, active/deployed pips, and branch divergence; no SVG required.
  </read_first>
  <behavior>
    All 5 ChangesetTimelinePanel.test.tsx tests must be GREEN after this task.
  </behavior>
  <action>
    Create packages/renderer/src/components/ChangesetTimelinePanel.tsx.

    Use React 19 + TypeScript. Import useChangesetStore. Import { selectVersion } from '../services/changesetService'. Import { SwgChangeset, WorkspaceChangesetManifest } from '@swg/contracts'.

    Component: function ChangesetTimelinePanel(): React.JSX.Element.

    const manifest = useChangesetStore(s => s.manifest).
    const activeVersionId = manifest?.activeVersionId ?? null.
    const deployedVersionId = manifest?.deployedVersionId ?? null.
    const changesets = manifest?.changesets ?? [].
    const stale = activeVersionId !== null && deployedVersionId !== null && activeVersionId !== deployedVersionId.

    Graph layout computation (pure function, no SVG):
    Compute which nodes are branch starts. A node is a branch start when its parentId is not the id of the chronologically preceding sibling in the sorted list. Implementation: sort changesets by timestamp ascending. Build a Map<id, SwgChangeset>. For each node, check if node.parentId === previousNodeInChronologicalOrder.id; if not (and parentId is not null), mark as branch node.

    Render:
    - Outer div className="changeset-timeline flex flex-col gap-1 p-2 overflow-y-auto" (matches StagingPanel padding convention).
    - If stale: div className="stale-deploy-warning text-yellow-400 text-xs mb-2" — display '⚠ Deployed version is not the current edit version'.
    - For each node (sorted by timestamp): render a div with:
        - className including 'changeset-node' and ('active-version-node' if id === activeVersionId) and ('deployed-version-node' if id === deployedVersionId) and ('branch-node' if isBranchStart).
        - data-branch={isBranchStart ? 'true' : undefined}.
        - onClick: () => selectVersion(node.id).
        - Inner: label text + timestamp.
        - Pips row: if id === activeVersionId → green dot ('●') aria-label='Active version'; if id === deployedVersionId → blue dot ('●') aria-label='Deployed version'.
        - Branch nodes get a left-pad or border-left to indicate tree depth (CSS or inline style).

    Keep the component under 100 lines — it is a display layer over the graph engine (04-04), not a reimplementation.

    CRITICAL: Component never calls flatten() or walks parentId itself. Display only — selectVersion (from changesetService) handles all state transitions.
  </action>
  <verify>
    <automated>pnpm --filter @swg/renderer test 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    pnpm --filter @swg/renderer test exits 0 (includes 5 ChangesetTimelinePanel tests GREEN).
    grep -c "flatten\|parentId.*walk\|while.*parentId\|for.*chain" packages/renderer/src/components/ChangesetTimelinePanel.tsx gives 0 (display layer only — no graph walking).
    grep -c "selectVersion" packages/renderer/src/components/ChangesetTimelinePanel.tsx gives 1+ (wired on click).
    grep -c "active-version-node\|activeVersionId" packages/renderer/src/components/ChangesetTimelinePanel.tsx gives 1+.
    grep -c "deployed-version-node\|deployedVersionId" packages/renderer/src/components/ChangesetTimelinePanel.tsx gives 1+.
    grep -c "branch-node\|isBranch\|data-branch" packages/renderer/src/components/ChangesetTimelinePanel.tsx gives 1+.
    grep -c "stale-deploy-warning\|stale.*warning\|STALE\|⚠" packages/renderer/src/components/ChangesetTimelinePanel.tsx gives 1+.
    wc -l < packages/renderer/src/components/ChangesetTimelinePanel.tsx gives a number less than 120 (concise display layer).
  </acceptance_criteria>
  <done>ChangesetTimelinePanel.tsx renders graph (branch-node markers, active/deployed pips, stale badge); clicks call selectVersion; zero flatten/parentId walking in component; 5 tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User click → selectVersion(id) | Arbitrary id passed to selectVersion; validated in service (T-04-15) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-17 | Tampering | ChangesetTimelinePanel passing arbitrary id to selectVersion | mitigate | selectVersion validates id exists in manifest.changesets before modifying disk (T-04-15 in 04-04 plan) |
| T-04-18 | Denial of Service | Timeline render with very large changesets[] | accept | Phase 4 target is mod developers with a few hundred changesets max; no virtualization needed |
| T-04-SC | Tampering | npm/pip installs | mitigate | No new npm packages; slopcheck not required |
</threat_model>

<verification>
pnpm --filter @swg/renderer test exits 0 (7 graph-engine tests from 04-04 + 5 timeline tests = 12 total passing).
pnpm --filter @swg/renderer exec tsc --noEmit exits 0.
</verification>

<success_criteria>
ChangesetTimelinePanel.tsx renders all nodes with active/deployed pips and branch-node markers; stale-deployment warning when active !== deployed; clicks call selectVersion(id) from changesetService (no graph logic in component); 5 tests GREEN.
</success_criteria>

<output>
Create .planning/phases/04-edit-deploy-loop/04-04b-SUMMARY.md when done.
</output>
