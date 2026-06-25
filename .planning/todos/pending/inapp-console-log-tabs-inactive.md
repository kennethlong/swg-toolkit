---
id: inapp-console-log-tabs-inactive
title: Data panel "Console" and "Log" tabs are inactive (can't select) — no in-app logs
created: 2026-06-25
origin: Phase 02 04 — debugging skinned .sat lockup; user couldn't open Console/Log tabs
severity: low
area: renderer / Data panel
status: pending
---

## Symptom

The Data panel exposes tabs: Structure | Hex | Datatable | **Console** | **Log** | + . The Console
and Log tabs are inactive/unselectable — there is no in-app log surface. During debugging the user
had to be told to use Electron DevTools (Ctrl+Shift+I) instead.

## Fix

Wire the Console/Log tabs to a real in-app log surface (capture console.* + app events, or a ring
buffer the renderer writes to). Important for the maintainer to self-diagnose without DevTools, and
for eventually shipping a non-dev build where DevTools may be closed.

## Severity

Low — DevTools works for now. But it's a real usability gap for diagnosing asset/render errors.
