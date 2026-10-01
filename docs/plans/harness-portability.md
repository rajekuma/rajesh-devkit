# Plan: run the devkit loop on other agent harnesses

Status: **proposed, not started.** Nothing here is implemented, and no
harness other than Claude Code is supported until this plan's evidence says
so. Every change still answers to [docs/PRINCIPLES.md](../PRINCIPLES.md).

This is a living plan: update it as work lands, and record what was
measured, not what was hoped.

## Goal

Run the same SDLC loop (specify, implement test-first, review, quality,
security, ship, docs) on harnesses other than Claude Code, starting with
Codex, and route each role to the model and access route that earns it, on
measured quality and cost per accepted milestone. Two motives: parallel lanes
that don't spend the Claude usage limit, and a measured comparison of
harnesses.

## What exists today (checked against the code, 2026-10-01)

| Part | Where | Portable as-is? |
|---|---|---|
| Role prompts: 13 agents, 8 skills | `agents/`, `skills/` | Mostly. They are markdown and ask for tiers, never model IDs, but use Claude Code frontmatter (`tools`, `model`), tool names and `${CLAUDE_PLUGIN_ROOT}`. |
| Loop driver | `hooks/hooks.json`: `Stop` (continue-loop), `UserPromptSubmit` (loop-command), `SessionStart` (session-welcome), `PostToolUse` (run-verify, track-milestones, write-resume) | **No.** This is what keeps a session going and what enforces the gates, and it depends on Claude Code hook semantics: `Stop` exit 2 blocks the stop and feeds stderr back to the model. |
| State on disk | `PROGRESS.md`, `specs/`, `.claude/rajesh-devkit/` (arms, leases, gates, resume, telemetry, approach), `docs/metrics/` | Yes. Plain files, which any harness can read. |
| Provider routing | `profiles/*.json` + `profiles/devkit.js` | Partly. It swaps the *model behind Claude Code* through a gateway (OpenRouter). It does not swap the harness. |
| Measurement | `tests/` (suite), `tests/run-evals.js` (behavioural evals), `scripts/milestone-metrics.js`, `docs/model-learnings.md` | Yes, and it is the baseline this plan needs. |

What the plugin does **not** do, so this plan must not assume or "preserve" it:
- create or merge git worktrees (lanes are worktrees the user makes);
- retry or fall back on quota (switching to a gateway profile is a manual
  relaunch);
- enforce a global spawn limit.

## Compatibility contract

The Claude Code path, as installed in real projects today, is the contract:

- **New paths are additive and off by default.** With them off: no extra
  model calls, no extra context, no new dependency, no new required config.
- **The plugin keeps working with no new accounts.** No new provider, API
  key or network access required.
- **No public interface is renamed or moved for portability's sake.** That
  covers commands, skills, agents, hooks, state files and config keys.
- **Experiments run in a separate checkout or worktree,** never in an active
  project's working tree or a milestone in flight.
- **Promotion needs evidence.** Suite and evals pass on the Claude path;
  rollback is tested; nothing is promoted on design alone.

## The real problem: the loop driver

The prompts and the state carry over. The loop doesn't, because it lives in
Claude Code hooks. For each harness there are two options:

1. **Native hooks.** If the harness has a stop or turn-end hook that can send
   the session back to work, port the hook scripts to it. *Unverified for every
   harness below.*
2. **External driver.** A Node script runs the loop itself: it reads the same
   state, works out the next instruction the way `continue-loop.js` does, and
   hands it to the harness's non-interactive mode (for example `codex exec`)
   one step at a time, checking gates between steps. This works anywhere, at
   the cost of interactive steering.

Decide per harness from what is verified, not from what is advertised.

## Steps

### 0. Experiment first, before building anything

1. Take one approved MyHomeMaintenance-sized spec (any real project works).
2. In a separate git worktree, on a phase no Claude session is working, let
   Codex implement it test-first, with the repo's `AGENTS.md` and the spec as
   its only guidance.
3. Run the devkit gates on the result from Claude Code.
4. Record it with `milestone-metrics.js record --start --end --note` (an
   *estimated* window), and write the comparison into
   `docs/model-learnings.md`: criteria met, defects the gates found, your
   interventions, cost, active time.

