# Validate placeable templates by IFF type, not path prefix

**Origin:** 05.1-15 sign-off, 2026-08-04. A substring filter admitted
`object/draft_schematic/furniture/*` (crafting schematics) into the decoration picker; placing one
crashed the client with an ACCESS_VIOLATION the agent's SEH handler swallowed.

## The problem with the current fix

`AddDecorationModal.tsx` now uses a prefix-anchored allowlist derived from real `.ilf` bytes:
`object/static/`, `object/tangible/`, `object/soundobject/`.

That is a **heuristic standing in for a type check**. The engine's actual rule is:

> does `ObjectTemplateList::createObject(name)` return something that IS-A `ClientObject`?

A **type** property, not a path property. Consequences:

- The list is derived from ONE building (Mos Eisley cantina, 51 templates). Other interiors will
  surface classes it does not list, and each will need manual widening from real data.
- It was already wrong twice in one session — first a substring (admitted schematics), then
  `object/tangible/furniture/` (dropped the cantina's own instrument/speaker/microphone rows).

## Why it matters more than a missing tile

There is **no Release-mode guard below this filter**. `ClientInteriorLayoutManager.cpp:143-161`
does `safe_cast<ClientObject *>(...)` — unchecked in Release — and its "invalid interior object
template name … Object will be skipped" diagnostic is a `DEBUG_WARNING`, compiled out. A
wrong-class template that creates non-null yields a bad pointer and the next virtual call crashes.

And a bad row **persisted into an `.ilf` crashes on every subsequent load of that building**, not
only at placement time.

## Proposed

Read the candidate's `.iff` from the mounted VFS and accept on its root form type (the object
template class), rejecting intangible/schematic/mission classes that cannot become world props.
The VFS reader already exists (`makeReadVfs`).

Cost: a per-candidate read. Mitigate by validating only the SELECTED template at placement time
rather than every grid tile, and/or caching by path.

## Until then

The prefix allowlist stays. Widen it ONLY from real `.ilf` data, never from a plausible guess —
that is exactly how the original defect got in (plan text asserted a convention; test fixtures
carried the same invented paths; nothing checked real bytes).
