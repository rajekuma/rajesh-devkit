# AGENTS.md — rajesh-devkit

Instructions for any coding agent working on this repository (Codex,
Copilot, Antigravity and others). Claude Code reads `CLAUDE.md`, which holds
the same rules.

This repository is a Claude Code plugin: an SDLC loop (spec, design,
test-first implementation, review/quality/security gates, ship, docs) driven
one milestone at a time from a host project's `PROGRESS.md`.

## Before changing anything

Read [docs/PRINCIPLES.md](docs/PRINCIPLES.md). It is the charter for every
change, and its checklist applies to your change too.

Work on porting the loop to other harnesses follows
[docs/plans/harness-portability.md](docs/plans/harness-portability.md). Read
it only when that is the task.

## Commands

```bash
node --test tests/*.test.js                       # the regression suite; name the files (Node 22)
node tests/run-evals.js --case <case>             # behavioural evals: real Claude sessions, costs usage
node profiles/check.js [profile] [--new]          # profile model ids, tool support, prices
```

## Where things live

| Path | What |
|---|---|
| `agents/`, `skills/` | the prompts: tiers only, never model IDs or providers |
| `scripts/` | the hooks (Node); `scripts/lib/` shared helpers |
| `hooks/hooks.json` | which hook runs on which Claude Code event |
| `profiles/` | the provider launcher and tier-to-model profiles |
| `tests/` | `*.test.js` suite; `run-evals.*` for `evals/` |
| `docs/` | `SDLC.md` (the loop), `model-learnings.md` (measurements), `plans/` |
| `CHANGELOG.md` | what changed and the failure it prevents |

## Always-true rules

- Run the suite before every commit; every test must pass.
- Never commit to `main` directly: branch, PR, merge.
- Script sources are pure ASCII; files use LF endings.
- A behavioural change bumps the version in `.claude-plugin/plugin.json` and
  updates the README and CHANGELOG in the same change.
- Never edit the installed plugin copy or a host project that uses it while
  working here.
