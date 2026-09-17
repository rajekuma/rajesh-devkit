# Evals for the prompt-based components

`tests/run-tests.ps1` covers the PowerShell hooks deterministically. It cannot
cover the agents and skills, because those are prompts: the only way to know
whether `devkit-specify` still marks a schema change as `SENSITIVE:` is to
run it against a repo with a schema change and look.

That's what these are. Each case scaffolds a throwaway fixture project (a
tiny zero-dependency Node app, so `npm test` works with no install), runs
one component against it in an isolated `claude -p` session with only this
plugin loaded, and grades the result — mostly with **free deterministic
graders** (`file_exists`, `regex` on file contents, `tool_used`) so the
suite asserts on what was actually written and which tools actually ran,
not on an LLM's opinion of the transcript. `llm` graders are used only
where the thing being checked is genuinely a judgment (did the report
*lead* with the sensitive flags).

## Running

```bash
# From the plugin root. --scaffold is required: cases build their own fixtures.
claude plugin eval . --scaffold --allow-tools Bash Write Edit --runs 1 --max-cost-usd 15

# One case while iterating on it
claude plugin eval . --scaffold --allow-tools Bash Write Edit --runs 1 --case reviewer-* --keep-temp
```

Each run is a real Claude session on your credential. `--runs 1` while
authoring; the default of 3 is better for catching flaky behavior once a
case is stable.

## Things that matter when writing a case

- **This plugin's hooks fire during a run.** A fixture with an unstarted
  milestone in `PROGRESS.md` will trigger the `Stop` nudge and the agent
  will keep going until `max_turns`. Component cases therefore omit
  `PROGRESS.md`; `escalation-gate-integration` includes it on purpose.
- **`file_exists` only sees files the agent *created*.** To assert on a
  file the fixture already had (was `README.md` fixed?), use `regex` with
  `target: { source: file, path: README.md }`.
- **The spec template contains the literal `SENSITIVE:` marker** in its
  instruction text, so a grader on `specs/*.md` would match
  `_template.md`. Target the feature spec's filename glob instead.
- **`tool_used: Skill` graders are indicators, not scored** — the runner
  excludes them so the with-plugin and without-plugin arms stay comparable.
- **A case that drives a subagent must demand the foreground.** The `Agent`
  tool backgrounds by default; when it does, the parent answers "I'll relay
  its report once it completes", the run ends, and every grader scores an
  empty workspace — a total failure that looks like the component did
  nothing. Say `run_in_background: false` in the prompt, explicitly.
- **Grant file creation, not just tools.** `allowed_tools` is not sufficient
  in `--print` mode: `Write` comes back denied while `Edit` succeeds, so a
  case can silently grade a component that was never allowed to create a
  file — it looks like the component chose not to write. Measured, not
  guessed: of `acceptEdits`, `dontAsk` and `bypassPermissions`, only
  `bypassPermissions` actually let a child create
  `.claude/sub/probe.json`. `tests\run-evals.ps1` uses it, bounded by every
  run happening in a throwaway `$env:TEMP` fixture; the official runner has
  `--allow-tools` for the same purpose. Do **not** add
  `--permission-prompts none` — that means "nobody answers", which
  auto-denies.

## Fixtures

Each case's `scaffold.sh` is generated — edit `scaffold.tail.sh` and re-run
`bash evals/_shared/make-scaffolds.sh`, which inlines `_shared/base-fixture.sh`
ahead of the tail. The generated file is committed because the official runner
only ever sees a case's own `scaffold.sh`.

Two exceptions: `reviewer-catches-unmet` and `ship-unknown-not-pass` were
hand-written before the generator existed and have no `scaffold.tail.sh`, so
**a change to the base fixture will not reach them**. Both are verified
passing; converting them means rewriting a working fixture, which is why they
were left alone. Check them by hand if you change the base.

## Cases

| Case | Component | The invariant it locks in |
|---|---|---|
| `specify-marks-sensitive` | `devkit-specify` | A feature touching auth + the data model gets `SENSITIVE:`; no code is written |
| `implementer-red-green` | `devkit-implementer` | Caches the test runner, runs the suite more than once, ticks criteria, reports RED then GREEN |
| `reviewer-catches-unmet` | `devkit-reviewer` | An unmet criterion and a ticked-but-deferred one both produce `needs-changes`; no files touched |
| `ship-unknown-not-pass` | `devkit-ship` | No CI config and no coverage threshold → `UNKNOWN`, never `PASS`; verdict is `clear-with-unknowns`, not `clear` |
| `ship-blocks-unaccounted` | `devkit-ship` | An unticked criterion with no follow-up entry → `blocked` |
| `ux-enumerates-states` | `devkit-ux` | Empty/loading/error/permission states named, existing tokens and components reused, a11y criteria appended to the feature spec, no components written |
| `docs-finds-stale-readme` | `devkit-docs` | The renamed flag lands in the changelog *and* the README that still documented the old name gets fixed |
| `adr-writes-decision` | `devkit-adr` | Alternatives, consequences and a revisit condition all present |
| `adr-refuses-non-decision` | `devkit-adr` | A variable rename gets declined, and no ADR file is created |
| `onboard-brownfield` | `devkit-onboard` | Existing `CLAUDE.md` is not clobbered, the test command is actually run before being cached, `PROGRESS.md` is created, and the loop check is executed |
| `help-no-progress` | `devkit-help` | Without a tracker, walks through bootstrap rather than dumping a checklist |
| `escalation-gate-integration` | hooks + orchestrator | With a `SENSITIVE:` spec queued, the session asks the user and never auto-delegates to the implementer |
