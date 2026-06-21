# SWG Client UI Layout Files (.ui)

> Covers: client UI layout files (.ui) — tokenizer, 2D visual editor, reverse serialization. Source: research doc lines 10617–10914.

> **Caveat:** The .ui grammar details below are AI-proposed (Gemini research transcript). Validate all element types, attribute names, and structural conventions against real `.ui` files extracted from `swg-client-v2` `.tre` archives before relying on them. See [source provenance](../00-overview/source-provenance.md).

---

## Overview

SWG stores its UI layouts — character sheet, inventory grids, chat windows, HUD — as `.ui` files inside `.tre` archives. The game engine parses these files into a hierarchical tree of UI elements (Pages, Buttons, Text, DataSources, Images) and binds them using explicit pixel anchor coordinates.

The format resembles XML but is not XML. Elements are opened with tag declarations such as `<Page Name='MainHUD' ...>` and their property/child body is enclosed in `{ ... }` braces rather than closing tags.

The editor pipeline parses this markup into a unified JSON state tree, renders it on a live 2D layout canvas using HTML/CSS absolute positioning, and serializes edits back to valid `.ui` markup for injection into a `.tre` patch archive.

---

## UI Editor Architecture & Data Loop

```
[ Raw .ui Markup File ] ---> [ TS Tokenizer / Parser ] ---> [ Unified UI JSON State Tree ]
                                                                     |
                              +------------------------------+------------------------------+
                              |                                                             |
                              v                                                             v
                [ Interactive 2D Layout Canvas ]                             [ Hierarchical Object Inspector ]
                (HTML/CSS Absolute Grids Sandbox)                            (Modifies Size, Color, Anchors)
                              |                                                             |
                              +------------------------------+------------------------------+
                                                                     |
                                                                     v
[ Patched Client .tre Archive ] <--- [ XML-Like Generator ] <--- [ React State Updates ]
```

---

## Format

### Element Types

Every node in a `.ui` file maps to one of these element types:

| Type | Role |
|------|------|
| `Page` | Container / panel (root and sub-panels) |
| `Button` | Clickable control |
| `Text` | Static label or localization STF hook |
| `Image` | Texture / skin reference |
| `DataSource` | Data binding container (no visual footprint) |
| `Data` | Individual data binding entry (no visual footprint) |

### Markup Structure

Each element declaration is a single tag line followed by a `{` / `}` block containing inline property assignments and nested child element declarations:

```
<Page Name="MainHUD" Size="1024,768">
{
    <Button Name="BtnExit" Size="100,20" Location="10,10">
    {
    }
}
```

Properties can also appear as bare `Key=Value` lines inside the block body, allowing property overrides independent of the opening tag.

---

## TypeScript Type Definitions

```typescript
export type SwgUiElementType = 'Page' | 'Button' | 'Text' | 'Image' | 'DataSource' | 'Data';

export interface SwgUiNode {
  id: string;               // Unique object identifier string (e.g., "ButtonClose")
  type: SwgUiElementType;
  properties: {
    Size?: [number, number];       // Width, Height bounding layout pixels
    Location?: [number, number];   // X, Y coordinate offset boundaries
    Color?: string;                // Hex or RGBA token references
    Text?: string;                 // Display string lines or localization STF hooks
    SourceFile?: string;           // Image texture skin file reference pathways
    [key: string]: any;            // Dynamic custom key-value tracking pairs
  };
  children: SwgUiNode[];
}
```

---

## Tokenizer / Parser Engine

A state-machine line parser handles the non-standard format. It processes three token types: element declaration tags, closing brackets (`}`), and bare property assignments.

