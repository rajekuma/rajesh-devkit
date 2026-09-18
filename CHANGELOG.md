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

- The `SessionStart` banner names the gate stages (`review`, `security`,
  `ship`) a configured loop has switched off while `implement` is on. A
  narrow loop is legitimate, but the config file made "deliberately gates in
  the PR" and "forgot" look identical, and because the UNKNOWN-never-PASS
  rule lives inside `devkit-ship`, switching ship off removed the one place
  an unrun check would have been reported. One sentence, once per session,
  never blocking; `skippedGates()` in `scripts/lib/devkit.js` is the rule.

### Fixed

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
