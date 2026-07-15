// focus-rekey.test.ts — Tests for the agent's guard-baseline re-key decision
// (agent_main.cpp's s_expectedCapturedAgainst / s_expectedCapturedAgainstTemplate /
// s_expectedCapturedAgainstNetworkId cross-check).
//
// The re-key predicate is implemented in C++ (agent/agent_main.cpp). This file
// tests a TypeScript-equivalent port to avoid requiring a native addon compile
// cycle for vitest — the TS port mirrors the C++ logic exactly (pointer/token
// compare OR'd with a CONTENT compare of templateName OR'd with a networkId
// compare). This is the SAME convention write-guard.test.ts / sentinels.test.ts
// already establish for this project.
//
// ROUND 6 (REVIEWS.md round-5 maintainer decision "option (a) structural", Opus
// 3c-ii): the templateName half of this compare MUST be a CONTENT compare
// (strncmp against an owned copy), NEVER a raw pointer/reference compare — a
// pointer compare silently no-ops the fix (a reused frame buffer's address never
// changes across ticks even though its bytes do -> the agent-side pointer-ABA
// blind spot reopens) OR re-captures every tick (a fresh per-frame buffer's
// address always differs even when its bytes are identical -> defeats tamper
// detection). This file proves the CONTENT-compare implementation gets BOTH
// cases right, and that a naive reference-identity compare gets BOTH wrong.
//
// Reference: PLAN 05-03 Task 2 <behavior>/<action> blocks, acceptance criteria
// "ROUND 6 (BEHAVIORAL test...)".

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// TypeScript port of agent_main.cpp's re-key mismatch condition
// ---------------------------------------------------------------------------

const TEMPLATE_NAME_LEN = 256; // mirrors channel.h's char templateName[256] / k_templateNameLen

interface FocusIdentity {
  /** static_cast<uint32_t>(reinterpret_cast<uintptr_t>(focus)) — the ROUND 5 focusToken value. */
  focusToken: number;
  /** Fixed-size byte buffer standing in for the C char[256] templateName field. */
  templateBytes: Uint8Array;
  /** Object::networkId (0 on legacy, per Fix E — sentinel not-applicable). */
  networkId: bigint;
}

/**
 * shouldRecapture — TS port of agent_main.cpp's re-key mismatch condition:
 *   focus != s_expectedCapturedAgainst
 *   || strncmp(templateName, s_expectedCapturedAgainstTemplate, k_templateNameLen) != 0
 *   || networkId != s_expectedCapturedAgainstNetworkId
 *
 * `current` is this iteration's freshly-resolved focus identity; `captured` is
 * the agent's OWNED snapshot (s_expectedCapturedAgainst*) taken at the last
 * capture/re-key point. Returns true when ANY of the three signals disagrees
 * (ROUND 6 — closes the agent-side half of Opus's pointer-ABA finding: a
 * despawned object's address reallocated to a DIFFERENT object no longer
 * skips re-capture merely because the raw pointer/token happens to match).
 */
function templateContentEquals(a: Uint8Array, b: Uint8Array): boolean {
  // Mirrors strncmp(a, b, k_templateNameLen) == 0 — a byte-for-byte CONTENT
  // compare, never a reference/pointer compare (Opus 3c-ii).
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return false;
  }
  return true;
}

