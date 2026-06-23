/**
 * packages/contracts/src/iff.ts — IFF FORM/chunk type contracts.
 *
 * The IFF node tree crosses the N-API boundary as structure-typed JSON.
 * Binary payloads (chunk bytes) cross zero-copy as ArrayBuffer via getChunkBytes().
 * Binary NEVER crosses as JSON (AGENTS.md zero-copy rule).
 *
 * Ground truth: swg-client-v2 Iff.cpp:1132-1310 (node walk) + Iff.cpp:508-555 (BE read).
 * Cross-check: Utinni IffReader.cs (node model, security caps).
 *
 * Source: packages/contracts/src/ipc.ts (discriminated-union + provenance-comment style).
 */

/**
 * One node in the parsed IFF FORM/chunk tree.
 *
 * kind 'form': a FORM (or LIST / `CAT `) container block.
 *   - tag is the container type tag (e.g. 'FORM', 'LIST', 'CAT ')
 *   - subType is the FORM's name (the 4-byte word following the length field)
 *   - children holds the child nodes
 *   - length is the declared innerLen (incl. the 4-byte subtype per Iff.cpp:643)
 *
 * kind 'leaf': a leaf chunk (PROP or any non-FORM/LIST/CAT tag).
 *   - tag is the chunk's TypeID (e.g. 'DERV', '0000', 'PROP')
 *   - subType is undefined
 *   - children is undefined
 *   - length is the declared payload length (excl. the 8-byte header)
 *
 * byteOffset: absolute byte offset of the block's 8-byte header in the source buffer.
 *
 * Source: swg-client-v2 Iff.cpp:1132-1310 (enterForm/enterChunk/getLength/getSecondTag).
 */
export interface IffNode {
  /** 4-character ASCII tag (e.g. 'FORM', 'DERV', 'CAT ', '0001'). */
  tag: string;

  /**
   * Declared payload length.
   * For a FORM/LIST/CAT: innerLen INCLUDING the 4-byte subtype tag (Iff.cpp:643).
   * For a leaf: payload byte count (excluding the 8-byte tag+length header).
   *
   * Source: swg-client-v2 Iff.cpp:637-644 (htonl writes length + sizeof(Tag)).
   */
  length: number;

  /**
   * Absolute byte offset of this block's header (the tag field) in the source buffer.
   * The hex pane uses this to jump to and highlight the block's bytes.
   *
   * Source: swg-client-v2 Iff.cpp:508-555 (offset tracking in the walk).
   */
  byteOffset: number;

  /** 'form' for FORM/LIST/CAT containers; 'leaf' for all other chunks. */
  kind: 'form' | 'leaf';

  /**
   * The FORM's sub-type tag (e.g. 'SLOD', 'DERV').
   * Only present when kind === 'form'.
   *
   * Source: swg-client-v2 Iff.cpp:552 (getSecondTag via ntohl).
   */
  subType?: string;

  /**
   * Child nodes (only present when kind === 'form').
   * Source: swg-client-v2 Iff.cpp:1132-1310 (recursive walk).
   */
  children?: IffNode[];
}

/**
 * Explicit trailing-bytes node — NEW TOOLKIT BEHAVIOR, NOT PORTED FROM CLIENT.
 *
 * The real SWG client's Iff::calculateRawDataSize (Iff.cpp:63-84) assumes any bytes
 * after the last top-level block are zeroed and silently ignores them ("-TF- this
 * assumes any extra non-iff data...has been zeroed out", Iff.cpp:69). This toolkit
 * deliberately surfaces such bytes as an explicit node so they are never silently
 * dropped (the client's "ignore" behaviour is the anti-pattern being corrected here).
 *
 * Interior gaps within a FORM's declared length are NOT this node's concern — they
 * are preserved verbatim by the clean-span captured-slice re-emit in the serializer.
 */
export interface IffTrailingBytes {
  /** Number of unexplained bytes after the last top-level block. */
  count: number;
  /** Absolute byte offset of the first trailing byte. */
  offset: number;
}

/**
 * Result of the harness round-trip gate (CORE-04 / CORE-05).
 * Computed by the native layer; displayed read-only in the UI (D-08).
 *
 * Source: packages/harness/assertRoundTrip.ts (round-trip FAIL @ 0x{offset}).
 */
export interface IffRoundTripStatus {
  /** True if serialize(parse(bytes)) === bytes byte-for-byte. */
  passed: boolean;
  /** If passed === false, the absolute offset of the first differing byte. */
  failOffset?: number;
}

/**
 * The full result of parsing an IFF file via parseIff().
 *
 * roots: top-level FORM/chunk nodes (usually exactly one top-level FORM).
 * trailingBytes: non-null when bytes follow the last top-level block.
 * roundTrip: the CORE-04 byte-exact gate result for this parse.
 */
export interface IffParseResult {
  roots: IffNode[];
  trailingBytes: IffTrailingBytes | null;
  roundTrip: IffRoundTripStatus;
}
