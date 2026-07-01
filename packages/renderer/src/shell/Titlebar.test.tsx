/**
 * packages/renderer/src/shell/Titlebar.test.tsx
 * Component tests for Titlebar — sketch 008 gaps S2 + S5.
 *
 * Tests:
 *   1 — S2: 'Deploy' menu item is present between 'Asset' and 'Window'
 *   2 — S5: theme select renders exactly two optgroups (Accent, Accessibility)
 *   3 — S5: Accent optgroup contains at least 4 options (cyan, swg-green, amber, blue)
 *   4 — S5: Accessibility optgroup contains the high-contrast option
 *   5 — KEEP: window-control circles still render (3 buttons after the menu buttons)
 *
 * Source: 04.3-09-PLAN.md Task 1.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Titlebar from './Titlebar';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderTitlebar() {
  return render(
    <Titlebar activeTheme="cyan" onThemeChange={vi.fn()} />,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Titlebar — S2: Deploy menu item', () => {

  it('Test 1: "Deploy" menu button is present in the titlebar', () => {
    const { container } = renderTitlebar();
    const buttons = Array.from(container.querySelectorAll('button'));
    const menuLabels = buttons.map(b => b.textContent?.trim()).filter(Boolean);
    expect(menuLabels).toContain('Deploy');
  });

  it('Test 1b: "Deploy" appears between "Asset" and "Window" in the menu', () => {
    const { container } = renderTitlebar();
    const buttons = Array.from(container.querySelectorAll('button'));
    const menuLabels = buttons.map(b => b.textContent?.trim()).filter(Boolean);
    const assetIdx  = menuLabels.indexOf('Asset');
    const deployIdx = menuLabels.indexOf('Deploy');
    const windowIdx = menuLabels.indexOf('Window');
    expect(assetIdx).toBeGreaterThanOrEqual(0);
    expect(deployIdx).toBeGreaterThan(assetIdx);
    expect(deployIdx).toBeLessThan(windowIdx);
  });

});

describe('Titlebar — S5: theme select optgroups', () => {

  it('Test 2: theme select has exactly two optgroups', () => {
    const { container } = renderTitlebar();
    const optgroups = container.querySelectorAll('optgroup');
    expect(optgroups.length).toBe(2);
    const labels = Array.from(optgroups).map(g => g.getAttribute('label'));
    expect(labels).toContain('Accent');
    expect(labels).toContain('Accessibility');
  });

  it('Test 3: Accent optgroup has at least 4 options', () => {
    const { container } = renderTitlebar();
    const accentGroup = container.querySelector('optgroup[label="Accent"]');
    expect(accentGroup).not.toBeNull();
    const opts = (accentGroup as HTMLOptGroupElement).querySelectorAll('option');
    expect(opts.length).toBeGreaterThanOrEqual(4);
  });

  it('Test 4: Accessibility optgroup has the high-contrast option', () => {
    const { container } = renderTitlebar();
    const a11yGroup = container.querySelector('optgroup[label="Accessibility"]');
    expect(a11yGroup).not.toBeNull();
    const opts = Array.from((a11yGroup as HTMLOptGroupElement).querySelectorAll('option'));
    const values = opts.map(o => (o as HTMLOptionElement).value);
    expect(values).toContain('high-contrast');
  });

  it('Test 5: no flat options remain outside an optgroup', () => {
    const { container } = renderTitlebar();
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    // Direct children of select that are <option> (not inside optgroup) should be none
    const directOptions = Array.from((select as HTMLSelectElement).children).filter(
      el => el.tagName === 'OPTION',
    );
    expect(directOptions.length).toBe(0);
  });

});
