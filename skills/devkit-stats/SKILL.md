---
name: devkit-stats
description: Reports wall-clock duration per milestone from this plugin's local telemetry log (written by continue-loop.ps1 and track-milestones.ps1), plus overall dev-loop stats. Timing only for now — no token/cost figures yet, see the plugin README. Trigger phrases — "show dev loop stats", "how long did each milestone take", "milestone timing report", "devkit stats".
model: haiku
---

# Dev loop timing report

Report how long each milestone took, end to end, using this plugin's own
local telemetry log — not a guess, not a model estimate, read straight from
the timestamped events the hooks already wrote.

## What this can and can't tell you right now

Only milestones actually driven through this plugin's `Stop` hook
(`continue-loop.ps1`) get a "started" timestamp, and only a `PROGRESS.md`
whose milestone rows this plugin recognises (`⬜/🟨/⏸/✅` table rows, or
`- [ ]`/`- [x]` checklist items) get a matching "shipped" timestamp from
`track-milestones.ps1`. A milestone implemented entirely by hand, in a
session that never stopped in between, won't have a "started" event and
won't show a duration — that's a real gap in coverage, not a bug; say so in
the report rather than pretending it doesn't exist.

This is timing only. It does not report tokens or cost — that needs the
session transcript's own usage data, which isn't wired up yet (see this
plugin's README, "Telemetry" section, for why: subagent-level token
attribution needs verifying against a real transcript before it's worth
building).

## Steps

1. **Find the log.** It lives at
   `%LOCALAPPDATA%\rajesh-devkit\telemetry\<hash>.jsonl`, where `<hash>` is
   the uppercase-hex MD5 of `$CLAUDE_PROJECT_DIR` (no dashes) — exactly what
   the hooks compute. Get it with this one command (adjust for the shell
   you're running in; this is the canonical form the hooks themselves use):

   ```powershell
   $h = [System.BitConverter]::ToString([System.Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($env:CLAUDE_PROJECT_DIR))) -replace '-',''
   Get-Content "$env:LOCALAPPDATA\rajesh-devkit\telemetry\$h.jsonl"
   ```

   If the file doesn't exist, say plainly that no telemetry has been
   recorded for this project yet (the Stop hook has never fired here, or
   this project was never driven through it) — don't fabricate a report.

2. **Parse it.** Each line is one JSON object:
   `{"event": "milestone_started"|"milestone_shipped", "milestone": "<name>", "timestamp": "<ISO 8601 UTC>"}`.
   Pair each `milestone_started` with the next `milestone_shipped` for the
   *same* milestone name, in chronological order (a milestone can only be
   "in flight" once at a time under this plugin's own nudge-cap design, so
   simple FIFO pairing per name is correct). A `milestone_started` with no
   matching `milestone_shipped` yet is still in progress.

3. **Report:**
   - A table: Milestone | Started (local time) | Shipped (local time, or "in
     progress") | Duration (or "elapsed so far" for in-progress).
   - Summary: milestones shipped (count), average duration, fastest,
     slowest.
   - Anything currently in progress, called out separately from the shipped
     ones.
   - If the log has zero events, or only `milestone_started` events with
     nothing shipped yet, say so plainly rather than presenting an empty
     table as if it were meaningful.

4. **Do not edit anything.** This is read-only, same as `devkit-reviewer` and
   `devkit-dep-audit` — it produces a report in the conversation, not a file.
