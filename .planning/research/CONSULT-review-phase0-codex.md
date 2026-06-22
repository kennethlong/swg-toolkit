… (base context is in CONSULT-review-phase0-base.md in this same repo — read it first:
.planning/research/CONSULT-review-phase0-base.md)

# YOUR ANGLE (Codex): cross-plan interface consistency & dependency wiring

You are the repo tracer. Focus ONLY on whether the five plans fit together as a consistent DAG and
whether the interfaces declared in one plan match what consuming plans expect. Do not duplicate a
generic "is Electron secure" review — trace the wiring.

Read all five PLAN.md files in `.planning/phases/00-toolchain-de-risk-app-shell/` and check:

1. **IPC contract consistency end-to-end.** The `contracts/` types (00-01) — `IpcMessage` union,
   `SAB_LAYOUT`, `NativeOpcode` — are produced in 00-01 and consumed in 00-03 (main.ts, preload.ts,
   utility-worker.ts) and 00-04 (renderer). Do the message `type` literals line up across producer
   and consumer? e.g. main.ts forks the worker and sends `{type:'init-port'}` with `[port2]`; the
   worker reads `event.ports[0]`; the worker replies `{type:'sab-ready', sab}`; main relays via
   `win.webContents.postMessage('sab-port', {sab}, [port1])`; preload exposes `onSabPort`; renderer
   reads `payload.sab`. Trace this whole chain and flag any mismatch in field names, message types,
   or transfer-list handling.

2. **Wave / depends_on DAG.** Check the `depends_on` and `wave` frontmatter of each plan against what
   it actually consumes. 00-04 depends_on [00-01, 00-03] but is wave 3; 00-03 is wave 2 depends on
   [00-01, 00-02]. Is anything consumed that isn't declared as a dependency? Is the SUMMARY.md that a
   later plan `@`-includes actually produced by the plan it depends on?

3. **Test-hook contract.** `window.__sabValue` is *defined* in 00-04 (ViewportPanel) and *consumed* in
   00-05 (03-sab-roundtrip + 05-packaged specs). The Playwright fixture `e2e/fixtures/electron-helpers.ts`
   is defined in 00-01 and imported by specs in 00-05. Are these contracts consistent (names, shapes)?

4. **`files_modified` collisions.** Do any two plans in the same wave declare the same file? Is the
   utility-worker emitted as a separate Vite rollup entry (00-01 vite.main.config.ts) actually the same
   path main.ts forks (00-03)?

5. **The Vite/Forge utility-worker path.** 00-01 declares `src/utility-worker.ts` as a named rollup
   input under `packages/contracts`? No — trace where utility-worker.ts actually lives
   (00-03 says `packages/backend/src/utility-worker.ts`) vs where 00-01's vite.main.config.ts inputs
   point (`src/main.ts` and `src/utility-worker.ts`). Flag any path inconsistency that would break the
   fork in dev vs packaged.

Output the 5-section format from the base file. Cite plan/task IDs. The most valuable thing you can
find is a concrete wiring mismatch that would fail at integration time.
