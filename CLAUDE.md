# CLAUDE.md — rajesh-devkit (the plugin itself)

This repository is a Claude Code plugin: an SDLC loop (spec → design →
test-first implementation → review/quality/security gates → ship → docs)
driven one milestone at a time from a host project's `PROGRESS.md`.

**Every change to this repository must follow the charter below.** It is
imported here so it is always in context:

@docs/PRINCIPLES.md

## Common commands

```bash
node --test tests/*.test.js                       # the regression suite (Node 22: name the files; tests/ alone fails)
node tests/run-evals.js --case <case>             # behavioural evals of the prompts (real Claude sessions; costs usage)
node tests/run-evals.js --case <case> --profile <name>   # the same on a gateway profile (costs OpenRouter credit)
node profiles/check.js [profile] [--new]          # profile model ids, tool support, prices; new models on the gateway
```

## Where things live

| Path | What |
|---|---|
| `agents/`, `skills/` | the prompts — tiers only, never model IDs or providers |
| `scripts/` | the hooks (Node); `scripts/lib/` shared helpers |
| `hooks/hooks.json` | which hook runs on which event |
| `profiles/` | the provider launcher and tier→model profiles |
| `tests/` | `*.test.js` suite; `run-evals.*` for `evals/` |
| `docs/SDLC.md` | the loop explained for users |
| `docs/model-learnings.md` | every model measured: score, real cost, lesson |
| `CHANGELOG.md` | what changed and the failure it prevents |

## Always-true rules

- Keep this file short; the charter holds the reasoning.
- Run the suite before every commit; all tests must pass.
- Never commit to `main` directly: branch, PR, merge.