Exit: a written result, good or bad. This tells us whether steps 1 to 3 are
worth doing at all.

### 1. Capability matrix

For each harness and version (Codex, Copilot, Antigravity, Qwen Code,
others), record the following. Each answer is **verified** (with source and
date), **not supported**, or **unknown**:
- instruction files it reads;
- skills;
- subagents;
- hooks (and which can block a stop);
- non-interactive mode;
- model choice;
- MCP;
- subscription versus API access, and how usage is reported.

Put the matrix in this file. Claim nothing as supported that isn't verified.

### 2. One end-to-end Codex slice (flag off by default)

1. The smallest path that runs one real milestone through specify, implement,
   review and ship on Codex, using the same artifacts (spec, ticks, gate
   stamps, metrics record).
2. Native hooks if step 1 verified them, otherwise the external driver.
3. Contract tests with mocked harness output: success, an unsupported
   capability, auth failure, throttling, timeout, malformed output,
   cancellation.
4. No partial writes, and never a hidden paid fallback.

### 3. Routing by evidence

- **Roles are defined by what they need,** not by vendor:
  - specifier: resolving ambiguity, writing criteria;
  - implementer: correct patches, red-green discipline, finishing the job;
  - reviewer: independent defect detection;
  - orchestrator: state, recovery.
- **Candidates are filtered first:** verified route, tools, context size,
  budget, quota.
- **Eligible candidates are ranked** on measured cost per accepted milestone,
  quality, reliability and latency. Token price alone doesn't decide.
- **Model IDs and prices live in configuration,** with a source and a date,
  never in lifecycle code.

## Economics rules

- **Use the subscription first** (Claude through Claude Code, Codex through
  ChatGPT) where the route is supported and quota remains. Subscription quota
  is not free: record it separately from metered spend.
- **Never reuse a harness login** to create an unsupported API route.
- **Paid fallback stays off** until a configured budget allows it, with
  per-task and per-run ceilings. At a limit, checkpoint and pause rather than
  escalate silently.
- **Keep prompt caches warm:** stable prefixes and tool order, dynamic content
  last. Give each agent the spec, the criteria, the diff and a compact
  handoff, not the whole history.
- **Use measured costs, not assumptions.** `docs/model-learnings.md` records
  what context × turns really cost on a gateway.

## Concurrency

- Default to one lane. Parallelism saves time, not tokens (PRINCIPLES §7).
- A lane on another harness gets its own worktree and its own phase.
  Sessions outside Claude Code don't hold devkit session leases, so the
  plugin can't detect a collision with them. Keep lanes apart by
  construction.
- Integrate a lane only after its gates pass, and re-run the checks after any
  conflict resolution.

## Promotion gates for each slice

1. **Disabled path unchanged:** suite and evals pass; no new calls, context or
   dependencies.
2. **Adapter contract tests pass,** including the failure cases.
3. **Workflow:** a real milestone completes in isolation, and limits hold.
4. **Economics:** compared with the recorded Claude baseline on equivalent
   work, with tolerances fixed before the run.
5. **Rollback:** turning the flag off restores the old behaviour, tested after
   a partial run.
6. **Install:** tested in a throwaway project first; installing in an active
   project needs the owner's go-ahead.

## Evidence for each slice

Record each slice's evidence in its PR and in `docs/model-learnings.md`:
- files changed;
- test results, marked mocked or live;
- measured cost and time;
- what is unsupported;
- the flag to turn it on;
- the rollback steps.

## Open questions

- Which harnesses have a hook that can block a stop or end of turn, and in
  which version?
- Can Codex or Copilot load this repo's skills and agents as they are, or do
  they need a generated copy?
- How does each harness report token usage? `milestone-metrics.js` reads
  Claude Code transcripts only.

## References

- OpenAI cookbook, ExecPlans (long-running plans kept as living documents):
  https://developers.openai.com/cookbook/articles/codex_exec_plans. It covers
  how to plan, not whether a harness can run this loop.
