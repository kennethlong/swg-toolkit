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
 *
 * RED phase (Task 1): tests fail because LAYOUT_VERSION/LAYOUT_VERSION_KEY are not
 * yet exported and buildInitialLayout still adds staging+changesets.
 * GREEN phase (Task 2): all 5 tests pass once workspace-config.ts is updated.
 *
 * Source: 04.1-05-PLAN.md Task 1; 04.1-RESEARCH.md §Pattern 6.
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
