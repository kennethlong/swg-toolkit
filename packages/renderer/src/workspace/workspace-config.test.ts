/**
 * packages/renderer/src/workspace/workspace-config.test.ts
 * Unit tests for workspace-config constants and buildInitialLayout — DEPLOY-07 / D-03.
 *
 * Tests:
 *   1 — LAYOUT_VERSION is exported and >= 2 (panel-id swap bump)
 *   2 — LAYOUT_VERSION_KEY is exported as a non-empty string
 *   3 — buildInitialLayout adds a 'deploy' panel within the inspector group (~440px)
 *   4 — buildInitialLayout does NOT add a 'staging' panel (retired id)
 *   5 — buildInitialLayout does NOT add a 'changesets' panel (retired id)
 *   6 — plan 09 (S4): LAYOUT_VERSION >= 3 after bottom-pane trio bump
 *   7 — plan 09 (S4): inspector panel title is 'Inspect' (not 'Inspector')
 *   8 — 05-08: 'datatable' panel NOT added by buildInitialLayout (retired placeholder —
 *       DatatableGridEditor now opens dynamically via editorTabs.ts)
 *   9 — plan 09 (S8) / 05-08: 'console' and 'log' panels present in the bottom-pane group,
 *       'console' anchored directly below the viewport (was 'datatable')
 *  10 — plan 09 (S8): 'data' panel NOT added by buildInitialLayout (retired)
 *
 * RED phase (Task 1): tests fail because LAYOUT_VERSION/LAYOUT_VERSION_KEY are not
 * yet exported and buildInitialLayout still adds staging+changesets.
 * GREEN phase (Task 2): all 5 tests pass once workspace-config.ts is updated.
 *
 * Source: 04.1-05-PLAN.md Task 1; 04.1-RESEARCH.md §Pattern 6.
 *         04.3-09-PLAN.md Task 3 (Tests 6–10).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DockviewApi } from 'dockview';

// Import the items under test — LAYOUT_VERSION and LAYOUT_VERSION_KEY do not exist
// in the current file (RED) and will be `undefined` at runtime; TS errors are
// non-fatal in the vitest/esbuild transpile path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { buildInitialLayout, LAYOUT_VERSION, LAYOUT_VERSION_KEY } from './workspace-config';

// ─── Helper: build a minimal mock DockviewApi ─────────────────────────────────

function buildMockApi() {
  const panels: Array<{ id: string; component: string; position?: unknown; initialWidth?: number }> = [];
  const mockApi = {
    addPanel: vi.fn((opts: { id: string; component: string; position?: unknown; initialWidth?: number }) => {
      panels.push(opts);
      return {};
    }),
  } as unknown as DockviewApi;
  return { mockApi, panels };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('workspace-config — LAYOUT_VERSION', () => {

  it('Test 1: LAYOUT_VERSION is exported and >= 2', () => {
    // RED: LAYOUT_VERSION is not exported yet → undefined; undefined >= 2 is false
    expect(LAYOUT_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('Test 2: LAYOUT_VERSION_KEY is exported as a non-empty string', () => {
    // RED: LAYOUT_VERSION_KEY is not exported yet → undefined; typeof undefined !== 'string'
    expect(typeof LAYOUT_VERSION_KEY).toBe('string');
    expect((LAYOUT_VERSION_KEY as unknown as string | undefined)?.length ?? 0).toBeGreaterThan(0);
  });

});

describe('workspace-config — buildInitialLayout panel swap', () => {

  it('Test 3: adds a "deploy" panel within the inspector group with initialWidth ~440', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    const deployPanel = panels.find((p) => p.id === 'deploy');
    // RED: buildInitialLayout adds staging/changesets, not deploy → deployPanel is undefined
    expect(deployPanel).toBeDefined();
    expect((deployPanel as { position?: { direction?: string; referencePanel?: string } } | undefined)
      ?.position?.direction).toBe('within');
    expect((deployPanel as { position?: { referencePanel?: string } } | undefined)
      ?.position?.referencePanel).toBe('inspector');
    expect((deployPanel?.initialWidth ?? 0)).toBeGreaterThanOrEqual(400);
  });

  it('Test 4: does NOT add a "staging" panel (retired id)', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    const stagingPanel = panels.find((p) => p.id === 'staging');
    // RED: staging IS still added → stagingPanel is defined → expect undefined FAILS
    expect(stagingPanel).toBeUndefined();
  });

  it('Test 5: does NOT add a "changesets" panel (retired id)', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    const changesetsPanel = panels.find((p) => p.id === 'changesets');
    // RED: changesets IS still added → changesetsPanel is defined → expect undefined FAILS
    expect(changesetsPanel).toBeUndefined();
  });

});

// ─── Plan 09 additions (S4 + S8) ─────────────────────────────────────────────

describe('workspace-config — plan 09: Inspect tab + Datatable/Console/Log trio', () => {

  it('Test 6: LAYOUT_VERSION >= 3 after bottom-pane trio bump (plan 09)', () => {
    expect(LAYOUT_VERSION).toBeGreaterThanOrEqual(3);
  });

  it('Test 7 (S4): inspector panel title is "Inspect" not "Inspector"', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    const inspector = panels.find((p) => p.id === 'inspector');
    expect(inspector).toBeDefined();
    expect((inspector as Record<string, unknown>)['title']).toBe('Inspect');
  });

  it('Test 8 (05-08): does NOT add a "datatable" panel (retired placeholder)', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    const dt = panels.find((p) => p.id === 'datatable');
    expect(dt).toBeUndefined();
  });

  it('Test 9 (S8 / 05-08): adds "console" (below viewport) and "log" (within console) panels', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    const consolePanel = panels.find((p) => p.id === 'console');
    const logPanel     = panels.find((p) => p.id === 'log');
    expect(consolePanel).toBeDefined();
    expect(logPanel).toBeDefined();

    // 05-08: console is now the direct bottom-pane anchor (datatable retired).
    expect(
      (consolePanel as { position?: { direction?: string; referencePanel?: string } } | undefined)
        ?.position?.direction,
    ).toBe('below');
    expect(
      (logPanel as { position?: { direction?: string; referencePanel?: string } } | undefined)
        ?.position?.direction,
    ).toBe('within');
    expect(
      (logPanel as { position?: { direction?: string; referencePanel?: string } } | undefined)
        ?.position?.referencePanel,
    ).toBe('console');
  });

  it('Test 10 (S8): does NOT add a "data" panel (retired by trio)', () => {
    const { mockApi, panels } = buildMockApi();
    buildInitialLayout(mockApi);

    expect(panels.find((p) => p.id === 'data')).toBeUndefined();
  });

});
