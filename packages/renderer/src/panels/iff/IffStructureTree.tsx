/**
 * packages/renderer/src/panels/iff/IffStructureTree.tsx — IFF FORM/chunk tree viewer.
 *
 * Surface 2: renders the parsed IFF tree (Structure tab) with columns:
 *   Tag  | Kind            | Size (hex + decimal)      | Offset (abs 0x…)
 *   FORM | form:DERV       | 0x0000_000F / 15 bytes    | 0x00000000
 *   DATA | leaf            | 0x00000003 / 3 bytes      | 0x0000000C
 *
 * Appends an explicit ⟨trailing bytes⟩ node (--color-warn + ▴) when present.
 * Footer shows round-trip status (byte-exact ✓ or round-trip FAIL @ 0x{offset}).
 *
 * NO editable fields, NO Save button (D-08 — write path proven by harness only).
 *
 * Source:
 *   01-UI-SPEC.md § "Surface 2 — IFF FORM/Chunk Tree Viewer"
 *   01-CONTEXT.md D-06 (generic IFF tree), D-07 (SIE-successor baseline), D-08 (read-only)
 *   01-03-PLAN.md must_haves — trailing-bytes node, round-trip status footer
 *
 * Ground truth for structure:
 *   swg-client-v2 Iff.cpp:1132-1310 (enterForm/enterChunk walk)
 *   FORM innerLen INCLUDES 4-byte subType tag (Iff.cpp:643)
 *
 * Accessibility Rule 1: state never color alone (glyph + color + caption).
 * Accessibility Rule 5: aria-label + title on every icon-only control.
 * Tokens: var(--color-*), var(--space-*), var(--text-*), var(--font-*) — no arbitrary px
 *         (exceptions: 16px level-indent, 18px hex row height per UI-SPEC).
 *
 * Path B addon access: require('@swg/native-core') directly (nodeIntegration:true).
 */

import React, { useState, useCallback } from 'react';
import type { IffNode } from '@swg/contracts';
import type { IffParseResult, SelectedIffNode } from '../../state/iffStore.ts';
import VerificationStatus from '../../shared/VerificationStatus.tsx';

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface IffStructureTreeProps {
  /** Parse result from the store. */
  parseResult: IffParseResult | null;
  /** Filename being displayed (for progress/error copy). */
  filename: string | null;
  /** Parse status (for empty/parsing/error states). */
  parseStatus: 'idle' | 'parsing' | 'done' | 'error';
  /** Error details when parseStatus === 'error'. */
  parseError?: { reason: string; offset?: number };
  /** Currently selected node. */
  selectedNode: SelectedIffNode | null;
  /** Called when the user selects a node. */
  onSelectNode: (node: SelectedIffNode | null) => void;
}

// ─── Empty / error states ──────────────────────────────────────────────────────

function EmptyState(): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        textAlign: 'center',
      }}
    >
      {/* UI-SPEC Copywriting Contract — exact strings */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
        }}
      >
        No structure loaded
      </span>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
        }}
      >
        Select an IFF file in the Assets panel
      </span>
    </div>
  );
}

function ParsingState({ filename }: { filename: string }): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-muted)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* UI-SPEC: "Parsing {filename}…" */}
      Parsing {filename}…
    </div>
  );
}

function ErrorState({
  filename,
  reason,
  offset,
  onOpenRawBytes,
}: {
  filename: string;
  reason: string;
  offset?: number;
  onOpenRawBytes?: () => void;
}): React.ReactElement {
  const offsetStr = offset != null ? ` @ 0x${offset.toString(16).toUpperCase().padStart(4, '0')}` : '';
  return (
    <div
      style={{
        flex: 1,
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {/* UI-SPEC: "Could not parse {filename} as IFF — {reason} @ 0x{offset}." */}
      <VerificationStatus
        variant="parse-error"
        caption={`Could not parse ${filename} as IFF — ${reason}${offsetStr}.`}
      />
      {onOpenRawBytes && (
        <button
          onClick={onOpenRawBytes}
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            padding: 'var(--space-1) var(--space-2)',
            borderRadius: 'var(--radius-sm)',
            alignSelf: 'flex-start',
          }}
        >
          Open raw bytes
        </button>
      )}
    </div>
  );
}

