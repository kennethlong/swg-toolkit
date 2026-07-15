# Round-4 review — CODEX angle: ground-truth targeting + citation verifier

Read `.planning/research/CONSULT-05R4-SHARED-PREAMBLE.md` first (locked axioms + the five claimed
changes). Then take THIS angle only (leave byte-layout, intent, and concurrency to the other three
reviewers):

**Your job: trace every RVA / offset / catalog row / source citation the round-4 replan touches, and
confirm it exists at the cited line in the REAL source.** You are the ground-truth oracle — the other
reviewers will assume your citations hold.

Verify specifically:

1. **Change #5 citation fix.** Open `D:/Code/Utinni/UtinniCore/swg/misc/network.cpp`. Confirm the
   `cachedNetworkIdGetObject` literal `0x00B30160` assignment is at **:42** and the typedef at **:35**
   (round-3 caught the plan mis-citing :35 for the literal). Confirm `idManagerGetObjectById=0x00B380E0`
   is at :39 (literal) / :32 (typedef). Then grep the round-4 05-03 plan text: does it now cite :42
   correctly, and are the Utinni path prefixes `swg/misc/network.cpp`, `swg/game/game.cpp`,
   `swg/ui/cui_manager.cpp` (NOT the round-3-wrong `swg/network/…`, `swg/misc/game.cpp`,
   `cui/cui_manager.cpp`)? Report any residual wrong path or line.

2. **Change #1 legacy re-key key.** 05-03 claims legacy focus-identity is keyed on the raw `focus`
   pointer (no networkId on legacy). Confirm from Utinni source that legacy genuinely has no usable
   per-object networkId on the focus path (the `+1432` slot is the player's TARGET, not the object's own
   id — game.cpp:721-746, object.cpp:260-268). Is keying re-capture on the raw `focus` pointer the only
   sound option on legacy, or does a better identity source exist in the cited source?

3. **Change #2 live scale read.** 05-03 claims scale now rebaselines from a live `m_scale` member-offset
   read (`kLegacyScaleOffset=0x44`). Re-derive 0x44 from `D:/Code/Utinni/UtinniCore/swg/object/object.h`
   member layout (:76-107, `scale` at :94) under standard MSVC x86 alignment. Does the plan's derivation
   hold, or is the offset wrong? (It is flagged VALIDATE-LIVE, so a wrong value is a MEDIUM, not a
   blocker — but say if the arithmetic is simply mis-summed.)

4. **Advertised catalog rows.** Confirm `cuiHud::getTarget` (:703), `cuiHud::g_instance` (:704),
   `network::getObjectById` (:707) still exist in engine_advertise.cpp and that 05-03 binds them with the
   exact catalog key strings + null-safe seeding + correct calling conventions (`cuiHudGetTarget` should
   be `__thiscall`, not `__fastcall`). Flag any name/convention mismatch.

Output: a table — CLAIM | CITED LOCATION | ACTUAL (from source) | VERDICT (matches / WRONG). Then an
overall: are the round-4 targeting/citation changes ground-truth-accurate, or is anything still
mis-cited? Anchor every row to a real file:line you actually opened.
