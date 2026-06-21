# Workspace Layout

> Covers: main workspace layout, dark theme, CSS Grid, Golden Layout docking, advanced studio modules catalog. Source: research doc lines 11586–11643, 12384–12896.

> **Caveat:** This is a proposed UI design to be refined during implementation. See [source provenance](../00-overview/source-provenance.md) for context on the AI-generated research this document is drawn from.

---

## Table of Contents

1. [Global Screen Layout Blueprint](#1-global-screen-layout-blueprint)
2. [Region-by-Region Deep Dive](#2-region-by-region-deep-dive)
   - [Left Sidebar Dock](#21-left-sidebar-dock-asset-extraction--project-management)
   - [Upper-Center Canvas: Three.js Viewport](#22-upper-center-canvas-threejs-viewport)
   - [Lower-Center Pane: Dynamic Data Spreadsheets & Timelines](#23-lower-center-pane-dynamic-data-spreadsheets--timelines)
   - [Right Sidebar: Contextual Inspector & Client Controller](#24-right-sidebar-contextual-inspector--client-controller)
3. [Dark Theme & Styling Guidelines](#3-dark-theme--styling-guidelines)
4. [CSS Grid Base Layout](#4-css-grid-base-layout)
   - [Installing Required Monospace Styles](#41-installing-required-monospace-styles)
   - [Unified CSS Grid Layout Matrix Component](#42-unified-css-grid-layout-matrix-component)
   - [Layout Wins](#43-layout-wins)
5. [Golden Layout Docking](#5-golden-layout-docking)
   - [Installing Dependencies](#51-installing-golden-layout-dependencies)
   - [Layout Configuration Blueprints](#52-layout-configuration-blueprints)
   - [Persistent Portal Docker Component](#53-persistent-portal-docker-component)
   - [Wrapping the Unified Workspace Core](#54-wrapping-the-unified-workspace-core)
   - [Strategic Wins](#55-strategic-wins)
6. [Advanced Studio Modules Catalog](#6-advanced-studio-modules-catalog)
   - [Studio Architecture Growth Map](#studio-architecture-growth-map)

---

## 1. Global Screen Layout Blueprint

The UI must look and feel like a modern game engine (Unreal Engine, Unity, Blender) rather than a simple web page. It must balance high-density information with absolute performance, particularly when streaming real-time metrics and WebGL canvas operations concurrently.

Built on a React / Electron / Vite stack, the layout is achieved with modern desktop UI frameworks: **Allotment** for performance-optimized smooth window-resizing dividers, or **React-Mosaic / Golden Layout** when modders need drag, drop, and detach-to-monitor tab behavior.

```
+---------------------------------------------------------------------------------------------------+
| GLOBAL WORKSPACE MENU BAR (File, Edit, Assets, Live Connection, Sync, Build, Help)               |
+---------------------------------------------------------------------------------------------------+
| SIDEBAR DOCK      | MAIN WORKSPACE AREA                                    | PROPERTIES          |
| (15% Width)       | (65% Width)                                            | (20% Width)         |
|                   |                                                        |                     |
| [X] TRE ARCHIVE   | +------------------------------------------------------+ | [Contextual        |
|     EXPLORER      | | THREE.JS VIEWPORT CANVAS (3D Sandbox Preview Grid)   | |  Inspector]        |
|   - appearance/   | |                                                      | |                    |
|     terrain/      | |  [3D Cam] [Render: Lit] [Snapping: On]               | | - Name / ID        |
|     tatooine.trn  | |              [Utinni: Connected]                     | | - XYZ Vectors      |
|   - datatables/   | |                                                      | | - Colors           |
|     weapon.iff    | |  (Terrain, Multi-Part Skeletons, FX Particles, etc.) | | - Matrix Data      |
|                   | +------------------------------------------------------+ | - Linkages         |
| [ ] SERVERSYNC    | | DYNAMIC CONSOLE / TIMELINE AREA                      | |                    |
| [ ] PROJECTGIT    | |  (Tabs: .STF Spreadsheet / .EFT Sequencer / Sniffer) | | [Live Client       |
| [ ] SNAPSHOTS     | |                                                      | |  Controller]       |
|                   | |  [0.0s]===♦======♦=============== [1.5s]             | | - Memory Addr      |
|                   | +------------------------------------------------------+ | - Patch Status     |
+---------------------------------------------------------------------------------------------------+
| APPLICATION FOOTER STATUS BAR (Active Project | V8 Memory Heap | FPS Counter | Live Client PID)  |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Region-by-Region Deep Dive

### 2.1 Left Sidebar Dock: Asset Extraction & Project Management

This pane handles file ingestion via an accordion or tab system managed by a modern layout dock.

**TRE Explorer Tab**
A lightning-fast, virtualized file tree explorer that reflects the native SWG directory tree parsed by the C++ core. Clicking a file extracts and opens it instantly:
- Double-clicking a `.trn` map deforms the 3D canvas.
- Double-clicking a `.iff` table opens a spreadsheet in the lower pane.
- Double-clicking a `.snd` audio node spins up the mixer properties in the inspector.

**Version Control & Sync Tab**
Groups automated Git/LFS push controls, Core3 Linux cross-parity server path mappings, and local snapshot recovery checkpoint timelines.

---

### 2.2 Upper-Center Canvas: Three.js Viewport

The centerpiece of the software. Built with React Three Fiber, it functions as the primary 3D visualizer sandbox.

**UI Overlays**
Uses HTML elements styled `position: absolute` above the WebGL layer (via `@react-three/drei`) to render context-sensitive widgets: camera angle widgets, viewport toggle buttons (Lit, Wireframe, Collision Mesh), and a green/red "Utinni Connection Status Indicator" showing whether memory injection loops are actively hooked into `SWGClient.exe`.

**Gizmo Integration**
Attaches `TransformControls` and custom procedural brush rings to let modders paint trees, drag building structures, or stretch lightsaber paths naturally.

---

### 2.3 Lower-Center Pane: Dynamic Data Spreadsheets & Timelines

This panel dynamically changes content depending on what asset type the modder selects from the left TRE tree. It uses a tabbed panel layout:

| Mode | Trigger | Contents |
|---|---|---|
| **Ecosystem Mode** | `.EFT` / `.ANS` selected | Multi-track timeline sequencer grid HUD — scrub time marker, view animation frames, drag particle emitter keyframes |
| **Database Mode** | `.IFF` / `.STF` selected | Virtualized spreadsheet matrix grid (`react-window`) — raw database cell allocations or translation string lines as filterable, editable data tables |
| **Live Injector Mode** | Packet sniffer active | Active network packet sniffer terminal console streaming live outbound/inbound server opcodes with ASCII data dumps |

---

### 2.4 Right Sidebar: Contextual Inspector & Client Controller

This pane handles data inputs with modifier fields that update based on what entity is selected inside the center canvas.

**Spatial Properties Matrix**
Exposes precise numeric inputs for XYZ positions, Euler rotation angles, scales, and bounding radius extents for fine-tuning assets.

**Ecosystem Controls**
Hosts color wheels for tuning lightsaber Adegan crystals (`.lsb`), material dropdown selections for linking foliage families to sand or grass channels, and sliders to adjust terrain fractal noise amplitudes (`.frac`).

**Live Process Attachment Tool**
Features text input fields to search for `SWGClient.exe` process IDs (PIDs), track running pointer memory addresses, and deploy C++ `WriteProcessMemory` injection vectors.

---

## 3. Dark Theme & Styling Guidelines

Enforce a cohesive Nordic/Carbon Dark Theme throughout all React component stylesheets to keep the UI clean, uniform, and readable across long development sessions.

### Color Palette

| Role | Color | Hex |
|---|---|---|
| Primary Backgrounds | Deep Charcoal | `#121214` – `#16161a` |
| Secondary Panels | Mid-Gray | `#1e1e24` – `#25252b` |
| Accent: Success / Sync | Neon Cyan | `#00ffcc` |
| Accent: Destructive / Push | Hot Fuchsia | `#ff0055` |
| Accent: Warnings / Spawn Regions | Golden Amber | `#ffcc00` |

### Typography

Enforce standard monospace font pairings — **JetBrains Mono**, **Fira Code**, or **SF Mono** — at a crisp small scale (`11px` to `12px`). This ensures data tables, hex opcodes, and matrix coordinates align perfectly across all screen fields.

---

## 4. CSS Grid Base Layout

### 4.1 Installing Required Monospace Styles

Add the following to `src/index.css` to import an optimized development font and enforce the base body styles:

```css
@import url('https://fonts.googleapis.com/css2?family=Fira+Code&display=swap');

body {
  margin: 0;
  padding: 0;
  background-color: #0c0c0e;
  font-family: 'Fira Code', monospace;
  overflow: hidden;
  color: #e0e0e0;
}
```

### 4.2 Unified CSS Grid Layout Matrix Component

This core layout container partitions the interface into distinct sections: a static menu strip, an interactive 3D WebGL viewport canvas, an adjustable left data tree explorer, an inline lower spreadsheet/timeline panel, and an inline right property panel.

```tsx
import React, { useState } from 'react';

export const SwgStudioMainWorkspace: React.FC = () => {
  // Manage responsive panel scaling weights natively inside layout state
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [timelineHeight, setTimelineHeight] = useState(250);

  const [activeTab, setActiveTab] = useState<'explorer' | 'sync'>('explorer');
  const [isUtinniConnected, setIsUtinniConnected] = useState(true);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: '32px 1fr 24px',
        gridTemplateColumns: `${sidebarWidth}px 1fr ${inspectorWidth}px`,
        height: '100vh',
        width: '100vw',
        background: '#0c0c0e',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* 1. GLOBAL WORKSPACE MENU BAR */}
      <header
        style={{
          gridColumn: '1 / -1',
          background: '#121214',
          borderBottom: '1px solid #1e1e24',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: '16px',
          fontSize: '11px',
          fontWeight: 500
        }}
      >
        <span style={{ color: '#00ffcc', fontWeight: 'bold', letterSpacing: '0.5px' }}>
          SWG_STUDIO
        </span>
        {['File', 'Edit', 'Assets', 'Live Sync', 'Build', 'Help'].map((item) => (
          <span
            key={item}
            style={{ color: '#aaa', cursor: 'pointer', transition: 'color 0.1s' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#aaa')}
          >
            {item}
          </span>
        ))}
      </header>

      {/* 2. THE LEFT SIDEBAR DOCK (TRE Explorer / Projects Core) */}
      <aside
        style={{
          background: '#16161a',
          borderRight: '1px solid #1e1e24',
          display: 'flex',
          flexDirection: 'column',
          fontSize: '11px'
        }}
      >
        {/* Tab Headers */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e1e24', background: '#121214' }}>
          <button
            onClick={() => setActiveTab('explorer')}
            style={{
              flex: 1,
              padding: '8px',
              background: activeTab === 'explorer' ? '#16161a' : 'transparent',
              color: activeTab === 'explorer' ? '#00ffcc' : '#666',
              border: 'none',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            TRE EXPLORER
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            style={{
              flex: 1,
              padding: '8px',
              background: activeTab === 'sync' ? '#16161a' : 'transparent',
              color: activeTab === 'sync' ? '#ff0055' : '#666',
              border: 'none',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            SYNC / VCS
          </button>
        </div>

        {/* Dynamic Inner Panel */}
        <div
          style={{
            flex: 1,
            padding: '10px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          {activeTab === 'explorer' ? (
            <>
              <div style={{ color: '#666', fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>
                PROJECT ARCHIVES:
              </div>
              <div style={{ color: '#00ffcc', paddingLeft: '4px', cursor: 'pointer' }}>appearance/</div>
              <div style={{ color: '#aaa', paddingLeft: '16px', cursor: 'pointer' }}>terrain/</div>
              <div style={{ color: '#eee', paddingLeft: '28px', cursor: 'pointer' }}>tatooine.trn</div>
              <div style={{ color: '#00ffcc', paddingLeft: '4px', cursor: 'pointer', marginTop: '4px' }}>
                datatables/
              </div>
              <div style={{ color: '#eee', paddingLeft: '16px', cursor: 'pointer' }}>
                weapon_metrics.iff
              </div>
            </>
          ) : (
            <div style={{ color: '#888', fontStyle: 'italic' }}>
              Git / Parity Sync Controls Contextual View...
            </div>
          )}
        </div>
      </aside>

      {/* 3. CENTER WORKSPACE SPLIT (Three.js WebGL + lower Timeline Console) */}
      <main
        style={{
          display: 'grid',
          gridTemplateRows: `1fr ${timelineHeight}px`,
          background: '#111216',
          height: '100%',
          overflow: 'hidden'
        }}
      >
        {/* UPPER CELL: THREE.JS VIEWPORT */}
        <section style={{ position: 'relative', background: '#111216', overflow: 'hidden' }}>
          {/* Floating Viewport Overlays */}
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              zIndex: 10,
              display: 'flex',
              gap: '8px'
            }}
          >
            <div
              style={{
                background: 'rgba(18, 18, 20, 0.85)',
                backdropFilter: 'blur(4px)',
                padding: '4px 8px',
                borderRadius: '3px',
                border: '1px solid #1e1e24',
                fontSize: '10px',
                fontWeight: 'bold',
                color: '#00ffcc'
              }}
            >
              PERSPECTIVE_CAM
            </div>
            <div
              style={{
                background: 'rgba(18, 18, 20, 0.85)',
                backdropFilter: 'blur(4px)',
                padding: '4px 8px',
                borderRadius: '3px',
                border: '1px solid #1e1e24',
                fontSize: '10px',
                fontWeight: 'bold',
                color: '#aaa',
                cursor: 'pointer'
              }}
            >
              RENDER: LIT
            </div>
          </div>

          <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10 }}>
            <div
              style={{
                background: 'rgba(18, 18, 20, 0.85)',
                backdropFilter: 'blur(4px)',
                padding: '4px 8px',
                borderRadius: '3px',
                border: `1px solid ${isUtinniConnected ? '#00ffcc' : '#ff0055'}`,
                fontSize: '10px',
                fontWeight: 'bold',
                color: isUtinniConnected ? '#00ffcc' : '#ff0055'
              }}
            >
              {isUtinniConnected
                ? 'UTINNI: INJECTING LIVE MEMORY'
                : 'UTINNI: CLIENT DISCONNECTED'}
            </div>
          </div>

          {/* Placeholder for React Three Fiber <Canvas> */}
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#444',
              fontSize: '12px'
            }}
          >
            [ WebGL Render Viewport Core Sandbox Layer ]
          </div>
        </section>

        {/* LOWER CELL: DYNAMIC SPREADSHEETS / TIMELINE / TERMINALS */}
        <section
          style={{
            background: '#141416',
            borderTop: '1px solid #1e1e24',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div
            style={{
              display: 'flex',
              background: '#121214',
              borderBottom: '1px solid #1e1e24',
              fontSize: '11px'
            }}
          >
            {['.EFT Sequencer Timeline', '.STF String Editor', 'Datatable Sheet Grid', 'Packet Sniffer Console'].map(
              (tab, idx) => (
                <div
                  key={tab}
                  style={{
                    padding: '6px 12px',
                    background: idx === 0 ? '#141416' : 'transparent',
                    borderRight: '1px solid #1e1e24',
                    color: idx === 0 ? '#ff0055' : '#666',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  {tab}
                </div>
              )
            )}
          </div>
          <div
            style={{ flex: 1, padding: '12px', overflow: 'auto', color: '#666', fontSize: '11px' }}
          >
            [ Contextual Track Inspector / Spreadsheet Framework Layer Content Frame ]
          </div>
        </section>
      </main>

      {/* 4. RIGHT PROPERTIES INSPECTOR */}
      <aside
        style={{
          background: '#1a1a1f',
          borderLeft: '1px solid #2d2d35',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          fontSize: '11px'
        }}
      >
        <h3
          style={{
            color: '#00ffcc',
            margin: '0 0 4px 0',
            fontSize: '12px',
            fontWeight: 'bold',
            borderBottom: '1px solid #2d2d35',
            paddingBottom: '6px'
          }}
        >
          ATTRIBUTES INSPECTOR
        </h3>

        {/* Parameter Input Fields */}
        <div style={{ display: 'grid', gap: '10px' }}>
          <div>
            <div style={{ color: '#888', fontSize: '10px', marginBottom: '2px' }}>Selected Target ID:</div>
            <div style={{ color: '#fff', fontWeight: 'bold' }}>
              object/static/flora/tree/shared_tree_tatooine_01.iff
            </div>
          </div>

          <div>
            <div style={{ color: '#888', fontSize: '10px', marginBottom: '4px' }}>
              Spatial Position Transform Vectors:
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}
            >
              {['X', 'Y', 'Z'].map((axis, i) => (
                <div
                  key={axis}
                  style={{
                    display: 'flex',
                    background: '#111',
                    borderRadius: '2px',
                    border: '1px solid #333',
                    padding: '3px'
                  }}
                >
                  <span style={{ color: '#ff0055', fontWeight: 'bold', paddingRight: '4px' }}>
                    {axis}:
                  </span>
                  <input
                    type="text"
                    defaultValue={i === 0 ? '45.12' : i === 1 ? '12.45' : '-120.67'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#fff',
                      width: '100%',
                      fontSize: '11px',
                      padding: 0,
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* 5. APPLICATION FOOTER STATUS BAR */}
      <footer
        style={{
          gridColumn: '1 / -1',
          background: '#121214',
          borderTop: '1px solid #1e1e24',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: '10px',
          color: '#666',
          fontWeight: 500
        }}
      >
        <div>
          WORKSPACE: <span style={{ color: '#aaa' }}>C:/SWG_Mod_Dev/Project_Tatooine/</span>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div>
            V8 HEAP: <span style={{ color: '#00ffcc' }}>42.1 MB</span>
          </div>
          <div>
            VIEWPORT FPS: <span style={{ color: '#ffcc00' }}>60.0 FPS</span>
          </div>
          <div>
            TARGET CLIENT PID: <span style={{ color: '#00ffcc' }}>14812</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
```

### 4.3 Layout Wins

- **Strict Boundary Grid Anchoring:** Using CSS Grid prevents panel layout shifting or collapsing when dynamic, heavy WebGL frames render inside the center container.
- **Pixel-Accurate Proportions:** Spacing columns and dimensions via exact pixel values gives text tables and hex matrix numbers perfect alignment, mirroring native desktop application environments.
- **Component-Ready Modularization:** Each block can be isolated into standalone files (e.g. `<TreExplorerSidebar />`, `<ThreejsCanvasViewport />`, `<DataTimelineHUD />`), making the codebase scalable as the platform grows.

---

## 5. Golden Layout Docking

A static layout is insufficient for power users. Modders need to drag tabs, split views, and tear panels to floating windows across multi-monitor setups. **Golden Layout v2+** is the gold standard for web-based engine interfaces.

**Critical trap when combining Golden Layout with React and Three.js:** When a user drags and docks a panel, Golden Layout completely tears down and remounts the underlying DOM tree. Without mitigation, every drag reboots the WebGL context — dropping the entire Three.js terrain cache or clearing running memory injection state.

The solution is a **Virtual Portal Registry** using React hooks and Golden Layout. This keeps data-view components persistent in memory inside a hidden root cluster while their visuals are mirrored into Golden Layout containers via React Portals.

### 5.1 Installing Golden Layout Dependencies

```bash
npm install golden-layout
```

Add the base dark skins to `src/index.css`, then override to match the Nordic Carbon Dark aesthetic:

```css
@import "golden-layout/dist/css/goldenlayout-base.css";
@import "golden-layout/dist/css/themes/goldenlayout-dark-theme.css";

/* Override to conform with Nordic Carbon Dark aesthetic */
.lm_root {
  background: #0c0c0e !important;
}
.lm_header {
  background: #121214 !important;
}
.lm_tab {
  background: #16161a !important;
  color: #666 !important;
  font-family: monospace;
  font-size: 11px;
  font-weight: bold;
}
.lm_tab.lm_active {
  background: #1a1a1f !important;
  color: #00ffcc !important;
  border-bottom: 2px solid #00ffcc !important;
}
```

### 5.2 Layout Configuration Blueprints

Create the initial window docking layout configuration that structures the workspace views upon tool startup.

```typescript
import { LayoutConfig } from 'golden-layout';

export const INITIAL_SWG_WORKSPACE_CONFIG: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'component',
        componentType: 'TreExplorer',
        componentState: { label: 'Archive Assets Tree' },
        title: 'TRE EXPLORER',
        width: 15
      },
      {
        type: 'column',
        width: 65,
        content: [
          {
            type: 'component',
            componentType: 'ThreejsViewport',
            componentState: { renderMode: 'lit' },
            title: '3D VIEWPORT CANVAS'
          },
          {
            type: 'component',
            componentType: 'TimelineConsole',
            componentState: { activeTab: 'timeline' },
            title: 'SEQUENCER TIMELINE / DATA SHEETS',
            height: 35
          }
        ]
      },
      {
        type: 'component',
        componentType: 'AttributesInspector',
        componentState: { targetNode: 'root' },
        title: 'ATTRIBUTES INSPECTOR',
        width: 20
      }
    ]
  }
};
```

### 5.3 Persistent Portal Docker Component

This specialized manager orchestrates Golden Layout initialization, hooks window resize operations, captures panel mount elements, and uses `ReactDOM.createPortal` to inject persistent views into shifting DOM nodes.

```tsx
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { GoldenLayout, ComponentContainer } from 'golden-layout';
import { INITIAL_SWG_WORKSPACE_CONFIG } from './WorkspaceLayoutConfig';

interface PortalBinding {
  componentId: string;
  renderElement: React.ReactNode;
}

export const SwgDockingWorkspaceManager: React.FC<{
  explorerView: React.ReactNode;
  viewportView: React.ReactNode;
  timelineView: React.ReactNode;
  inspectorView: React.ReactNode;
}> = ({ explorerView, viewportView, timelineView, inspectorView }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<GoldenLayout | null>(null);

  // Maps active components currently tracking layout dock anchors
  const [portals, setPortals] = useState<Map<HTMLElement, React.ReactNode>>(new Map());

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Initialize Golden Layout Core Engine
    const layout = new GoldenLayout(containerRef.current);
    glRef.current = layout;

    // 2. Multi-Component Registration Loop
    const registerComponentProxy = (componentType: string, reactView: React.ReactNode) => {
      layout.registerComponentFactory(componentType, (container: ComponentContainer) => {
        const element = container.element;

        // Push the target DOM element into state so React Portals can target it
        setPortals((prev) => {
          const next = new Map(prev);
          next.set(element, reactView);
          return next;
        });

        // Listen for panel closure to drop memory hooks safely
        container.on('destroy', () => {
          setPortals((prev) => {
            const next = new Map(prev);
            next.delete(element);
            return next;
          });
        });
      });
    };

    // Bind component nodes to factories
    registerComponentProxy('TreExplorer', explorerView);
    registerComponentProxy('ThreejsViewport', viewportView);
    registerComponentProxy('TimelineConsole', timelineView);
    registerComponentProxy('AttributesInspector', inspectorView);

    // 3. Load the initial workspace blueprint configuration
    layout.loadLayout(INITIAL_SWG_WORKSPACE_CONFIG);

    // 4. Handle Window Resize Events (forces Three.js to recalculate resolution ratios)
    const resizeObserver = new ResizeObserver(() => {
      layout.updateSize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      layout.destroy();
    };
  }, [explorerView, viewportView, timelineView, inspectorView]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Surface element where Golden Layout builds window frames */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Render active portals into shifting DOM nodes */}
      {Array.from(portals.entries()).map(([domElement, reactComponent], index) =>
        ReactDOM.createPortal(
          <div
            style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#111216' }}
          >
            {reactComponent}
          </div>,
          domElement,
          `gl_portal_${index}`
        )
      )}
    </div>
  );
};
```

### 5.4 Wrapping the Unified Workspace Core

Use the manager component inside the top-level layout wrapper to connect state frameworks to a flexible, dockable studio environment.

```tsx
import React from 'react';
import { SwgDockingWorkspaceManager } from './SwgDockingWorkspaceManager';

export const SwgStudioAppWorkspace: React.FC = () => {
  // These views remain persistently instantiated in the memory heap:
  const explorer = (
    <div style={{ padding: '10px', fontSize: '12px', color: '#00ffcc' }}>
      Native File Tree Directory...
    </div>
  );
  const viewport = (
    <div
      style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#444' }}
    >
      [ WebGL Canvas Context ]
    </div>
  );
  const timeline = (
    <div style={{ padding: '10px', fontSize: '11px', color: '#ff0055' }}>
      Multi-Track Keyframe Timeline HUD...
    </div>
  );
  const inspector = (
    <div style={{ padding: '10px', fontSize: '12px', color: '#aaa' }}>
      Spatial Transform Values...
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: '#0c0c0e',
        overflow: 'hidden'
      }}
    >
      {/* Main Docking Layout Canvas Body */}
      <div style={{ flex: 1, position: 'relative' }}>
        <SwgDockingWorkspaceManager
          explorerView={explorer}
          viewportView={viewport}
          timelineView={timeline}
          inspectorView={inspector}
        />
      </div>

      {/* Global Application Diagnostics Footer */}
      <footer
        style={{
          height: '24px',
          background: '#121214',
          borderTop: '1px solid #1e1e24',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontSize: '10px',
          color: '#555'
        }}
      >
        <div>
          PROJECT CHANNEL: <span style={{ color: '#aaa' }}>TATOOINE_REMASTER</span>
        </div>
        <div>
          V8 ENGINE PROCESS ALLOCATION: <span style={{ color: '#00ffcc' }}>38.4 MB</span>
        </div>
      </footer>
    </div>
  );
};
```

### 5.5 Strategic Wins

- **Zero-Copy Canvas Preservation:** Because `SwgDockingWorkspaceManager` encapsulates components via `ReactDOM.createPortal`, dragging windows does not re-instantiate data classes. Three.js geometries, texture maps, and active packet interceptors remain persistent in memory throughout all panel docking adjustments.
- **Pro-Tier Custom Layouts:** Modders gain the ergonomic freedom expected of production software. Level designers can isolate and maximize the 3D canvas on a primary display while pushing data tables, string lists, or packet terminals to secondary monitors.

---

## 6. Advanced Studio Modules Catalog

To elevate the platform from a geometry compiler to a world-class All-In-One SWG Development Studio, five high-utility system modules address the remaining manual bottlenecks in the legacy SWG modding workflow.

---

### Module 1: Visual Scripting Shader / Material Editor (`.msh` Material Modder)

**Detail doc:** [Shaders and FX](../03-rendering/shaders-and-fx.md)

SWG models rely on custom Shader Templates (`.sht`) to handle texture layers, scrolling water maps, environment reflections, and transparency indices.

- **The Tool:** A 2D node-based visual shader editor (similar to Unreal Engine's Material Graph or Unity's Shader Graph) built directly into the React dashboard using libraries like `reactflow`.
- **The Value:** Modders can connect visual nodes to create advanced shaders — adding a shimmering force-field overlay or scrolling lava texture to a building — and the C++ backend automatically serializes the graph back into little-endian binary `.sht` templates.

---

### Module 2: Live Memory Inspector & Packet Analyzer (Advanced Utinni Core)

**Detail doc:** [Live Memory and IPC](../04-live-sync/live-memory-and-ipc.md)

Instead of just patching structural object transforms via `WriteProcessMemory`, the Node-API C++ layer expands to hook into the running `SWGClient.exe` graphics and network registers.

- **The Tool:** A live debugger panel that captures client runtime metrics, lists currently loaded textures on the GPU, and hooks the game's WinSock loops to display network game packets in an interactive terminal list.
- **The Value:** Modders can instantly debug server-to-client custom object transmissions, profile rendering memory leaks, and isolate exactly which asset configuration causes a game crash during development.

---

### Module 3: Procedural City Layout Planner (`.ws` Region Blueprint Painter)

**Detail doc:** [World Snapshots](../02-formats/world-snapshots.md)

Placing cities or outposts structure-by-structure inside a `.ws` snapshot template is tedious — hundreds of streetlamps, wall boundaries, and paving tiles positioned one by one.

- **The Tool:** A 3D "Brush Prefab Painter" that treats a collection of snapshot objects as a single layout brush (e.g., a "Corellia Street Block" prefab consisting of roads, sidewalks, trash cans, and lamps).
- **The Value:** Level designers can select a custom layout blueprint and paint whole streets or military outposts across procedural terrain in real time, with the tool handling individual object height-snapping automatically.

---

### Module 4: Dynamic FX / Particle Sequencer Timeline Tool (`.eft` Track Master)

**Detail doc:** [Audio and Effects](../02-formats/audio-and-effects.md)

Special effect blueprints (`.eft`) layer particle assets (`.prt`) alongside sound clips (`.snd`) and lighting spikes over a time chart.

- **The Tool:** An interactive multi-track timeline panel (similar to Adobe After Effects or Premiere Pro) placed directly below the Three.js canvas viewport.
- **The Value:** Visual effects artists can drag keyframes to sequence complex events — timing a custom heavy weapon fire animation to flash a light aura, spawn plasma sparks, and play an explosive discharge wave file precisely down to the millisecond.

---

### Module 5: Automation Template Packaging Studio (`.tre` Mod Distribution Wizard)

**Detail doc:** [Packaging and Distribution](../06-workflow/packaging-and-distribution.md)

Once a mod is complete, distributing it requires packaging files correctly into a client `.tre` file and guiding users through `.cfg` setup updates.

- **The Tool:** An automated, one-click Mod Distribution Wizard built into the Electron layout.
- **The Value:** Instead of just packaging local files, this studio bundles final mod assets into an optimized `.tre` file, signs it with a version tag, generates a tiny automated installation wrapper payload for players, and auto-publishes the release directly to GitHub or a community server CDN.

---

### Studio Architecture Growth Map

```
              [ Central Modding Workspace Hub ]
                              │
     ┌──────────────────────────┼──────────────────────────┐
     ▼                          ▼                          ▼
[ 3D World Studio ]       [ 2D Scripting Hub ]       [ Live Debugger Studio ]
• Terrain Painting        • Shader Node Graphs       • Client Memory Scanner
• Prefab City Placement   • FX Track Timelines       • Network Packet Sniffer
• NavMesh Voxelization    • String/STF Editors       • Live Transform Injection
```

The three studio pillars map directly to the modules above:

| Pillar | Modules |
|---|---|
| 3D World Studio | Procedural City Layout Planner (Module 3) |
| 2D Scripting Hub | Shader / Material Editor (Module 1), FX Sequencer (Module 4), Packaging Studio (Module 5) |
| Live Debugger Studio | Memory Inspector & Packet Analyzer (Module 2) |
