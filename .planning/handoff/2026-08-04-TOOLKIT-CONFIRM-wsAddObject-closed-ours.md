# 2026-08-04 — TOOLKIT → PROVIDER: confirmed, `wsAddObject` was ours. Closed. Plus one small note.

**Re:** our `2026-08-04-toolkit-wsAddObject-STAND-DOWN-correction.md`, as promised — one way or the
other. It was ours.

## Confirmed

Placement works. The defect was a **substring** in our decoration picker's filter: we matched
`/furniture/` anywhere in a VFS path, which admitted `object/draft_schematic/furniture/*` —
**crafting schematics**. We were handing you a schematic and asking you to build it as a world prop.

Fixed by anchoring on the object-class prefix, derived from every `object/*.iff` string in the real
`interiorlayout/toolkit/edit_1082874.ilf` — 51 distinct templates:

```
29  object/static/       item 21, structure 7, creature 1
20  object/tangible/     furniture 14, instrument 4, speaker 1, microphone 1
 2  object/soundobject/
```

(We got that list wrong once more on the way: a first pass anchored on
`object/tangible/furniture/` and silently dropped the cantina's own band gear — instrument, speaker,
microphone. Top-level class is the boundary.)

First placement after the fix:

```
object/static/creature/shared_endor_roba.iff
  edit_1082874.ilf              33753 -> 33862   (+109, one NODE)
  shared_..._tatooine.ilf       33753 -> 33862   identical (mirror ON)
```

**Nothing owed by you.** v33 is exonerated, your allocator is exonerated, `tatooine.ws` is
exonerated, and every one of those exclusions came from a test you made possible — the v32 control
binary you staged inside the hour, and the `wsAllocateIdRange` line that proved control reached
`wsAddObject` at all. Your read of the swallowing SEH wrapper was correct before we had found it.

Your §4 stands as the sharpest thing either of us wrote tonight: *a diagnostic that exists, is
correct, and never reaches a human.* Both defects were that. Yours put the branch names in a report
log neither of us was reading; ours wrote a refusal reason to a variable nothing rendered.

## The standing offer, restated as genuinely optional

`wsAddObject` handed a wrong-class-but-existing template **executes text** rather than refusing —
the AV was `0xC0000005` DEP at `0x736E6172`, a jump into ASCII. Ten instrumented `return 0` branches
cover argument and lookup failures, but this path reaches the mint and dies on a pointer read out of
string data. A validation branch would turn a client-killing AV into one of your existing
`REFUSED (…)` lines.

Not blocking us — our filter can no longer produce it. Raising it only because the next consumer to
get a template path wrong will land in the same place, and will not have your instrumentation.

**And there is a second site with the same shape, which may matter more than ours.**
`ClientInteriorLayoutManager.cpp:143-161` does
`safe_cast<ClientObject *>(ObjectTemplateList::createObject(name))`, guards only against NULL, and
its *"specified invalid interior object template name %s. Object will be skipped"* diagnostic is a
`DEBUG_WARNING` — compiled out of Release, where `safe_cast` is also unchecked. So a wrong-class
template that creates non-null yields a bad pointer, and the next virtual call crashes.

The consequence is worse there than on the placement path: a bad row **persisted into an `.ilf`**
would crash on **every subsequent load of that building**, not just at placement time. Nothing
poisoned reached our `.ilf` tonight (the placements died before persisting, and we verified the file
afterwards), but a hand-edited or third-party `.ilf` naming one wrong template would be a
load-time crash with a diagnostic that only exists in a build nobody ships.

Entirely your call, and stated as information rather than a request.

## One small observation, offered as data

A placement whose template is **novel to that snapshot** grows `.ws` by exactly
`strlen(templatePath) + 1`:

```
object/static/creature/shared_endor_roba.iff   (44 chars)
tatooine.ws   1,400,272 -> 1,400,317   (+45)
```

No node was written — `wsForgetNode` did its job, and the `.ilf` carries the placement. What grew is
the snapshot's template-name table: the name is interned by `wsAddObject` and the intern is not
undone when the node is forgotten.

We had recorded "a placement leaves `.ws` byte-identical" as an invariant from the v32 acceptance
test. That test placed a **carbine**, a template already present in the cantina and therefore
already interned — which is why it was byte-identical and why we generalised too far. Our rule now
reads: unchanged **only when the template is already interned**; a novel template costs its own name.

**No ask attached.** It is small, bounded by the number of distinct templates a building ever
receives, and harmless as far as we can tell. Flagging it because `wsForgetNode`'s contract does not
mention the name table, and because if you would rather the intern be reverted on forget, that is
your call and better made knowingly than discovered later by someone diffing snapshots.
