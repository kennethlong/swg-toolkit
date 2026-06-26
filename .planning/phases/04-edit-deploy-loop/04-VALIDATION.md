---
phase: 04
slug: edit-deploy-loop
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + native unit assertions; manual in-client UAT for cfg activation |
| **Config file** | per-package `vitest.config.ts` (hoisted vitest; see 03-01 decision) |
| **Quick run command** | `npx vitest run <changed package/test>` |
| **Full suite command** | `npx vitest run` (from repo root) |
| **Estimated runtime** | ~varies (188+ tests today; keep < ~60s) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <relevant test>`
- **After every plan wave:** Run `npx vitest run` (repo root)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD — planner fills during planning | | | DEPLOY-01..04 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] TBD — planner derives from RESEARCH.md Validation Architecture section.

*Note: DEPLOY-01 patch round-trip + DEPLOY-04 "no retail bytes in git log" are automatable;
DEPLOY-02 (patch actually loads + shadows in a running client, persists across relaunch — OQ-2)
is manual in-client UAT.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Built patch loads in the running client and shadows retail | DEPLOY-01/02 | Requires a real SWG client process + visual confirmation | Stage one file → build v5000 patch → activate via `.include`d `swgtoolkit.cfg` `[SharedFile]` slot 55 → launch Infinity → confirm the modded asset is in effect |
| `.cfg` insertion persists across launcher relaunch | DEPLOY-02 | Launcher may regenerate cfgs (OQ-2) | Relaunch via the official launcher; confirm `swgtoolkit.cfg` `.include` + slot survive |
| Non-destructive rollback toggle restores prior client state | DEPLOY-03 | End-to-end visual | Roll active version down; rebuild/redeploy; confirm prior state + re-activatable layer |

*Per-task automated rows filled by the planner.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
