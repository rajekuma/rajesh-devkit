# Changelog

All notable changes to this plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver as `devkit-release` applies it (a removed or renamed component, stage
or verdict string is breaking; a new component or stage is a feature; a fix
to an existing one is a patch).

The plugin dogfoods its own loop: this file is the one `devkit-docs` writes
an entry into and `devkit-release` rolls into a version. Entries say what
changed and *why* - the failure it prevents - because the why is what a
reader six months from now cannot recover from the diff.

## [Unreleased]

### Added

- `devkit-quality`, a report-only agent for the review the spec cannot ask
  for: design and performance. `devkit-reviewer` checks the change against
  its spec and `devkit-security` checks it for vulnerabilities; nothing
  checked whether it was built well enough to stay changeable or would hold
  at the volume the spec describes. It reads the project's own architecture
  rules and performance budgets first so a finding cites a rule the project
  wrote, works layering drift, duplication of logic, a class becoming the
  place everything goes, N+1 and unbounded reads, and marks matters of
  taste advisory so they never change the verdict. Wired as the `quality`
  stage (after `review`, before `security`) and as a `devkit-ship` row.

- Two more test-layer markers, `[contract]` and `[e2e]`, beside
  `[integration]`. The spec vocabulary had one marker, so a criterion that
  is really an agreement with a separately deployed client - the mobile app
  parsing this response - got marked `[integration]` and satisfied by a
  database-backed test that never left the process and never saw the client
  that will break. `devkit-specify` marks, `devkit-implementer` proves at
  that layer or stops (a project with no contract mechanism gets a finding,
  not a unit test dressed as one), `devkit-reviewer` checks what the test
  actually runs against.

- Behavioral evals for the five components that had none: `devkit-security`,
  `devkit-datamodel`, `devkit-ui-verify`, `devkit-pipeline` and
  `devkit-deliver`. `devkit-eval` is the drift check, and the five newest
  components were the five it couldn't see. Each case locks in the
  component's load-bearing rule with deterministic graders: security cites
  the project's own ADR and edits nothing; datamodel plans and writes no
  migration; ui-verify reports an unreachable state as UNVERIFIED rather
  than reading the template and calling it fine; pipeline names the missing
  gates without writing a workflow; deliver refuses when the stage is off.

- The `SessionStart` banner names the gate stages (`review`, `security`,
  `ship`) a configured loop has switched off while `implement` is on. A
  narrow loop is legitimate, but the config file made "deliberately gates in
  the PR" and "forgot" look identical, and because the UNKNOWN-never-PASS
  rule lives inside `devkit-ship`, switching ship off removed the one place
  an unrun check would have been reported. One sentence, once per session,
  never blocking; `skippedGates()` in `scripts/lib/devkit.js` is the rule.

### Fixed

- `devkit-deliver` stated it was off unless the `deliver` stage was enabled
  but had no step that read `.claude/devkit.json` - only the Stop hook
  honoured the config, so a person invoking it by name got commits
  regardless. Found while writing its eval. Precondition 0 now reads the
  config with the hooks' precedence, treats a missing or malformed file as
  off, and stops before any git write.

- `devkit-ship` now has a gate row for every report-only stage that runs
  before it. `devkit-datamodel`, `devkit-ui-verify` and `devkit-security`
  each produced a result, and only security's reached ship's table - the
  other two were reports somebody had to remember to read. The **Data model**
  row checks the plan against the diff: the migration the plan names must be
  in the change (the exact shape of the M13 failure, where an entity changed
  and no migration ever existed) and `## Rollback` must say something. The
  **UI states** row routes on `devkit-ui-verify`'s verdict strings. Both
  follow the existing rule - a stage that hasn't run is `UNKNOWN`, a stage
  that doesn't apply is `PASS (not applicable)` with the reason stated.
  `devkit-ui-verify` and `devkit-datamodel` now say what consumes their
  output, and the Stop hook's ship nudge says ship reads the other verdicts.

- `docs/SDLC.md` described a six-stage loop and stated that nothing in the
  plugin commits, pushes or tags, a full day after `devkit-deliver`,
  `devkit-datamodel`, `devkit-security`, `devkit-ui-verify` and
  `devkit-pipeline` all existed. The diagram, the stage table and the
  walkthrough steps now cover all eleven stages, the "not automated" section
  states the `deliver` exception precisely, and the test/eval counts that
  went stale twice are gone in favour of pointing at where the real numbers
  live. A new static test fails when any agent, skill or stage name is
  missing from either the README or the walkthrough, so the drift is
  mechanical from here on. `devkit-eval`'s drift checklist names SDLC.md
  alongside the README and lists the full handoff chain.

## [0.2.0] - 2026-09-18

The state of the plugin at the start of this changelog: eleven agents, six
skills, four hooks, a configurable stage list, and the end-to-end walkthrough
in `docs/SDLC.md`. Earlier history is in `git log`, whose messages carry the
reasoning this file continues.
