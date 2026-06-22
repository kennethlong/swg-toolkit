/**
 * packages/renderer/src/main.tsx
 * React 19 renderer entry — dark dockable workspace shell (Plan 00-04).
 *
 * POSTURE (Path B fallback — nodeIntegration:true, contextIsolation:false):
 *   The renderer has Node access and loads the native addon directly.
 *   The SAB proof hooks (window.__*) are owned by StatusBar (single owner).
 *   See packages/renderer/src/shell/StatusBar.tsx for the Path B proof.
 *
 * This replaces the Phase-0 proof entry created in Plan 00-03.
 * The window.__* hooks set by StatusBar are consumed by 00-05 E2E.
 */

import React, { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