```typescript
export class SwgUiParser {
  /**
   * Transforms raw .ui markup text into an object-oriented JSON hierarchy tree
   */
  public parseUiMarkup(rawText: string): SwgUiNode {
    const root: SwgUiNode = { id: 'root', type: 'Page', properties: {}, children: [] };
    const nodeStack: SwgUiNode[] = [root];

    // Clean up carriage returns and split file contents into clean line strings
    const lines = rawText.split(/\r?\n/);

    for (let line of lines) {
      line = line.trim();
      if (line.length === 0 || line.startsWith('#') || line.startsWith('//')) continue;

      // 1. MATCH NEW ELEMENT DECLARATION BLOCK (e.g., <Button Name="BtnExit" Size="100,20">)
      if (line.startsWith('<') && line.endsWith('>')) {
        const cleanTag = line.slice(1, -1);
        const parts = cleanTag.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        const type = parts[0] as SwgUiElementType;

        const properties: any = {};
        let id = `element_${Math.random().toString(36).substr(2, 5)}`;

        // Loop over parsed properties string arrays to unpack assignment values
        for (let i = 1; i < parts.length; i++) {
          const equalsIdx = parts[i].indexOf('=');
          if (equalsIdx !== -1) {
            const key = parts[i].slice(0, equalsIdx).trim();
            let val = parts[i].slice(equalsIdx + 1).trim().replace(/['"]/g, '');

            if (key.toLowerCase() === 'name') id = val;

            // Convert numerical coordinate pairings into real arrays
            if (val.includes(',')) {
              properties[key] = val.split(',').map(Number);
            } else {
              properties[key] = val;
            }
          }
        }

        const newNode: SwgUiNode = { id, type, properties, children: [] };

        // Append the new child to the current active parent container node on the stack
        nodeStack[nodeStack.length - 1].children.push(newNode);
        nodeStack.push(newNode); // Push onto stack as the current target parent
        continue;
      }

      // 2. MATCH STRUCTURAL CONTAINER CLOSING BRACKET
      if (line === '}') {
        if (nodeStack.length > 1) {
          nodeStack.pop(); // Step back out one level to the previous parent container
        }
        continue;
      }

      // 3. MATCH EXPLICIT INNER PROPERTY OVERRIDES (e.g., Size='200,40')
      const equalsIdx = line.indexOf('=');
      if (equalsIdx !== -1 && !line.startsWith('<')) {
        const key = line.slice(0, equalsIdx).trim();
        const val = line.slice(equalsIdx + 1).trim().replace(/['";]/g, '');

        const currentActiveNode = nodeStack[nodeStack.length - 1];
        if (val.includes(',')) {
          currentActiveNode.properties[key] = val.split(',').map(Number);
        } else {
          currentActiveNode.properties[key] = val;
        }
      }
    }

    return root.children[0] || root;
  }
}
```

**Parser notes:**

- Lines starting with `#` or `//` are treated as comments and skipped.
- `Name` attribute on the opening tag becomes the node's `id`.
- Comma-separated numeric values (e.g., `"100,20"`) are parsed into `number[]` arrays automatically.
- `DataSource` and `Data` nodes are parsed into the tree but carry no visual geometry.

---

## 2D Editor Canvas (React)

The parsed tree is rendered recursively using absolute CSS positioning. Each node becomes a `<div>` whose `width`, `height`, `left`, and `top` are driven directly from the `Size` and `Location` properties. Clicking a node fires `onSelectNode` to populate the inspector panel.

`DataSource` and `Data` nodes have no visual footprint and are passed through transparently.

```tsx
import React from 'react';
import { SwgUiNode } from './UiModel';

interface CanvasProps {
  currentNode: SwgUiNode;
  selectedId: string | null;
  onSelectNode: (id: string, properties: any) => void;
}

export const SwgUiSandboxCanvas: React.FC<CanvasProps> = ({ currentNode, selectedId, onSelectNode }) => {
  const { Size, Location, Color, Text } = currentNode.properties;

  // Extract pixel bounding rules safely from coordinate state arrays
  const width = Size ? `${Size[0]}px` : '100%';
  const height = Size ? `${Size[1]}px` : '100%';
  const left = Location ? `${Location[0]}px` : '0px';
  const top = Location ? `${Location[1]}px` : '0px';

  const isSelected = selectedId === currentNode.id;

  // Render elements recursively matching nesting definitions
  const renderChildElements = () => {
    return currentNode.children.map((child) => (
      <SwgUiSandboxCanvas
        key={child.id}
        currentNode={child}
        selectedId={selectedId}
        onSelectNode={onSelectNode}
      />
    ));
  };

  // Skip processing container elements like data sources that have no visual footprint
  if (currentNode.type === 'DataSource' || currentNode.type === 'Data') {
    return <>{renderChildElements()}</>;
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelectNode(currentNode.id, currentNode.properties); }}
      style={{
        position: 'absolute',
        width, height, left, top,
        boxSizing: 'border-box',
        border: isSelected ? '1px solid #ff0055' : '1px dashed rgba(0, 255, 204, 0.25)',
        backgroundColor: Color ? Color : 'rgba(255, 255, 255, 0.02)',
        color: '#fff',
        fontSize: '11px',
        padding: '2px',
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      {/* Label overlays display if the node handles static text values */}
      {Text && <span style={{ pointerEvents: 'none' }}>{Text}</span>}
      {renderChildElements()}
    </div>
  );
};
```

---

## Reverse Serialization Compiler

When edits are complete, the compiler walks the JSON tree and emits correctly indented `.ui` markup. Tab depth increases by one for each level of nesting. Array properties (e.g., `Size`, `Location`) are rejoined as comma-separated strings.

```typescript
export class SwgUiCompiler {
  /**
   * Compiles JSON structural trees back into valid SWG client layout markup text strings
   */
  public compileUiTree(node: SwgUiNode, depth = 0): string {
    const indent = '\t'.repeat(depth);

    // 1. Build open declaration tag parameters
    let attributes = `Name="${node.id}"`;
    for (const [key, value] of Object.entries(node.properties)) {
      if (key.toLowerCase() === 'name') continue;
      const formattedValue = Array.isArray(value) ? value.join(',') : value;
      attributes += ` ${key}="${formattedValue}"`;
    }

    let output = `${indent}<${node.type} ${attributes}>\n`;
    output += `${indent}{\n`;

    // 2. RECURSIVE STEP: Pack deeper children branches sequentially
    for (const child of node.children) {
      output += this.compileUiTree(child, depth + 1);
    }

    output += `${indent}}\n`;
    return output;
  }
}
```

