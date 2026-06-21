# Object Templates & "Everything Is IFF"

> Covers: the unifying principle that nearly all SWG client data is IFF-in-TRE; the IFF data-type taxonomy; and Client Object Templates (`.iff` — server `STOT` / shared `SHOT` / interior `INTOT`) that bind game items to their visuals. Source: research doc lines 5636–5690.

> **Accuracy caveat:** the chunk tags `STOT`/`SHOT`/`INTOT` and the object-template field layouts are **AI-proposed and unverified** — this is exactly the kind of format that must be validated against the real `swg-client-v2` (the `ObjectTemplate`/`SharedObjectTemplate` loaders) and `Core3` before implementation. See [source provenance](../00-overview/source-provenance.md).

---

## Why this doc exists

Distillation organized the research by *editor feature*, so each format got a deep doc — but the
source's **unifying insight** and one whole **format family** had no home. A four-way coverage audit
(Codex, Cursor, Opus, Sonnet) unanimously flagged this as the #1 gap. This doc fills it.

## The core principle: everything is IFF, packed in TRE

The big visual assets (`.msh`, `.mgn`, `.dds`) eat most of the gigabytes, but the `.tre` archives
actually hold the **entire structural blueprint and metadata ruleset** of the client. SWG is a
data-driven engine: nearly all client logic, UI, text, and soundscapes are packed into the TRE
filesystem as **standardized IFF containers** (see [IFF & TRE](../01-core-engine/iff-and-tre.md)).

**The leverage for this toolkit:** because every data type maps back to the *same* IFF container
ruleset, the N-API binary-parsing layer can grow incrementally into a **complete editor**. The
north-star workflow: a modder selects a building in the 3D canvas → renames it via its `.stf` string
entry → alters its armor points by rewriting its template datatable → and repacks the whole patch
into a `.tre` archive **in one continuous step**. Every new format the toolkit learns is another
slice of that single, unified editing surface.

## The IFF data-type taxonomy

The "beyond geometry" content inside the TRE archives, with where each is documented:

| # | Type | Extension(s) | What it holds | Doc |
|---|------|--------------|---------------|-----|
| 1 | **Data Tables** | `.iff` (DTII) | Relational databases: item blueprints/stats (`object_template_*.iff`), crafting (`recipes.iff` — component reqs, experiment caps, assembly formulas), the entire 32-profession skill tree (`skills.iff` — XP thresholds, stat modifiers, titles) | [datatables-and-strings](datatables-and-strings.md) |
| 2 | **Client Object Templates** | `.iff` (`STOT`/`SHOT`/`INTOT`) | Bind items to visuals/behavior (server vs shared vs interior) | **this doc (below)** |
| 3 | **Localization / Strings** | `.stf` | Hash-ID → localized text matrices (weapon descriptions, quest logs, item stats, combat spam), language-selected | [datatables-and-strings](datatables-and-strings.md) |
| 4 | **Audio & Soundscapes** | `.snd`, `.wav`, `.mp3`, `.ws` | Sound templates (attenuation, pitch loops, priority); raw samples; **world audio scripts** (geo-triggered ambiance) | [audio-and-effects](audio-and-effects.md), [world-snapshots](world-snapshots.md) |
| 5 | **Client Interface Layouts** | `.ui` | Serialized XML-like UI tree: placement, pixel grids, skin paths, font maps, behavioral hooks | [ui-files](ui-files.md) |
| 6 | **Particle & Lighting Profiles** | `.prt`, `.eft`, `.lsb` | Particle physics rules; effect macros (combine particles + light + sound); lightsaber blade params | [audio-and-effects](audio-and-effects.md), [shaders-and-fx](../03-rendering/shaders-and-fx.md) |

## Client Object Templates (`.iff` — `STOT` / `SHOT` / `INTOT`)

SWG separates **server-side data logic** from **client visual logic**. The `object/` folder path is
packed with lightweight configuration templates that link an item to its visuals and behavior. This
is a **fundamental format used by every in-game item** — an item editor is blind without it.

### The server / shared split

- **Server Object Templates (`STOT`)** — exist purely for the server: database IDs, weight, inventory
  logic, and gameplay rules. Not read by the client for display. (Relevant to [Core3 parity](../05-server-integration/core3-parity.md).)
- **Shared Object Templates (`SHOT`)** — read by the **client** to determine how an item behaves in
  the viewport. A shared template such as `shared_bowl_s01.iff` dictates:
  - the text **name plate**,
  - **hover tooltip** bindings,
  - the default item **scale**,
  - and **which `.apt` visual appearance mesh to load**.
- **Interior Object Templates (`INTOT`)** — the interior/cell variant for portalized building
  interiors (relates to `.pob`; see [collision-and-portals](collision-and-portals.md)).

### Why it matters for the toolkit

`SHOT` is the **bridge between an item's data and its appearance.** When the editor shows an item in
the 3D canvas, it is the shared object template that says which `.apt`/mesh to render, how big, and
what the nameplate/tooltip read — wiring together [meshes & appearances](meshes-and-appearances.md),
[datatables](datatables-and-strings.md), and [strings](datatables-and-strings.md). An item/loot
editor, a "what does this template point at?" inspector, and the client↔server parity flow all sit on
top of this format.

### Implementation status

**Not yet specified at the byte level** — the research source describes the *roles* but no parser
code. Before building: read the real `ObjectTemplate` / `SharedObjectTemplate` loaders in
`../swg-client-v2`, confirm the actual chunk tags and the template-inheritance scheme (SWG object
templates use a `@base` derivation chain), and cross-check the `object/`-path layout against a real
client's TRE. Then this doc graduates from taxonomy to a full parse/serialize reference like the
other format docs.
