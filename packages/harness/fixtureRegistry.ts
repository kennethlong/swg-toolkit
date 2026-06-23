/**
 * fixtureRegistry.ts — CORE-05 format fixture manifest
 *
 * A manifest mapping each FormatId -> { parse, serialize, fixtures[], loaderSource }.
 * Every fixture entry MUST record the swg-client-v2 / Utinni / tre_reader.py file:line
 * it was validated against (standing-gate enforcement, per-fixture).
 *
 * Sweep enforcement: the registry-coverage.test.ts sweep FAILS CI if any registered
 * format has zero fixtures OR any fixture lacks a valid loaderSource citation.
 *
 * Phase 1 initially registers: 'tre' (Task 3 wires it).
 * Later phases register their formats here to inherit the standing gate.
 *
 * Source: CORE-05 requirement; RESEARCH.md § "Verification Harness (CORE-05)".
 * Pattern: packages/contracts/src/ipc.ts (typed manifest style).
 */

/** Unique identifier for a binary format (e.g. 'tre', 'iff', 'mesh'). */
export type FormatId = string;

/** One fixture entry for a registered format. */
export interface FixtureEntry {
  /** Human-readable fixture name (used in test names + diagnostics). */
  name: string;

  /**
   * The committed fixture bytes. For committed fixtures these are handcrafted /
   * regenerated from Utinni synth bytes (D-09). For real-asset fixtures these
   * come from the gitignored fixtures-real/ scratch dir (D-10).
   */
  bytes: Uint8Array;

  /**
   * Source citation: the real loader source (swg-client-v2, Utinni, tre_reader.py)
   * file:line that this fixture's byte layout was validated against.
   *
   * MUST match /swg-client-v2|Utinni|tre_reader\.py/ — the sweep test enforces this.
   * Examples:
   *   'swg-client-v2 TreeFile_SearchNode.cpp:267-275'
   *   'Utinni TreFile.cs:155-310'
   *   'tre_reader.py:33-43'
   */
  loaderSource: string;
}

/** Registry entry for one format. */
export interface FormatRegistryEntry {
  /** Parse function: bytes -> parsed representation (format-specific). */
  parse: (bytes: Uint8Array) => unknown;

  /** Serialize function: parsed representation -> bytes. */
  serialize: (parsed: unknown) => Uint8Array;

  /**
   * Round-trip fixtures for this format.
   * MUST have at least one entry (sweep enforces this).
   */
  fixtures: FixtureEntry[];

  /**
   * Default source citation for the format as a whole (used when a fixture
   * does not override it). Must cite a real loader source.
   */
  loaderSource: string;
}

/** The global format registry. Maps FormatId -> entry. */
const _registry: Record<FormatId, FormatRegistryEntry> = {};

/**
 * Register a format with its parse/serialize functions and fixtures.
 * Calling registerFormat a second time with the same id merges fixtures
 * (allows formats to add fixtures from multiple files).
 *
 * @param id    - Unique format identifier (e.g. 'tre', 'iff')
 * @param entry - Registry entry with parse, serialize, fixtures, loaderSource
 */
export function registerFormat(id: FormatId, entry: FormatRegistryEntry): void {
  if (_registry[id]) {
    // Merge: append fixtures, keep the first registered parse/serialize/loaderSource
    _registry[id]!.fixtures.push(...entry.fixtures);
  } else {
    _registry[id] = {
      parse: entry.parse,
      serialize: entry.serialize,
      fixtures: [...entry.fixtures],
      loaderSource: entry.loaderSource,
    };
  }
}

/**
 * Return a shallow snapshot of the current registry.
 * Tests iterate this to enforce sweep coverage.
 */
export function getRegistry(): Readonly<Record<FormatId, FormatRegistryEntry>> {
  return _registry;
}

/**
 * Run the CORE-05 sweep: assert every registered format has >=1 fixture
 * and every fixture has a valid loaderSource citation.
 *
 * @throws Error listing all violations, if any.
 */
export function assertSweep(): void {
  const CITATION_RE = /swg-client-v2|Utinni|tre_reader\.py/;
  const errors: string[] = [];

  for (const [id, entry] of Object.entries(_registry)) {
    if (entry.fixtures.length === 0) {
      errors.push(`Format '${id}' has zero round-trip fixtures`);
      continue;
    }
    for (const fixture of entry.fixtures) {
      if (!CITATION_RE.test(fixture.loaderSource)) {
        errors.push(
          `Format '${id}' fixture '${fixture.name}' missing loaderSource citation ` +
          `(got: '${fixture.loaderSource}')`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `CORE-05 sweep FAILED — ${errors.length} violation(s):\n` +
      errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
}
