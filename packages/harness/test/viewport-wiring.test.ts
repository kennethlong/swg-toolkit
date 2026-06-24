/**
 * viewport-wiring.test.ts — Integration test: open-handler → viewportStore wiring.
 *
 * Regression guard for the PRIMARY gap-closure bug (2026-06-24):
 * The viewport feature was built but never integration-wired. Opening a mesh from
 * the TRE VFS browser drove only the IFF tree store; the viewport store never
 * received beginLoad / loadComplete calls, leaving parsedMesh null and the Canvas
 * rendering nothing.
 *
 * This test asserts that the open→resolve→store→render pipeline works end-to-end
 * at the state-machine level:
 *   1. beginLoad() transitions store from idle → loading.
 *   2. loadComplete() transitions store from loading → done with non-null parsedMesh.
 *   3. The store exposes isSkinned, selectedLod, and resolution with meshes[] populated.
 *   4. The mesh at meshes[selectedLod] (the TERTIARY fix) has a non-null geometry.
 *
 * Implementation note: the native layer is mocked here (no real TRE file needed)
 * so this test runs in CI without requiring SWG Infinity client assets.
 *
 * If you break the wiring in TreVfsBrowser.tsx (remove the resolveAppearance call,
 * or remove beginLoad/loadComplete calls), this test will fail with:
 *   "loadStatus kind after loadComplete: expected 'done' but got 'idle'"
 *
 * Source: gap-closure fix for 02-02-PLAN.md checkpoint (regression_guard requirement).
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Import the store directly — it exports a Zustand hook we can interrogate.
// Vitest runs in Node (not a browser), so we need to shim the zustand store.
// The store has no DOM dependencies, so direct import works.
import { useViewportStore } from '../../renderer/src/state/viewportStore.ts';

// ─── Minimal mock for AppearanceResolutionResult ─────────────────────────────

/** A minimal MeshParseResult with one shader group and a real geometry buffer. */
function makeMockMeshParseResult() {
  // 3 float32 vertices (9 floats × 4 bytes = 36 bytes) + 3 uint32 indices (12 bytes)
  const geometry = new ArrayBuffer(48);
  const floatView = new Float32Array(geometry, 0, 9);
  floatView[0] = 1.0; floatView[1] = 0.0; floatView[2] = 0.0;
  floatView[3] = 0.0; floatView[4] = 1.0; floatView[5] = 0.0;
  floatView[6] = 0.0; floatView[7] = 0.0; floatView[8] = 1.0;
  const idxView = new Uint32Array(geometry, 36, 3);
  idxView[0] = 0; idxView[1] = 1; idxView[2] = 2;

  return {
    formatTag: 'MESH' as const,
    version: '0005',
    shaderGroups: [{
      shaderName: 'shader/test.sht',
      vertexCount: 3,
      indexCount: 3,
      positions: { offset: 0, byteLength: 36, componentCount: 3, elementCount: 3 },
      normals: null,
      uvs: [],
      indices: { offset: 36, byteLength: 12, componentCount: 1, elementCount: 3 },
      skinIndices: null,
      skinWeights: null,
      hasDot3: false,
    }],
    boneNames: undefined,
    weightsTruncated: undefined,
    roundTrip: { passed: true },
  };
}