function shouldRecapture(current: FocusIdentity, captured: FocusIdentity): boolean {
  if (current.focusToken !== captured.focusToken) return true;
  if (!templateContentEquals(current.templateBytes, captured.templateBytes)) return true;
  if (current.networkId !== captured.networkId) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function encodeTemplateName(name: string): Uint8Array {
  const buf = new Uint8Array(TEMPLATE_NAME_LEN);
  const bytes = new TextEncoder().encode(name);
  buf.set(bytes.subarray(0, TEMPLATE_NAME_LEN - 1));
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shouldRecapture (agent-side guard-baseline re-key)', () => {
  it('same focusToken + IDENTICAL templateName content (reused buffer, mutated in place) -> re-captures', () => {
    // Simulates the C++ pointer-ABA hazard directly: templateName is read via a
    // frame buffer that lives at the SAME address every tick (a raw pointer
    // compare against that address would ALWAYS report "unchanged"), but this
    // tick's BYTES differ from what was captured — a genuine object-identity
    // change (e.g. despawn+realloc landed a different templated object at the
    // same focus address). The captured snapshot is an OWNED COPY (mirrors
    // s_expectedCapturedAgainstTemplate's strncpy semantics — a real content
    // copy, taken BEFORE the live buffer's contents change), so mutating the
    // live buffer afterward can never retroactively alter what was captured.
    const liveBuf = encodeTemplateName('object/creature/player/shared_human_male.iff');
    const captured: FocusIdentity = { focusToken: 0xdead0000, templateBytes: liveBuf.slice(), networkId: 123n };

    // The SAME physical buffer reference is reused for this tick's live read,
    // but its content has since changed underneath — mirrors a reused/relocated
    // memory address whose bytes were overwritten by a different object. A
    // naive pointer/reference compare against the OWNED captured snapshot
    // would never even consider these the "same" pointer (different objects
    // by construction here) — the point this case proves is narrower and more
    // direct: the compare must be driven by CURRENT BYTES, not by whatever the
    // buffer looked like at some prior moment in time.
    liveBuf.fill(0);
    liveBuf.set(new TextEncoder().encode('object/creature/npc/shared_womprat.iff'));
    const current: FocusIdentity = { focusToken: 0xdead0000, templateBytes: liveBuf, networkId: 123n };

    expect(shouldRecapture(current, captured)).toBe(true);
  });

  it('same focusToken + IDENTICAL templateName content (fresh buffer objects) -> does NOT re-capture', () => {
    // Simulates the opposite C++ hazard: templateName is read into a FRESH
    // per-tick buffer whose address differs every call, even when the actual
    // string content is unchanged (the normal, common case — same object,
    // same template, polled every tick). A naive pointer/reference compare
    // would see two DIFFERENT buffer objects and wrongly conclude "changed"
    // every single tick, defeating tamper detection entirely.
    const captured: FocusIdentity = {
      focusToken: 0xdead0000,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 123n,
    };
    const current: FocusIdentity = {
      focusToken: 0xdead0000,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'), // separate object, same bytes
      networkId: 123n,
    };

    expect(current.templateBytes).not.toBe(captured.templateBytes); // genuinely distinct references
    expect(shouldRecapture(current, captured)).toBe(false);
  });

  it('focusToken differs (pointer/token half of the compare) -> re-captures regardless of template content', () => {
    const captured: FocusIdentity = {
      focusToken: 0xdead0000,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 123n,
    };
    const current: FocusIdentity = {
      focusToken: 0xbeef0000, // a genuinely different resolved focus object
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 123n,
    };
    expect(shouldRecapture(current, captured)).toBe(true);
  });

  it('networkId differs (identity half of the ROUND 6 cross-check) -> re-captures even with same token/template', () => {
    const captured: FocusIdentity = {
      focusToken: 0xdead0000,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 123n,
    };
    const current: FocusIdentity = {
      focusToken: 0xdead0000, // same address (an ABA realloc landing on the same address)
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'), // same template
      networkId: 456n, // but a genuinely different object's networkId
    };
    expect(shouldRecapture(current, captured)).toBe(true);
  });

  it('everything identical -> does NOT re-capture (the steady-state per-tick case)', () => {
    const identity: FocusIdentity = {
      focusToken: 0xdead0000,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 123n,
    };
    const capturedCopy: FocusIdentity = {
      focusToken: identity.focusToken,
      templateBytes: identity.templateBytes.slice(), // owned copy, same bytes
      networkId: identity.networkId,
    };
    expect(shouldRecapture(identity, capturedCopy)).toBe(false);
  });

  it('regression guard: a naive REFERENCE-identity templateName compare gets both failure modes wrong', () => {
    // This test documents (does not call shouldRecapture) the exact defect
    // class this file's other tests prove `shouldRecapture` does NOT have —
    // a reference/pointer compare of templateBytes:
    function naiveMismatch(current: FocusIdentity, captured: FocusIdentity): boolean {
      return (
        current.focusToken !== captured.focusToken ||
        current.templateBytes !== captured.templateBytes || // reference compare, the banned pattern
        current.networkId !== captured.networkId
      );
    }

    // Failure mode 1 ("silently no-ops the fix"): same buffer reference reused
    // across ticks, content mutated -> naive compare says "unchanged" (WRONG).
    const capturedBuf = encodeTemplateName('object/creature/player/shared_human_male.iff');
    const captured: FocusIdentity = { focusToken: 1, templateBytes: capturedBuf, networkId: 1n };
    const currentSameRef: FocusIdentity = { focusToken: 1, templateBytes: capturedBuf, networkId: 1n };
    capturedBuf.fill(0); // mutate the shared buffer after "capture"
    capturedBuf.set(new TextEncoder().encode('object/creature/npc/shared_womprat.iff'));
    expect(naiveMismatch(currentSameRef, captured)).toBe(false); // WRONG — content changed, naive says no

    // Failure mode 2 ("defeats tamper detection"): fresh buffer objects, IDENTICAL
    // content -> naive compare says "changed" (WRONG, would re-capture every tick).
    const capturedB: FocusIdentity = {
      focusToken: 2,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 2n,
    };
    const currentB: FocusIdentity = {
      focusToken: 2,
      templateBytes: encodeTemplateName('object/creature/player/shared_human_male.iff'),
      networkId: 2n,
    };
    expect(naiveMismatch(currentB, capturedB)).toBe(true); // WRONG — identical content, naive says yes
  });
});
