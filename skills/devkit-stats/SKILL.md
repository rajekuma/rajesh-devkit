---
name: devkit-stats
description: Reports wall-clock duration, real USD cost (from the session transcript's own token usage), and a heuristic manual-effort comparison per milestone — using this plugin's local telemetry log (written by continue-loop.ps1 and track-milestones.ps1) plus token-report.ps1's deterministic transcript scan. Trigger phrases — "show dev loop stats", "how long did each milestone take", "milestone timing report", "devkit stats", "how much did this cost", "token usage report".
model: haiku
---

# Dev loop stats report

Report, per milestone: how long it took, what it actually cost in tokens and
USD, and — clearly separated from those two measured facts — a heuristic
estimate of manual effort for comparison. Timing and cost are read from real
data (telemetry events, transcript usage fields); the manual-effort figure is
a judgment call, and the report must never blur that distinction.

## What this can and can't tell you right now

Only milestones actually driven through this plugin's `Stop` hook
(`continue-loop.ps1`) get a "started" timestamp, and only a `PROGRESS.md`
whose milestone rows this plugin recognises (`⬜/🟨/⏸/✅` table rows, or
`- [ ]`/`- [x]` checklist items) get a matching "shipped" timestamp from
`track-milestones.ps1`. A milestone implemented entirely by hand, in a
session that never stopped in between, won't have a "started" event and
won't show a duration, cost, or comparison — that's a real coverage gap, not
a bug; say so in the report rather than pretending it doesn't exist.

Cost is computed from every assistant turn's own `usage` field in this
project's session transcripts — main session and every delegated subagent
run, both — for the window between a milestone's started/shipped
timestamps. This is real spend, not an estimate, but it has real limits:
pricing is a table baked into `token-report.ps1`, not fetched live, so it
goes stale if Anthropic changes prices after this plugin's last update; a
model outside that table reports its tokens but not its cost (flagged, not
silently dropped or guessed).

## Steps

1. **Find the telemetry log**, at `$env:CLAUDE_PROJECT_DIR\.claude\rajesh-devkit\telemetry.jsonl` —
   inside the project itself (gitignored automatically), not a
   machine-global path. If the file doesn't exist, say plainly that no
   telemetry has been recorded for this project yet — don't fabricate a
   report.

2. **Parse and pair.** Each line is
   `{"event": "milestone_started"|"milestone_shipped", "milestone": "<name>", "timestamp": "<ISO 8601 UTC>"}`.
   Pair each `milestone_started` with the next `milestone_shipped` for the
   *same* milestone name, in chronological order (a milestone can only be
   "in flight" once at a time under this plugin's own nudge-cap design, so
   simple FIFO pairing per name is correct). Three outcomes, each handled
   differently — don't collapse them into one "incomplete data" bucket:
   - **Both events present** → a closed window. Continue to steps 3-5.
   - **`milestone_started` with no `milestone_shipped` yet** → still in
     progress. Report elapsed-so-far duration only; skip cost and the
     manual-effort comparison (the window isn't closed, so there's nothing
     to scope a transcript scan to yet).
   - **`milestone_shipped` with no preceding `milestone_started`** → the
     telemetry log was reset or started partway through this milestone (this
     happens, e.g., after clearing state to test a fresh run — it isn't a
     bug to chase). There is no lower bound for a transcript-scan window, so
     duration and cost are both **unavailable**, not zero — say so plainly,
     don't guess a window. The manual-effort estimate in step 4 doesn't need
     telemetry at all (it only reads the spec), so still offer it for this
     milestone if a spec exists.

3. **For each *shipped* milestone, get real cost from the transcripts.** Run
   `${CLAUDE_PLUGIN_ROOT}/scripts/token-report.ps1` with that milestone's
   started/shipped timestamps as the window:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/token-report.ps1" -ProjectDir "$env:CLAUDE_PROJECT_DIR" -StartTime "<started ts>" -EndTime "<shipped ts>"
   ```

   It returns JSON: `totalCostUsd`, `unknownModelTokens` (tokens from a model
   not in its pricing table — surface this, don't silently exclude it from
   the token count even though it can't get a dollar figure), `byModel`
   (per-model token breakdown), and `byAgent` (per-subagent-invocation token
   totals, labeled by whatever `agentType`/`description` that invocation was
   given — useful for "which step cost the most" but is best-effort labeling
   from free-text descriptions, not a guaranteed clean taxonomy of
   `devkit-implementer` vs `devkit-reviewer` vs everything else).

4. **For each *shipped* milestone, add a heuristic manual-effort comparison.**
   This is a judgment call, not a measurement — treat it with the same
   discipline `devkit-specify` applies to its own assumptions: reasoned,
   stated plainly, never dressed up as more precise than it is.
   - Find that milestone's spec file (`specs/<kebab-feature>.md` — match by
     milestone name/number) and read its acceptance criteria. If none
     exists, don't guess a criteria count from the milestone's one-line
     `PROGRESS.md` name — report plainly that this milestone shipped without
     a spec this skill can find, so no manual-effort comparison is offered
     for it, and skip to the next milestone.
   - Estimate a plausible **range** of person-hours a competent engineer
     would need without AI assistance, reasoning from: the number of
     acceptance criteria, whether each is a straightforward extension of an
     existing pattern (~1-3 hours: implementation, tests, one review round)
     or touches something the spec's own **Behaviour/requirements section
     explicitly calls out** per its template — a new invariant, a
     security/auth boundary, a data-model change, an external integration
     (~1-3 days each, since these usually mean design discussion, more edge
     cases, and slower review) — plus general overhead (environment setup
     already done once, so don't double-count it per milestone; debugging
     and back-and-forth review are already folded into the per-criterion
     ranges above, don't add them again). A `🚩 assumption, not confirmed`
     flag elsewhere in the spec is a different thing — a gap the spec-writer
     filled with a default — and on its own doesn't push a criterion into
     the higher band unless what it flags is itself one of the sensitive
     categories above.
   - State the range with your reasoning inline (which criteria drove the
     high end), never a bare number — "~4-8 hours" is honest, "6.2 hours" is
     false precision for something this judgment-based.
   - Compute the implied speedup **only when both figures exist for this
     milestone**: (midpoint of the estimated range) ÷ (actual wall-clock
     duration from step 2). Report it as a rough multiplier ("~15-30x"), not
     a single decimal. If duration is unavailable (see step 2's third case),
     state the manual-effort range on its own and say plainly that speedup
     can't be computed without a real duration to divide it by — don't
     substitute the estimate's own range or omit the comparison silently.
   - Label this whole block clearly, e.g. **"🚩 Heuristic estimate, not
     measured"** — every time it appears, not just once at the top of the
     report where it's easy to miss on a long output.

5. **Report, in three sections matching step 2's three cases — don't merge
   them:**
   - **Shipped, full window (both events present):** milestone name,
     started/shipped timestamps (local time), duration, real cost (total
     USD, token breakdown by model, and — if useful — the per-agent
     breakdown from step 3, labeled as real transcript data, not an
     estimate), the heuristic manual-effort range and speedup multiplier
     from step 4, and any `unknownModelTokens` named plainly rather than
     folded silently into "total cost."
   - **Shipped, no started event:** milestone name, and plainly: "duration
     and cost unavailable — no `milestone_started` event found (likely a
     telemetry reset mid-milestone)." Still show the manual-effort range
     from step 4 if a spec was found, with no speedup figure next to it.
   - **Still in progress:** milestone name, elapsed time so far, no cost or
     comparison (the window isn't closed).

   Then a **summary across every milestone in the first two sections
   combined** (both count as shipped, even if one has no duration): total
   real cost (from the first section only — the second contributes nothing
   here, not a zero), total estimated manual-hours range across both
   sections (sum of each milestone's range, not its midpoint, so the range
   stays honest), and an overall speedup range computed only from
   milestones in the first section.

   If nothing has shipped yet, say so plainly rather than presenting an
   empty table as if it were meaningful.

6. **Do not edit anything.** This is read-only, same as `devkit-reviewer` and
   `devkit-dep-audit` — it produces a report in the conversation, not a file.
