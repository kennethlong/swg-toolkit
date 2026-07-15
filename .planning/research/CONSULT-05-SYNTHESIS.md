# Phase 5 replan — de-anchoring crew synthesis (2026-07-08)

Four consultants, non-overlapping angles, each led with neutral evidence (the plan's claimed
RVA/offset/catalog table as "claims to confirm/refute"), pointed at real source. Focus: the
NEW bindings decision-1/getScale introduced, which the plan-checker cannot validate against ground truth.

## Ground truth — ALL binding claims CONFIRMED against real source

**Codex (legacy Utinni RVAs) — 8/8 CONFIRMED byte-exact:**
- setTransform_o2w `0x00B22CC0` (object.cpp:148), setScale `0x00B23A10` (object.cpp:155),
  getPlayer `0x00425140` (game.cpp:73), getPlayerCreatureObject `0x004251D0` (game.cpp:74),
  cachedNetworkIdGetObject `0x00B30160` (network.cpp:42; type at :35, `__thiscall`, pThis=CachedNetworkId),
  idManagerGetObjectById `0x00B380E0` (network.cpp:39, `__cdecl`, `Network::getObjectById(const int64_t&)`).
- +1432 is the lookAt-target slot; chain resolves via `Object::getObjectById(lookAtId)` (game.cpp:745).
- NO getScale RVA anywhere in Utinni's vendored source (grep-confirmed) — plan's claim accurate.
- Double-gated legacy-only: BOTH `getPlayerLookAtTargetObjectNetworkId()` (game.cpp:721) AND
  `getCachedObjectById` (network.cpp:80) early-return on `isAdvertisedClient()`.

**Cursor (advertised swg-client-v2 catalog) — all CONFIRMED, with 2 binding refinements:**
- `NetworkIdManager::getObjectById` catalog KEY is `"network::getObjectById"` (`__cdecl` static),
  engine_advertise.cpp:707 → impl NetworkIdManager.cpp:72-79. (NOT `__thiscall`; NOT the C++ symbol name.)
- `getLastSelectedObject` is a TWO-STEP: catalog key `"cuiHud::getTarget"` (name mismatch!),
  `__fastcall` thunk at :703, AND requires the live HUD instance from `"cuiHud::g_instance"`
  (:704 = `findMediatorForCurrentHud`). Not the single ":703-704 row" the plan implied.
- `Object::getScale()` CONFIRMED at Object.h:512-515: `inline const Vector &Object::getScale() const { return m_scale; }`.
- CONFIRMED NO `object::getScale` NOR `object::setScale` catalog rows exist (both are known gaps).

**Opus (+1432 invariant):**
- Semantic category source-verified: `m_lookAtTarget` "current target" (CreatureObject.h:707-708) is
  distinct from own `m_networkId` (Object.h:444). Fix E premise correct. Literal 1432 offset is
  legacy-layout comment-only, unprovable from source → keep "validate live."
- Gate structurally sound: single guarded choke point (network.cpp:84), no advertised bypass.
- Prose alignment: the legacy look-at path resolves via `Object::getObjectById`, not the raw RVA
  directly — Fix E prose should match the real call graph.
- Off-thread raw-`Object*` write is a genuine use-after-free hazard → UAT watch item (already added round-2).
- (One Opus caveat — "+1432 returns the slot's address not its contents" — is correct-by-design:
  cachedNetworkIdGetObject is `__thiscall` with pThis=the CachedNetworkId, so the address IS the wanted
  `this`. Divergence resolved by Codex's typedef evidence.)

## Two design findings that need a maintainer decision (Sonnet, source-verified)

**Finding A — the "legacy has no networkId source" justification is FALSE.**
The plan binds legacy `getObjectById` (0x00B380E0) but calls it a caller-less "reusable primitive"
because "legacy has no independent networkId source to feed it." Source contradicts the premise:
- `Object::networkId` is a flat raw field (object.h:86, `int64_t networkId;`).
- `Game::getPlayerLookAtTargetObjectNetworkId()` already reads a live look-at NetworkId (+1432) and
  feeds a SIBLING resolver (`Object::getObjectById`→`getCachedObjectById` 0x00B30160) in production today.
The precise RVA 0x00B380E0 genuinely has zero call sites (that part is true), but legacy is NOT
incapable of targeting. Options: (a) wire it up → legacy gets the SAME real cross-build targeting parity
as advertised's getSelectedObject; or (b) keep bound-but-unexercised, but relabel honestly
("resolver untested at runtime"), dropping the false "nothing could feed it" premise.

**Finding B — the getScale cross-repo handoff is likely UNNECESSARY.**
`getScale()` is `inline { return m_scale; }` → it has NO standalone out-of-line address to bind on most
builds. Chasing a getScale RVA / advertised catalog row (the current plan + handoff) targets a symbol
that may not exist as a callable address. `m_scale` is a plain POD member — a raw member-offset READ off
the `Object*` (same mechanism as +1432) is self-contained, needs no cross-repo change, and the plan's OWN
+1432 precedent already pre-clears the scope concern (D-03/05-03:479-483: a READ-only offset for guard
comparison does not violate D-01, which governs WRITES only). Trade-off: offset is per-build — verify
legacy offset now, gate/degrade advertised until its offset is confirmed (same axis as +1432). This
collapses the handoff into a local change. NOTE: this reverses the earlier maintainer decision to use
handoffs — made before knowing getScale is inline.
