# CONSULT P4.1-03 — fresh Sonnet (lateral): end-to-end UX / integration coherence

Review an EXECUTION PLAN before it is built. Your angle: does the user-facing FLOW hang together
end-to-end, and are the edge cases handled? Find workflow gaps a pure code reader would miss. Do NOT
re-verify byte/source ground-truth (locked below) and do NOT trace symbol wiring (another consultant does).

## Treat as GIVEN (LOCKED)
- Absolute-path override .tre is the verified default deploy mechanism; v6000 out of scope; engine reused as-is.
- Approved designs are sketches 005-B/006-D (combined Deploy tab), 007 (front door + wizard), 008 (one Inspect|Deploy dock group). These layouts are LOCKED — don't redesign them.

## Read
- Plans: .planning/phases/04.1-deploy-project-ux/04.1-02,03,04,05,08,09-PLAN.md (binding, combined tab, front door, dock swap, stage-from-TRE, detection) + skim 01..11.
- Grounding: 04.1-CONTEXT.md, 04.1-UI-SPEC.md, the sketch READMEs in .planning/sketches/005-008.

## Your angle (ONLY this)
Walk these end-to-end user journeys against the plans and flag any step that is undefined, contradictory, or a dead end:
1. First run → Open/Create Project on a real client folder → detect kind → auto-bind → auto-mount base TREs → combined Deploy tab appears. (What if detection is ambiguous? cfg is client.cfg not swgemu.cfg? no Live/ dir?)
2. Non-client folder opened → "Is this a client install?" Yes/No → No = mod-project (deploy-to-client disabled). Is the disabled state coherent across the Deploy tab + dialog?
3. Re-open an EXISTING project created before this redesign (old saved dockview layout referencing staging/changesets panels) → layout-version mismatch → clear → rebuild to 008 default. Does the user lose anything they care about? Is there a reset-layout affordance if they get stuck?
4. Stage from TRE browser (Extract→Add) → Save version → select an OLDER version → Deploy with no edits (must deploy that version, NOT hang — the Phase-4 headline bug). Does the combined tab preserve "deploy from flatten(activeVersionId), never live staging"?
5. Deploy default (absolute-path) vs opt-in hardlink full-shadow → Reset. Is the model choice discoverable and the Reset behavior clear for BOTH?
6. Capture-only local-server step in the wizard — is it clearly optional/skippable and does it promise nothing it can't do yet (no push this phase)?

Report: per journey, COHERENT or GAP (which plan, what's missing, smallest fix). Also flag any place two plans imply different behavior for the same surface.
