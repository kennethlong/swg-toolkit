/**
 * packages/renderer/src/shared/VerificationStatus.test.tsx
 * Covers the Phase-5 'running' variant + dashedBorder prop extension (05-06-PLAN.md Task 1).
 *
 * Pre-existing variants (pass/fail/warn/parse-error/neutral) are exercised indirectly by
 * IffStructureTree's own tests; this file focuses on the NEW surface only, per the plan's
 * "existing call sites unaffected" acceptance criterion.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VerificationStatus from './VerificationStatus';

describe('VerificationStatus', () => {
  it('renders the running variant with info-colored glyph + caption', () => {
    const { getByText } = render(
      <VerificationStatus variant="running" caption="round-trip gate: re-encoding DTII…" />,
    );
    const caption = getByText('round-trip gate: re-encoding DTII…');
    expect(caption).toBeTruthy();
    // The colored pill is the closest ancestor span with the color style.
    const pill = caption.closest('span[style*="color"]');
    expect(pill).toBeTruthy();
    expect(pill?.getAttribute('style')).toContain('var(--color-info)');
  });

  it('dashedBorder=true wraps the pill in a dashed border matching the variant color', () => {
    const { container } = render(
      <VerificationStatus variant="running" caption="running" dashedBorder />,
    );
    const wrapper = container.querySelector('span[data-dashed-border="true"]');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.getAttribute('style')).toContain('dashed');
    expect(wrapper?.getAttribute('style')).toContain('var(--color-info)');
  });

  it('dashedBorder defaults to false — no wrapper element added for existing call sites', () => {
    const { container } = render(<VerificationStatus variant="pass" caption="✓ byte-exact" />);
    expect(container.querySelector('span[data-dashed-border]')).toBeFalsy();
  });
});
