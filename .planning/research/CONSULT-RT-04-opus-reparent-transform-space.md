# CONSULT-RT-04 (fresh Opus) — Derive the correct reparent + transform sequence

Read `D:/Code/SWG-Toolkit/.planning/research/CONSULT-RT-00-GROUND-TRUTH.md` first. Its numbered items
are GIVEN — do not re-verify them. Items **13-15** and **24-25** are the ones this task is about.

You are the spec/math reasoner. Derive the answer from `D:/Code/swg-client-v2` source. Cite file:line
for every step. Where the source does not settle something, say "not determined by source" rather than
filling the gap with plausible reasoning.

## The situation

A tool moves the player by writing only the object-to-world transform:
`setTransform_o2w(player, T)` with `T` a row-major 3x4 (identity rotation, translation in column 3).

Teleporting to coordinates **inside a portalized building (POB)** puts the player in the right place
but the interior renders **see-through** from inside. Outdoor teleports are fine. Walking out the door
repairs it. A scene load produces the same state.

SWG interiors use portal culling; the visible cell set is driven by the object's **parent cell**, and
the write above never changes it — the player stays parented to the world cell.

## The relevant engine surface

- `Object::getParentCell() const` → `CellProperty*` — non-virtual, `Object.h:167`
- `virtual void Object::setParentCell(CellProperty*)` — `Object.h:168`, defined at
  `Object.cpp:1387-1409`
- `CellProperty::getWorldCellProperty()` — static, `src/shared/portal/CellProperty.h:78`
- `Object::attachToObject_w(...)` and its siblings — around `Object.cpp:2010-2033`
- The object's transform accessors — `getTransform_o2w` (`Object.cpp:1418`), and the object's
  `m_objectToParent` member
- `object::getTransformO2P` exists as an advertised copy-out shim, and the game's interior layout files
  (`.ilf`) store object-to-parent transforms — i.e. **interiors are authored in parent space**

## Questions — derive, do not guess

**Q1. Read `Object::setParentCell` (`Object.cpp:1387-1409`) line by line and state exactly what it does
to the object's transform.** Follow every call it makes — the detach path and the attach path — into
their definitions. The central question: **does it preserve the object's WORLD position across the
reparent, or does it preserve its PARENT-RELATIVE position (thereby teleporting it in world space)?**
Show the arithmetic, or the function that performs it.

**Q2. Given that answer, what is the correct call sequence** for "put the player at world position P,
correctly parented to cell C"? Specifically:
   a. Should the caller write `setTransform_o2w` **before** or **after** `setParentCell`, or does it not
      matter? Derive it — do not assert it.
   b. Must the caller convert P into cell-relative coordinates itself, or does the engine do it?
   c. If the caller must convert, what exactly is the transform to apply, and which engine accessor
      supplies it?

**Q3. What else does reparenting trigger?** `setParentCell` calls `cellChanged(...)` at `:1408`. Trace
what that notifies and what side effects follow — portal/culling state, the render layer, collision,
anything that must happen for the interior to render correctly. **Is `setParentCell` alone sufficient
to fix the see-through rendering, or is it necessary-but-not-sufficient?** If more is required, name
each additional call and where it lives.

**Q4. Edge cases in the same function.** `:1389` is `NOT_NULL(cellProperty)`; `:1392-1393` early-returns
when the cell is unchanged; `:1400-1401` detaches when not already in the world cell; there is a
`DEBUG_FATAL` on child objects at `:1396` compiled out under `#if 0`. What must a caller guarantee to
stay inside the contract? What happens if the player is a child object, or is mounted/in a vehicle?

**Q5. Where does the destination cell come from?** The caller has world coordinates, not an object. The
`CellProperty*` has to come from somewhere. Enumerate what the engine offers for "which cell contains
world point P" — and note that the tool can only call things in the advertised catalog, so also say
which of your candidates are inline/virtual/templated and would therefore need a purpose-built shim.
State the cleanest option and why.

**Q6. Is `getParentCell` → `setParentCell` pointer passthrough safe?** The tool would obtain a
`CellProperty*` from one engine call and hand it straight back to another, treating it as an opaque
handle and never dereferencing it. What is that pointer's lifetime, and what invalidates it? Is there a
window where it dangles?

## What NOT to do

- **Do not read the consumer's plans or change requests** in `D:/Code/SWG-Toolkit/.planning/`. They
  contain a proposed answer to Q1/Q2 and would anchor you. This task exists specifically to get an
  independent derivation. Stay in `swg-client-v2`.
- Do not design the tool-side feature. Answer the engine-semantics questions.
