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

- `devkit-roadmap`, the component that bends the loop into a circle. Both
  boundaries were open: `devkit-onboard` decomposed milestones once and
  `PROGRESS.md` was hand-maintained forever, and nothing after release
  informed what to build next. The skill proposes the next Phase from four
  evidence sources - the shipped specs' `## Out of scope`, follow-ups whose
  unblock condition has been met, the gap to the vision document, and the
  production signal the repo records (issues, incidents, feedback files;
  never a live system) - with every candidate carrying its evidence. It
  interviews for the priority call, writes rows only on approval, and never
  starts a milestone. The empty-queue banner now points at it instead of
  saying "add a row when you have one".

- A licence pass in `devkit-dep-audit`. It found CVEs and nothing else, so
  a GPL dependency in a proprietary product passed clean. It now establishes
  the project's own posture first - its licence, whether it ships as a
  library or an application or a hosted service, any stated policy - then
  lists dependency licences with the ecosystem's own tooling (installing
  nothing, generating nothing) and flags Conflict, Needs a decision, and
  Unknown against that posture. A Conflict is a `needs-changes` verdict and
  a BLOCKED row in `devkit-ship`.

- Localisation in `devkit-ux`. It specified literal copy strings, which in a
  project whose rules say every user-visible string goes through `intl`
  meant the design stage was actively working against the project's own
  convention. It now detects the i18n mechanism the project actually has,
  specifies copy as key plus default text in that mechanism's plural and
  argument form, and appends localisation criteria the implementer,
  reviewer and ui-verify each check. A project with no mechanism gets plain
  copy and an open decision, never an i18n stack it didn't choose.

- `## Observability` and `## Performance budget` sections in the spec
  template, and `[observability]` / `[perf]` criterion markers that make them
  gated rather than read once. Nothing in the loop put a log line, a metric
  or a latency target into what shipped; a feature could pass every
  criterion and be undebuggable at 3am. `devkit-specify` asks the on-call
  question and the volume question explicitly, `devkit-implementer` emits
  through the project's existing mechanism and stops if there is none (that
  is an ADR, not a `console.log`), `devkit-reviewer` checks the named fields
  and the stated volume, and `devkit-quality` reviews against the budget
  instead of a number it invented.

- `devkit-release`, the `release` stage. `devkit-deliver` stopped at the
  PR and `devkit-docs` wrote one changelog entry per milestone; nothing
  decided a semver bump, rolled the entries into a version or wrote release
  notes. It runs at a Phase boundary, decides the bump with the evidence
  visible (a `SENSITIVE:` compatibility break in any shipped spec is a
  major whether the changelog said so or not), updates the version in every
  file that declares it, and ends with the `git tag` command without
  running it - tagging is the one git operation that stays human in every
  configuration, and a static test now fails if any component instructs it.

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

- `devkit-ui-verify` could satisfy "get the app running" by writing its own
  backend. Its eval caught a run that stood up a stub API to reach the
  empty, success and permission-denied states, reported them PASS, and
  returned `mismatches` over a leak in the 403 body its own stub produced.
  The rule now states the line: you may take a dependency away to induce a
  failure; you may never supply one. Reached through a stand-in is not
  reached, and "confirmed in markup" is a prediction, not an observation. A
  deterministic grader backs the llm judge, which had passed the run.

- `devkit-dep-audit` still described itself as complementing
  `claude-security` for code-level review; that role has been
  `devkit-security`'s since it was added.

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
