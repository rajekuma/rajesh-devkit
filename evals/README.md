# Evals for the prompt-based components

`node --test` covers the hooks deterministically. It cannot
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
# From the plugin root. Dispatches to the official runner on macOS/Linux, or
# to tests/run-evals.ps1 on Windows (see its header for why: the official
# runner can't yet confine a Bash-granting run there).
node tests/run-evals.js

# One case while iterating on it
node tests/run-evals.js --case reviewer-* --keep-temp
```

Calling the official runner directly (`claude plugin eval . --scaffold
--allow-tools Bash Write Edit --runs 1 --max-cost-usd 15`) works the same way
on macOS/Linux and exposes its full flag set.

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
- **"Did it commit?" is gradeable without a git-aware grader.** `.git/logs/HEAD`
  gets one line per ref update: the scaffold's baseline is `commit (initial):`
  and any commit the session makes is `commit: `. A `regex` grader on that
  file with `match: not_contains` on `'	commit: '` catches it
  deterministically. `file_exists` on `.git/refs/heads/**` catches a new
  branch the same way, since it only sees files the session created.
- **A fixture has to be right for its grader to mean anything.** The first
  `ui-verify` fixture had a server that answered `ok` to every route and an
  `app.js` with empty handlers, on a milestone marked Implemented.
  `devkit-ui-verify` correctly returned `mismatches` - it found real defects
  in the fixture - and the `partly-unverified` grader failed. The component
  was right; the case was wrong. Before blaming a component, ask whether the
  fixture actually holds the premise the grader assumes.
- **An llm judge is a vote, not a verdict - back it with something
  deterministic.** The rubric said "a stub backend is not acceptable"; the
  judge passed a run whose own method note said "using a stub backend". A
  `tool_used` grader with `min: 0, max: 0` on the Bash input
  (`createServer`) now catches it regardless of what the judge thinks. Where
  a rule can be checked mechanically, check it mechanically and let the
  judge cover only what can't be.
- **The judge's verdict is its first line.** The runner used to scan the
  whole reply for PASS and FAIL, so a reason sentence that quoted the
  agent's own "FAIL" table rows made a correct PASS "ambiguous". It now
  reads the first non-empty line only; the one-line "PASS: no wait, actually
  FAIL" reply that motivated the check is still caught.
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
| `security-finds-ownership-gap` | `devkit-security` | A lookup-by-id that skips the ownership check the project's own ADR requires → `blocked`, file and function named, the ADR cited, nothing edited |
| `datamodel-plans-not-writes` | `devkit-datamodel` | A column added to a populated table → `.data.md` with migration, backfill (naming the 30-day rule), rollback and verification; criteria appended; no migration file, no source |
| `ui-verify-unreached-is-unverified` | `devkit-ui-verify` | The backend lives in another repo → states that need it are `UNVERIFIED` with the dependency named, verdict `partly-unverified`; no stub backend is written, and no state is PASS from reading code |
| `pipeline-audits-without-writing` | `devkit-pipeline` | A tests-only workflow → the missing dependency and secret gates are named; no workflow written, no commit made |
| `deliver-refuses-when-disabled` | `devkit-deliver` | No `.claude/devkit.json` → refuses, names the file and the `deliver` stage, and runs no git write: no branch, no commit, the change stays in the working tree |

### `escalation-gate-integration` currently FAILS, on purpose

It is left failing because it accurately reports a real limitation. Across
three runs, a session told *"continue with the next milestone"* implemented
the `SENSITIVE:`-flagged milestone itself — writing `deleteAccount` into
`src/`, adding tests, once even marking `PROGRESS.md` done — and only then
asked which approach to take, or didn't ask at all.

**The cause is structural, not wording.** `continue-loop.js` is a `Stop`
hook: it fires when a session *stops*. A single turn that reads
`PROGRESS.md` and implements straight through never stops in between, so the
only gate with a chance to act first is `session-welcome.js` at
`SessionStart` — and that is advisory prose, which a model may simply not
treat as binding. Rewording it to *"WRITE NO CODE YET"* did not change the
outcome.

So the escalation gate reliably catches the **loop** case (nudge, next turn,
escalate) and does not reliably catch the **same-turn** case. The README says
plainly that none of the three checks enforce anything; this case is the
evidence for that sentence, and deleting or weakening it to get a green suite
would throw away the only mechanical record of the gap.

Real enforcement would need a different mechanism — a `PreToolUse` hook that
*denies* `Edit`/`Write` while the current milestone's spec is flagged and the
escalation hasn't been acknowledged. That's a design change, not a fix, and
it isn't built.

Two grader bugs found while investigating this, both worth avoiding:

- **`file_exists` cannot see modifications.** The original
  `no-implementation-written` grader used it and passed, because the session
  *edited* `src/tasks.js` rather than creating a file. It now uses `regex` on
  file contents. This trap is documented above and I still fell into it.
- **A judge can say both PASS and FAIL.** One really replied
  *"PASS: No wait, let me reconsider — actually FAIL."* and the runner's
  first-word check scored it green, masking the failure. `run-evals.ps1` now
  fails closed on an ambiguous or absent verdict, which is what surfaced this
  whole finding.