// ─── Pre-order index computation ──────────────────────────────────────────────

function computePreorderIndex(
  roots: IffNode[],
  target: IffNode,
): { index: number; found: boolean } {
  let counter = 0;
  function walk(node: IffNode): boolean {
    if (node === target) return true;
    counter++;
    if (node.children) {
      for (const child of node.children) {
        if (walk(child)) return true;
      }
    }
    return false;
  }
  for (const root of roots) {
    if (walk(root)) return { index: counter, found: true };
  }
  return { index: -1, found: false };
}

// ─── Column header ─────────────────────────────────────────────────────────────

function ColumnHeader(): React.ReactElement {
  return (
    <div
      role="row"
      style={{
        display: 'grid',
        gridTemplateColumns: '16px 80px 1fr 120px 100px',
        alignItems: 'center',
        height: 'var(--tabstrip-h)',
        background: 'var(--color-header)',
        borderBottom: '1px solid var(--color-border)',
        padding: '0 var(--space-2)',
        flexShrink: 0,
      }}
    >
      <span /> {/* chevron column */}
      <span
        role="columnheader"
        style={{
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-muted)',
        }}
      >
        Tag
      </span>
      <span
        role="columnheader"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
        }}
      >
        Kind
      </span>
      <span
        role="columnheader"
        style={{
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-muted)',
          textAlign: 'right',
        }}
      >
        Size
      </span>
      <span
        role="columnheader"
        style={{
          fontSize: 'var(--text-xs)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-muted)',
          textAlign: 'right',
        }}
      >
        Offset
      </span>
    </div>
  );
}

// ─── Tree node row ─────────────────────────────────────────────────────────────

interface NodeRowProps {
  node: IffNode;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: (node: IffNode) => void;
  roots: IffNode[];
  selectedNodeRef: SelectedIffNode | null;
  onSelectNode: (node: SelectedIffNode | null) => void;
}

function NodeRow({
  node,
  depth,
  isSelected,
  isExpanded,
  onToggle,
  onSelect,
  roots,
  selectedNodeRef,
  onSelectNode,
}: NodeRowProps): React.ReactElement {
  const isForm = node.kind === 'form';
  const hasChildren = isForm && node.children && node.children.length > 0;

  const kindLabel = isForm
    ? `form:${node.subType ?? ''}`
    : 'leaf';

  const hexLen = `0x${node.length.toString(16).toUpperCase().padStart(8, '0')}`;
  const decLen = node.length.toLocaleString();
  const hexOffset = `0x${node.byteOffset.toString(16).toUpperCase().padStart(8, '0')}`;

  const handleClick = useCallback(() => {
    onSelect(node);
    // Compute pre-order index for getChunkBytes calls from HexInspector.
    const { index } = computePreorderIndex(roots, node);
    // Byte range: header (8B for leaf, 12B for form) + payload
    const headerSize = isForm ? 12 : 8;
    const totalSize  = headerSize + node.length;
    onSelectNode({
      node,
      preorderIndex: index,
      byteStart: node.byteOffset,
      byteEnd:   node.byteOffset + totalSize,
    });
  }, [node, onSelect, roots, isForm, onSelectNode]);

  return (
    <div
      role="option"
      aria-selected={isSelected}
      onClick={handleClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '16px 80px 1fr 120px 100px',
        alignItems: 'center',
        paddingLeft: `${depth * 16}px`,
        height: 22,
        cursor: 'pointer',
        background: isSelected
          ? 'var(--color-accent-dim)'
          : undefined,
        borderLeft: isSelected
          ? '2px solid var(--color-accent)'
          : '2px solid transparent',
        transition: 'background 0.1s ease',
        // Hover handled via onMouseEnter/Leave for performance
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLDivElement).style.background =
            'var(--color-surface-2)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLDivElement).style.background = '';
        }
      }}
    >
      {/* Chevron */}
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          color: 'var(--color-text-faint)',
          transition: 'transform 0.15s ease',
          transform:
            hasChildren
              ? isExpanded
                ? 'rotate(90deg)'
                : 'rotate(0deg)'
              : 'none',
          visibility: hasChildren ? 'visible' : 'hidden',
          cursor: hasChildren ? 'pointer' : 'default',
          width: 14,
          flexShrink: 0,
        }}
        onClick={(e) => {
          if (hasChildren) {
            e.stopPropagation();
            onToggle();
          }
        }}
      >
        ▶
      </span>

      {/* Tag — 4-char mono */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {node.tag}
      </span>

      {/* Kind */}
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingRight: 'var(--space-2)',
        }}
      >
        {kindLabel}
      </span>

      {/* Size — hex + decimal, mono */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          textAlign: 'right',
          paddingRight: 'var(--space-2)',
          whiteSpace: 'nowrap',
        }}
      >
        {hexLen} / {decLen}
      </span>

      {/* Offset — mono */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          textAlign: 'right',
          paddingRight: 'var(--space-2)',
          whiteSpace: 'nowrap',
        }}
      >
        {hexOffset}
      </span>
    </div>
  );
}

