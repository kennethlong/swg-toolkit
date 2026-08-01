# 2026-08-01 — PROVIDER HANDOFF: modding research docs (formats guide + guided-workflows/AI design)

**From:** the swg-client-v2 provider session, at Kenny's direction, 2026-08-01.
**Deliverables (both in this directory — adopt copies into your `docs/` tree wherever fits;
these are yours to keep and evolve):**

1. `2026-08-01-PROVIDER-DOC-asset-formats-and-modding-guide.md` — the complete SWG asset-format
   reference: all 48 client extensions (from a 193,475-file census of the live sku0 TOC), IFF/TRE
   mechanics, composition chains (mermaid), world→scene breakdown, the original SOE editing
   pipeline, per-format modern editing paths, composite-edit recipes (§9 — includes your model-D
   flow as the worked interior example), SOE editor inventory with build status + era-binary
   locations, and §10.3's toolkit-vs-field gap analysis with a lift-and-shift shortlist and a
   P1–P6 capability priority queue. A natural home: alongside your format docs (it supersedes
   scattered format notes; §12 lists corrections to older research claims).
2. `2026-08-01-PROVIDER-NOTE-guided-workflows-and-ai-layer-design.md` — the Guided Workflow
   engine design: a **supplemental layer on top of your planned Phase-8 MCP server** (AI-01
   unchanged), demand-ranked mod-archetype catalog with the first real community demand data
   this project has had (ModTheGalaxy census, per-server mod policies), the four consumer tiers
   (UI wizard / external MCP agents / optional embedded BYO-credential agent / AI-02 assists),
   and a wizard build order. A natural home: `docs/09-ai-mcp/` as a sibling of
   `ai-and-mcp-integration.md`, which it deliberately extends rather than replaces.

## Provenance (the when and why)

Produced 2026-08-01 in the provider session, at the maintainer's request, to answer: *"what are
all the asset formats, how do they compose, how were they edited, how do we edit them today"* —
and then, building on that: *"identify the common mods people want to make and design guided
wizard workflows for them, with an optional AI layer where the user's own AI subscription drives
the wizard."* Method, so you can judge the evidence:

- **Formats guide:** six parallel research passes over the engine source in swg-client-v2
  (loader-by-loader verification with file:line citations), a full extension census of the live
  client TOC, a survey of the existing docs corpus (stale claims corrected, not repeated), and a
  tool inventory across the sibling repos (era-binary drop at `D:\Code\swg-client\exe\win32`,
  swg-main dsrc, blender plugin, your own `.planning` state). Committed in swg-client-v2 as
  `fa346b421` (`docs/research/`), which is the canonical copy — deltas will land there first.
- **Workflows design:** your own planning corpus was mined first (Phase 8 / AI-01 / AI-02,
  `docs/09-ai-mcp/ai-and-mcp-integration.md`, sketches 007/016/021, the world-editor boundary
  rule, the FEATURES.md anti-feature list) so the design *aligns rather than competes* — the
  maintainer explicitly directed: keep the MCP plan as-is, make workflows a supplemental layer.
  Demand data is from live web research (ModTheGalaxy resource/thread census, SWG Legends
  2024-25 mod-policy coverage, Nexus SWG section, community tool repos) — cited inline.

## The sequencing recommendation, and the reasoning (maintainer-requested)

**Proposal: start the Guided Workflow engine directly after Phase 5.1 — before Phase 6
(Blender Bridge).** The argument:

1. **Adjacency — 5.1 is already building the first wizard.** `AddDecorationModal` (sketch 021)
   and the sketch-016 new-object wizard are wizard-shaped one-offs. Introducing the flow engine
   *now* means 021 becomes the first engine-hosted flow instead of a modal that needs migrating
   later; the retrofit cost is at its lifetime minimum this month.
2. **It's the demand center.** The community's #1 download is an editor tool, the most-walked
   modding paths are texture/UI mods, and the biggest documented pain points are asset
   discovery, installation, and per-server policy — exactly what the W1 wizards (texture reskin,
   packaging + policy checker) address. This is the largest-audience, lowest-skill-floor value
   the toolkit can ship next.
3. **Blender's audience is already served; workflows' audience is not.** The DCC path exists
   today outside the toolkit (swg-blender-plugin with round-trip-tested import/export;
   io_scene_swg_msh community add-on). Phase 6 makes that path *nicer* for the smallest, most
   expert user segment. No modern tool serves the guided-workflow audience at all.
4. **Dependency inversion favors workflows.** The flow/step registry is precisely what Phase 8's
   MCP server wraps (AI-01: "same backend services the UI calls") — building it first makes
   Phase 8 cheaper and de-risks it, and external-agent support (Claude Code/Cursor/Copilot over
   MCP) then costs near-zero. Phase 6 has no downstream phase depending on it.
5. **Low new-surface cost.** W1 wizards are orchestration over already-shipped services plus ONE
   new resolver (template→appearance→shader→texture asset discovery — which the UI wants anyway
   and which answers the community's single most common question). Phase 6 requires the heavier
   `.ans` round-trip (BLND-01/02).
6. **Timeliness.** The Legends policy regime (bans on terrain/footsteps/collision/animation/
   interior mods; launcher-integrated approved-mod manager) is recent and actively enforced — a
   policy-checking packaging wizard is most valuable while that's fresh, and it makes toolkit
   output compatible with the dominant distribution channel.

To be clear about scope: this proposes *re-ordering focus*, not cancelling Phase 6 — the bridge
was already scoped as a decoupled sidecar and slides one phase without loss. And tier-A wizards
carry no AI dependency at all; the AI tiers (MCP + optional embedded agent) ride Phase 8 as
planned. Suggested requirement additions are in the design doc §4 (WF-01/WF-02/AI-03).

## Suggested first actions (your side, at your discretion)

1. Adopt both docs into `docs/` (locations above) and skim the formats guide §8-9 — it's the
   per-step mechanics reference the wizard flows will cite.
2. If the sequencing argument lands: sketch a "Guided Workflows I" phase (engine + texture-reskin
   + packaging/policy wizards) between 5.1 and 6 in ROADMAP.md, and treat sketch 021 as flow #1.
3. Flag disagreements or gaps back through the usual inbox — especially on the wizard build
   order (§3 of the design doc) and the embedded-agent credential posture (§2.3), where a
   licensing check on subscription OAuth tokens is explicitly still open.

*Provider-side records: swg-client-v2 `docs/research/` (canonical, committed `fa346b421`) and
the session research trail (MTG census, Legends policy sources, planning-corpus mine) summarized
inside the two docs.*