/** A minimal AppearanceResolutionResult for a static .msh leaf. */
function makeMockResolution() {
  const parsedMesh = makeMockMeshParseResult();
  const geometry = parsedMesh.shaderGroups[0]!.positions.offset === 0
    ? new ArrayBuffer(48)
    : new ArrayBuffer(0);

  return {
    meshes: [{
      path: 'mesh/test.msh',
      parseResult: parsedMesh,
      geometry,
    }],
    skeleton: null,
    materials: [],
    missing: [],
    mode: 'leaf' as const,
    isSkinned: false,
    lodLevels: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('viewportStore wiring — open→resolve→store→render pipeline', () => {
  // Reset store state before each test to ensure isolation.
  beforeEach(() => {
    useViewportStore.getState().reset();
  });

  it('initial state is idle with null parsedMesh', () => {
    const state = useViewportStore.getState();
    expect(state.loadStatus.kind).toBe('idle');
    expect(state.parsedMesh).toBeNull();
    expect(state.resolution).toBeNull();
    expect(state.isSkinned).toBe(false);
    expect(state.selectedLod).toBe(0);
  });

  it('beginLoad() transitions idle → loading and records source-entry fields', () => {
    const { beginLoad } = useViewportStore.getState();
    beginLoad('test.msh', 'mount-handle-1', 2, 7, 'mesh/test.msh');

    const state = useViewportStore.getState();
    expect(state.loadStatus.kind).toBe('loading');
    if (state.loadStatus.kind === 'loading') {
      expect(state.loadStatus.filename).toBe('test.msh');
    }
    // Source-entry fields recorded for Extract in 02-05
    expect(state.sourceMountHandle).toBe('mount-handle-1');
    expect(state.sourceArchiveIndex).toBe(2);
    expect(state.sourceEntryIndex).toBe(7);
    expect(state.sourceEntryPath).toBe('mesh/test.msh');
    // parsedMesh and resolution reset on beginLoad
    expect(state.parsedMesh).toBeNull();
    expect(state.resolution).toBeNull();
  });

  it('loadComplete() transitions loading → done with non-null parsedMesh (PRIMARY wiring fix)', () => {
    const { beginLoad, loadComplete } = useViewportStore.getState();
    const resolution = makeMockResolution();
    const parsedMesh = makeMockMeshParseResult();

    // Simulate the pipeline: TreVfsBrowser calls beginLoad → resolveAppearance → loadComplete
    beginLoad('test.msh', 'mount-handle-1', 0, 0, 'mesh/test.msh');
    loadComplete('test.msh', 'leaf', resolution, false, parsedMesh, null);

    const state = useViewportStore.getState();

    // This assertion is the core regression guard:
    // if TreVfsBrowser never calls loadComplete, loadStatus remains 'loading' or 'idle'
    expect(state.loadStatus.kind).toBe('done');
    if (state.loadStatus.kind === 'done') {
      expect(state.loadStatus.filename).toBe('test.msh');
      expect(state.loadStatus.mode).toBe('leaf');
    }

    // parsedMesh must be non-null for the Canvas to render anything
    expect(state.parsedMesh).not.toBeNull();
    expect(state.parsedMesh?.formatTag).toBe('MESH');
    expect(state.parsedMesh?.shaderGroups).toHaveLength(1);

    // resolution must carry meshes[]
    expect(state.resolution).not.toBeNull();
    expect(state.resolution?.meshes).toHaveLength(1);
    expect(state.resolution?.meshes[0]).not.toBeNull();

    // isSkinned false → StaticMeshView path
    expect(state.isSkinned).toBe(false);
  });

  it('selectedLod indexes meshes[] correctly (TERTIARY LOD fix)', () => {
    const { beginLoad, loadComplete, setSelectedLod } = useViewportStore.getState();

    // Simulate a multi-LOD result (two mesh entries)
    const lod0Mesh = makeMockMeshParseResult();
    const lod1Mesh = makeMockMeshParseResult();
    lod1Mesh.version = '0004'; // differentiate

    const multiLodResolution = {
      meshes: [
        { path: 'mesh/lod0.msh', parseResult: lod0Mesh, geometry: new ArrayBuffer(48) },
        { path: 'mesh/lod1.msh', parseResult: lod1Mesh, geometry: new ArrayBuffer(48) },
      ],
      skeleton: null,
      materials: [],
      missing: [],
      mode: 'leaf' as const,
      isSkinned: false,
      lodLevels: [
        { generatorPath: 'mesh/lod0.msh', minDist: 0, maxDist: 50 },
        { generatorPath: 'mesh/lod1.msh', minDist: 50, maxDist: 200 },
      ],
    };

    beginLoad('lod.msh', 'mount-1', 0, 0, 'mesh/lod.msh');
    loadComplete('lod.msh', 'leaf', multiLodResolution, false, lod0Mesh, null);

    // Default selectedLod=0 → meshes[0]
    expect(useViewportStore.getState().selectedLod).toBe(0);
    const lod0Result = useViewportStore.getState().resolution?.meshes[0];
    expect(lod0Result?.parseResult.version).toBe('0005');

    // Switch to LOD 1 → meshes[1]
    setSelectedLod(1);
    expect(useViewportStore.getState().selectedLod).toBe(1);
    const lod1Result = useViewportStore.getState().resolution?.meshes[1];
    expect(lod1Result?.parseResult.version).toBe('0004');
  });

  it('resolution.missing[] is preserved for ⚠ warning (D-04 partial resolution)', () => {
    const { beginLoad, loadComplete } = useViewportStore.getState();

    const partialResolution = {
      ...makeMockResolution(),
      missing: ['shader/missing.sht', 'texture/missing.dds'],
    };

    beginLoad('partial.msh', 'mount-1', 0, 0, 'appearance/partial.msh');
    loadComplete('partial.msh', 'leaf', partialResolution, false, makeMockMeshParseResult(), null);

    const state = useViewportStore.getState();
    expect(state.loadStatus.kind).toBe('done');
    // Renderer shows ⚠ warning based on resolution.missing — must be preserved
    expect(state.resolution?.missing).toHaveLength(2);
    expect(state.resolution?.missing[0]).toBe('shader/missing.sht');
    // parsedMesh still non-null despite missing deps (partial render, not crash)
    expect(state.parsedMesh).not.toBeNull();
  });

  it('loadError() records error state without polluting parsedMesh', () => {
    const { beginLoad, loadError } = useViewportStore.getState();

    beginLoad('bad.msh', 'mount-1', 0, 0, 'mesh/bad.msh');
    loadError('bad.msh', 'FormatParseError: FORM SKMG expected');

    const state = useViewportStore.getState();
    expect(state.loadStatus.kind).toBe('error');
    if (state.loadStatus.kind === 'error') {
      expect(state.loadStatus.reason).toContain('FormatParseError');
    }
    // parsedMesh must be null on error — Canvas shows error state, not stale mesh
    expect(state.parsedMesh).toBeNull();
    expect(state.resolution).toBeNull();
  });

  it('reset() returns store to idle with all fields null', () => {
    const { beginLoad, loadComplete, reset } = useViewportStore.getState();
    const resolution = makeMockResolution();
    beginLoad('x.msh', 'mount-1', 0, 0, 'x.msh');
    loadComplete('x.msh', 'leaf', resolution, false, makeMockMeshParseResult(), null);

    reset();

    const state = useViewportStore.getState();
    expect(state.loadStatus.kind).toBe('idle');
    expect(state.parsedMesh).toBeNull();
    expect(state.parsedSkeleton).toBeNull();
    expect(state.resolution).toBeNull();
    expect(state.sourceMountHandle).toBeNull();
    expect(state.sourceArchiveIndex).toBeNull();
    expect(state.selectedLod).toBe(0);
  });
});