// ─── Recursive tree ────────────────────────────────────────────────────────────

interface TreeBranchProps {
  nodes: IffNode[];
  depth: number;
  expandedSet: Set<IffNode>;
  selectedNode: SelectedIffNode | null;
  roots: IffNode[];
  onToggle: (node: IffNode) => void;
  onSelect: (node: IffNode) => void;
  onSelectNode: (node: SelectedIffNode | null) => void;
}

function TreeBranch({
  nodes,
  depth,
  expandedSet,
  selectedNode,
  roots,
  onToggle,
  onSelect,
  onSelectNode,
}: TreeBranchProps): React.ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        const isExpanded = expandedSet.has(node);
        const isSelected = selectedNode?.node === node;
        return (
          <React.Fragment key={`${node.tag}-${node.byteOffset}-${i}`}>
            <NodeRow
              node={node}
              depth={depth}
              isSelected={isSelected}
              isExpanded={isExpanded}
              onToggle={() => onToggle(node)}
              onSelect={onSelect}
              roots={roots}
              selectedNodeRef={selectedNode}
              onSelectNode={onSelectNode}
            />
            {node.kind === 'form' && isExpanded && node.children && node.children.length > 0 && (
              <TreeBranch
                nodes={node.children}
                depth={depth + 1}
                expandedSet={expandedSet}
                selectedNode={selectedNode}
                roots={roots}
                onToggle={onToggle}
                onSelect={onSelect}
                onSelectNode={onSelectNode}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ─── Trailing-bytes node ───────────────────────────────────────────────────────

function TrailingBytesNode({
  offset,
  count,
  isSelected,
  onSelect,
}: {
  offset: number;
  count: number;
  isSelected: boolean;
  onSelect: () => void;
}): React.ReactElement {
  const hexOffset = `0x${offset.toString(16).toUpperCase().padStart(8, '0')}`;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      aria-label="Unexplained trailing bytes"
      title={`${count} trailing bytes @ ${hexOffset}`}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        paddingLeft: 'var(--space-2)',
        height: 22,
        cursor: 'pointer',
        color: 'var(--color-warn)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        background: isSelected ? 'var(--color-accent-dim)' : undefined,
        borderLeft: isSelected
          ? '2px solid var(--color-accent)'
          : '2px solid transparent',
        transition: 'background 0.1s ease',
      }}
    >
      {/* Accessibility Rule 1: glyph + color + caption */}
      <span aria-hidden="true">▴</span>
      <span>⟨trailing bytes⟩</span>
      <span style={{ color: 'var(--color-text-faint)' }}>
        {count} bytes @ {hexOffset}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function IffStructureTree({
  parseResult,
  filename,
  parseStatus,
  parseError,
  selectedNode,
  onSelectNode,
}: IffStructureTreeProps): React.ReactElement {
  const [expandedSet, setExpandedSet] = useState<Set<IffNode>>(new Set());
  const [selectedNodeLocal, setSelectedNodeLocal] = useState<IffNode | null>(null);
  const [trailingSelected, setTrailingSelected] = useState(false);

  const handleToggle = useCallback((node: IffNode) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(node)) next.delete(node);
      else next.add(node);
      return next;
    });
  }, []);

  const handleSelect = useCallback((node: IffNode) => {
    setSelectedNodeLocal(node);
    setTrailingSelected(false);
  }, []);

  // Expand all top-level FORM nodes when a new parse result arrives
  React.useEffect(() => {
    if (parseResult?.roots) {
      const newExpanded = new Set<IffNode>();
      parseResult.roots.forEach((r) => {
        if (r.kind === 'form') newExpanded.add(r);
      });
      setExpandedSet(newExpanded);
      setSelectedNodeLocal(null);
      setTrailingSelected(false);
    }
  }, [parseResult]);

  // ── Empty state ──
  if (parseStatus === 'idle' || (!filename && parseStatus !== 'done')) {
    return <EmptyState />;
  }

  if (parseStatus === 'parsing' && filename) {
    return <ParsingState filename={filename} />;
  }

  if (parseStatus === 'error' && filename && parseError) {
    return (
      <ErrorState
        filename={filename}
        reason={parseError.reason}
        offset={parseError.offset}
      />
    );
  }

  if (!parseResult) return <EmptyState />;

  const { roots, trailingBytes, roundTrip } = parseResult;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Column header */}
      <ColumnHeader />

      {/* Scrollable tree body */}
      <div
        role="listbox"
        aria-label="IFF structure tree"
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        <TreeBranch
          nodes={roots}
          depth={0}
          expandedSet={expandedSet}
          selectedNode={selectedNode}
          roots={roots}
          onToggle={handleToggle}
          onSelect={handleSelect}
          onSelectNode={onSelectNode}
        />

        {/* Trailing-bytes node — [TOOLKIT] */}
        {trailingBytes && (
          <TrailingBytesNode
            offset={trailingBytes.offset}
            count={trailingBytes.count}
            isSelected={trailingSelected}
            onSelect={() => {
              setTrailingSelected(true);
              setSelectedNodeLocal(null);
              // Select trailing bytes as its own byte range in the HexInspector.
              onSelectNode({
                node: {
                  tag: '    ',
                  length: trailingBytes.count,
                  byteOffset: trailingBytes.offset,
                  kind: 'leaf',
                },
                preorderIndex: -1,
                byteStart: trailingBytes.offset,
                byteEnd: trailingBytes.offset + trailingBytes.count,
              });
            }}
          />
        )}
      </div>

      {/* Footer: trailing-bytes status + round-trip status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-2) var(--space-3)',
          borderTop: '1px solid var(--color-border)',
          background: 'var(--color-header)',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {/* Trailing-bytes status */}
        {!trailingBytes ? (
          <VerificationStatus
            variant="pass"
            caption="0 trailing bytes ✓"
          />
        ) : (
          <VerificationStatus
            variant="warn"
            caption={`${trailingBytes.count} trailing bytes`}
            ariaLabel={`${trailingBytes.count} unexplained trailing bytes present`}
          />
        )}

        {/* Round-trip status — UI-SPEC Copywriting Contract */}
        {roundTrip.passed ? (
          <VerificationStatus variant="pass" caption="byte-exact ✓" />
        ) : (
          <VerificationStatus
            variant="fail"
            caption={
              roundTrip.failOffset != null
                ? `round-trip FAIL @ 0x${roundTrip.failOffset.toString(16).toUpperCase().padStart(4, '0')}`
                : 'round-trip FAIL'
            }
          />
        )}
      </div>
    </div>
  );
}
