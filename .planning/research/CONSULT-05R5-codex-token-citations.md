# Round-5 review — CODEX angle: FOCUS_TOKEN derivation soundness + citation corrections

Read `.planning/research/CONSULT-05R5-SHARED-PREAMBLE.md` first. Then take THIS angle only (leave the
identity invariants to Opus, byte-layout to Cursor, honesty to Sonnet).

**Your job: (1) confirm the round-5 citation corrections are now right against current source, and (2)
sanity-check that the FOCUS_TOKEN derivation is sound for the real x86 client — you are the
ground-truth/source oracle.**

Verify specifically:

1. **Advertised catalog citation fix.** Round 4 found the catalog rows drifted from 703/704/707 to
   705/706/709 in `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp`.
   Open that file NOW and report the CURRENT exact line of each: `cuiHud::getTarget`, `cuiHud::g_instance`,
   `network::getObjectById`. Then grep 05-03 and confirm it cites those exact current lines (round 5
   claims to have changed 15 occurrences to :705/:706/:709). Report any citation still at the old
   703/704/707 or any other mismatch. Confirm the catalog KEY strings + `__thiscall` convention are
   unchanged/correct.

2. **FOCUS_TOKEN derivation soundness.** The agent computes `focusToken =
   static_cast<uint32_t>(reinterpret_cast<uintptr_t>(focus))`. Confirm from the client/Utinni source that
   the SWG client is x86 (32-bit) — i.e. a `uintptr_t`/`Object*` is 4 bytes there, so the cast is the FULL
   pointer with NO truncation or aliasing (two distinct live objects can never share a token because
   distinct live objects have distinct addresses). If the client were ever 64-bit on any supported build,
   the truncation WOULD alias — state which is true from source. (This is the ground-truth underpinning of
   Opus's ABA analysis — give Opus a firm answer on truncation.)

3. **`Object::networkId` softening.** Round 5 softened the "only identity source" claim, noting
   `Object::networkId` is a real field at `object.h:86`. Confirm that field exists at that line in
   `D:/Code/Utinni/UtinniCore/swg/object/object.h`, and confirm it is genuinely 0/unpopulated on the
   legacy focus path (so the plan's choice to key on the pointer token instead of networkId is still
   justified even though the field exists). Is keying on the token the right call, or would reading the
   real networkId field have been a more stable identity than a reusable pointer?

4. **`getPlayer()` inside `__try`.** Round 5 claims `getPlayer()` was pulled inside the SEH span. Confirm
   from 05-03's task text that the `__try` now opens BEFORE the `getPlayer()` call (grep the line order),
   closing the round-4 LOW residual.

Output: a table — CLAIM | CITED/CURRENT SOURCE LOCATION | ACTUAL | VERDICT (matches / WRONG). Give Opus a
one-line firm answer on the x86-truncation question. Overall: are the round-5 ground-truth-touching
changes accurate? Anchor every row to a real file:line you opened.