---

## Complete Workspace Layout

The dashboard bundles parser, canvas, and compiler into a single two-column panel. The left column renders the live canvas sandbox; the right column hosts the element inspector with sizing sliders and the export button that writes the compiled markup to disk via the Electron filesystem backend.

```tsx
import React, { useState } from 'react';
import { SwgUiNode } from './UiModel';
import { SwgUiSandboxCanvas } from './SwgUiSandboxCanvas';
import { SwgUiCompiler } from './SwgUiCompiler';

export const SwgUiEditorDashboard: React.FC<{ rawFileContent: string }> = ({ rawFileContent }) => {
  const parser = useMemo(() => new SwgUiParser(), []);
  const compiler = useMemo(() => new SwgUiCompiler(), []);

  const [uiStateTree, setUiStateTree] = useState<SwgUiNode>(() => parser.parseUiMarkup(rawFileContent));
  const [selectedElement, setSelectedElement] = useState<{ id: string; props: any } | null>(null);

  const handleUpdateElementSize = (newWidth: number, newHeight: number) => {
    if (!selectedElement) return;

    // Deep copy your active state tree to modify parameters cleanly
    const treeCopy = JSON.parse(JSON.stringify(uiStateTree));

    // Find and update the target node within the tree...
    // modifyNodeInTree(treeCopy, selectedElement.id, { Size: [newWidth, newHeight] });

    setUiStateTree(treeCopy);
    setSelectedElement({ id: selectedElement.id, props: { ...selectedElement.props, Size: [newWidth, newHeight] } });
  };

  const handleExportUiFile = async () => {
    const finalMarkup = compiler.compileUiTree(uiStateTree);
    const textBytes = new TextEncoder().encode(finalMarkup);
    // Write the raw bytes down to disk via your app filesystem backend API
    await window.api.saveFileToDisk("ui/ui_custom_hud.ui", textBytes);
    alert("Successfully compiled UI modifications into a valid client markup asset patch!");
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', height: '100vh', background: '#0a0a0c' }}>

      {/* Center Display: Live HTML Absolute Positions Simulation Grid Panel Sandbox */}
      <div style={{ position: 'relative', overflow: 'auto', background: '#111216', margin: '20px', borderRadius: '4px', border: '1px solid #222' }}>
        <SwgUiSandboxCanvas
          currentNode={uiStateTree}
          selectedId={selectedElement?.id || null}
          onSelectNode={(id, props) => setSelectedElement({ id, props })}
        />
      </div>

      {/* Right Sidebar: Element inspector controls and coordinate adjustment sliders */}
      <div style={{ background: '#1a1a1f', borderLeft: '1px solid #2d2d35', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', color: '#fff' }}>
        <h4 style={{ color: '#00ffcc', margin: 0, fontFamily: 'monospace' }}>HUD Layout Matrix Inspector</h4>

        {selectedElement ? (
          <div style={{ display: 'grid', gap: '10px', fontSize: '12px', fontFamily: 'monospace' }}>
            <div>Selected Node: <span style={{ color: '#ff0055' }}>{selectedElement.id}</span></div>
            {selectedElement.props.Size && (
              <label>
                Width Boundary Sizing ({selectedElement.props.Size[0]}px):
                <input
                  type="range" min="10" max="1200" value={selectedElement.props.Size[0]}
                  onChange={(e) => handleUpdateElementSize(parseInt(e.target.value), selectedElement.props.Size[1])}
                  style={{ width: '100%', accentColor: '#00ffcc' }}
                />
              </label>
            )}
          </div>
        ) : (
          <div style={{ color: '#555', fontSize: '12px', fontStyle: 'italic' }}>Select an element on canvas to inspect properties.</div>
        )}

        <button
          onClick={handleExportUiFile}
          style={{ marginTop: 'auto', background: '#00ffcc', color: '#111', fontWeight: 'bold', padding: '10px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Save Layout File (.UI)
        </button>
      </div>
    </div>
  );
};
```

### Implementation notes

- `modifyNodeInTree` (commented out in the stub) needs to be implemented as a recursive tree walk that finds the node by `id` and merges the property patch. The deep-copy pattern (`JSON.parse(JSON.stringify(...))`) ensures React state immutability.
- `window.api.saveFileToDisk` is an Electron `contextBridge` call. Wire it to the IPC handler that writes bytes to the filesystem and optionally re-packs the `.tre` archive.
- The inspector sidebar currently exposes only the width slider. Add a matching height slider and `Location` coordinate inputs using the same `handleUpdateElementSize` pattern.
- `DataSource` / `Data` nodes are invisible on the canvas but remain in the tree and are round-tripped correctly through the compiler.
