# CONSULT-RT-05 (Cursor) — Independent cross-check: reparent transform space + ordering

Narrow, single-question task. Answer ONLY from `D:/Code/swg-client-v2` source, with file:line for every
step. If the source does not settle a point, write "not determined by source" rather than reasoning
plausibly into the gap.

## Context

A tool moves the player object in a running SWG client by writing its object-to-world transform
(`Object::setTransform_o2w`, a row-major 3x4 with translation in column 3). Writing that alone leaves
the object parented to the **world cell**, so portal culling evaluates the outdoor cell set from a
position that is physically inside a building, and interiors render see-through.

The engine has just gained two newly-advertised entry points for fixing this:
- `object::setParentCell` — wraps `virtual void Object::setParentCell(CellProperty*)` (`Object.h:168`,
  defined `Object.cpp:1387-1409`)
- `cellProperty::getWorldCellProperty` — the static world-cell sentinel
  (`src/shared/portal/CellProperty.h:78`)

## The two questions

**Q1 — TRANSFORM SPACE.** To place the player at world position P inside cell C, must the caller
convert P into cell-relative (object-to-parent) coordinates itself, or does it write the plain
object-to-world transform and let the engine derive o2p?

Trace it. `Object::setParentCell` calls into an attach helper; follow that helper into its definition
and show what happens to the object's transform. Also read `Object::setTransform_o2w` itself and state
whether it is cell-aware — i.e. whether its behavior differs when the object's parent is the world cell
versus an interior cell. Name the functions and lines that perform any conversion.

**Q2 — ORDERING.** Should the caller write the transform FIRST and then reparent, or reparent FIRST and
then write the transform? Determine whether the two orders produce the same final state. If they
converge, say so — and then say whether there is any *observable* difference between them (side
effects, notifications, anything that observes intermediate state). `Object::setParentCell` ends by
calling `cellChanged(...)` at `Object.cpp:1408`; establish what that notifies and what world position
the object holds at the moment it fires under each ordering.

## Why you are being asked

Another consultant has independently derived answers to these same two questions, and a third party has
also stated an answer. Both of those are the same underlying model, so their agreement would be
correlated rather than independent. You are the independent reader. **Do not try to guess what the
expected answer is, and do not hedge toward a "safe" both-ways answer** — commit to what the source
says, or state precisely which part the source leaves open.

Do NOT read anything under `D:/Code/SWG-Toolkit/.planning/` — the other answers live there and would
anchor you.

Return: a one-sentence answer to Q1, a one-sentence answer to Q2, then the derivation for each with
file:line.
