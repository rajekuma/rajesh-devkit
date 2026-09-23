---
name: devkit-eval
description: Runs this plugin's own regression suite and checks its prompt-based components for drift — the deterministic hook tests run by `node --test`, plus the invariants those tests can't reach (component boundaries, defined verdict lines, README claims that no longer match the code). Run it after editing any part of this plugin, before committing. Trigger phrases — "run the devkit tests", "devkit eval", "devkit regression".
model: inherit
---

# Evaluate this plugin

This plugin edits other people's projects unattended. A regression here is
quiet by construction: a nudge that stops firing, a gate that stops matching,
a boundary an agent stops respecting. None of those announce themselves — the
loop just gets subtly worse, in someone else's repo.

There are two kinds of component here and they fail in different ways, so
check both.

## 1. The deterministic half — run the suite

```bash
node --test
```

Run from the plugin root. `node:test` is built in — no Pester, no npm
install, nothing to set up, and it runs on Windows, macOS and Linux alike.
(Note: `node --test tests/` fails on Node 22, which treats the directory as
a module path; bare `node --test` auto-discovers `*.test.js`.)

Covers the hooks end-to-end: real processes, real exit codes, real stderr,
against throwaway fixture projects under the OS temp dir. Exit 0 means all
green; a failure prints the assertion and its location.

**If something fails, diagnose before you fix.** The suite has already caught
one genuine latent bug (a 4-byte emoji literal in a `.ps1`) and one vacuous
test (a culture-sensitive `StartsWith` that silently matched everything). Both
looked identical from the summary line. Ask which you have — a test asserting
the wrong thing is its own bug, and "fixing" the product to satisfy it makes
things worse.

Never edit a test purely to make it pass. That's the same rule
`devkit-implementer` follows, and for the same reason.

## 2. The prompt half — run the behavioral evals

The agents and skills are prompts, so the only way to know whether
`devkit-specify` still marks a schema change `SENSITIVE:` is to run it
against a repo with a schema change and look. `evals/` holds one case per
component (see `evals/README.md`): each scaffolds a throwaway fixture
project, runs the component in an isolated session, and grades what was
actually written and which tools actually ran.

```bash
# One command on any OS: dispatches to the official runner on macOS/Linux,
# or to the Windows bridge script (tests/run-evals.ps1) on Windows, where
# claude plugin eval currently can't grant Bash to a case at all.
node tests/run-evals.js
node tests/run-evals.js --case 'ship-*' --keep-temp
```

Calling either underlying runner directly still works, if you need its full
flag set:

```bash
# The official runner, called directly. Works on macOS/Linux; on Windows it
# can't confine a Bash-granting run yet (see tests/run-evals.ps1's header).
claude plugin eval . --scaffold --allow-tools Bash Write Edit --runs 1 --max-cost-usd 15
```

On Windows, never start `tests\run-evals.ps1` by hand: a machine with an
`AllSigned` execution policy refuses it outright. `node tests/run-evals.js`
is the only entry point you need there — it passes the bridge a per-process
policy exception, and every flag the bridge takes (`--case`, `--keep-temp`,
`--judge-model`) is accepted by the Node entry point too.

Every run is a real Claude session on the user's credential — say so before
starting, and use `-Case` to run only what the edit could have affected.
If a child session reports "Failed to authenticate", the `claude` CLI's own
login has lapsed (it's separate from the desktop app's): the user runs
`claude login`; nothing here can do that for them.

Same rule as the script suite: **a failing grader is a question, not an
instruction.** Read the kept trace before deciding whether the component
regressed or the grader is asserting the wrong thing.

## 3. The prompt half — structural drift no eval catches

Some invariants decay silently when a file gets edited and don't show up as
a failed case. Read each component and verify:

- **Report-only components still say so.** `devkit-reviewer`,
  `devkit-quality`, `devkit-security`, `devkit-ui-verify`,
  `devkit-dep-audit`, `devkit-ship` and `devkit-help` must each still state
  that they don't modify files. That sentence disappearing is a real
  behavioral change.
- **Nothing has quietly acquired permission to commit.** `devkit-deliver` is
  the **only** component allowed to touch git, and only when the `deliver`
  stage is enabled. Every other component is read-only or writes solely to
  the working tree. Grep for `git commit`, `git push`, `gh pr create` outside
  `devkit-deliver`; a second component gaining them is a real regression, and
  a silent one.
- **Nothing tags, in any configuration.** `devkit-release` prepares a
  release and ends with the tag command for a human; `devkit-deliver`
  commits and pushes branches but never tags. Grep for `git tag` outside a
  sentence that says "never" or shows the command as output; a component
  that runs it has crossed the one line even `deliver` doesn't.
- **`deliver` is still off by default.** `DEFAULT_STAGES` in
  `scripts/lib/devkit.js` must continue to exclude it. Installing this plugin
  must never be sufficient to grant commit-and-push in someone's repository —
  that has to be an explicit choice, per project.
- **`devkit-deliver` still refuses the irreversible operations.** Enabling
  the stage is standing permission for the normal flow (branch, commit, push
  a feature branch, open a PR) and never for force-push, pushing to a default
  branch, merging, deleting a branch, or rewriting history. Those prohibitions
  disappearing from its body is the highest-severity drift in this plugin.
- **Every component that ends in a verdict still defines its exact verdict
  strings.** `devkit-reviewer` (ship / needs-changes / discuss),
  `devkit-quality` (clean / needs-changes / discuss), `devkit-security`
  (clear / blocked / clear-with-unknowns), `devkit-ui-verify` (matches /
  mismatches / partly-unverified) and `devkit-ship` (clear / stale / blocked
  / clear-with-unknowns). The orchestrator and `devkit-ship` route on these;
  a reworded verdict silently breaks the routing.
- **A stale verdict is never a pass.** `devkit-ship` must still say that a
  verdict stamped against a tree that has since changed, or one with no
  stamp at all, is `STALE` — and `continue-loop.js`'s `downstream()` must
  still say that applying a gate's findings means re-running the gates.
  Losing either puts the loop back to treating a verdict about old code as
  current, which is how M28 nearly shipped over two unreviewed edits.
- **The handoff chain is unbroken.** `devkit-specify` → (`devkit-ux` if
  there's a UI) → (`devkit-datamodel` if stored data changes) →
  `devkit-implementer` → (`devkit-ui-verify` if there's a UI) →
  `devkit-reviewer` → `devkit-quality` → `devkit-security` → `devkit-ship` →
  `devkit-docs` → (`devkit-release` at a Phase boundary) →
  (`devkit-pipeline`) → (`devkit-deliver`, opt-in). Each component should
  name what precedes and follows it. Check `continue-loop.js`'s `downstream()`
  names the same chain in the same order, and that `ALL_STAGES` in
  `scripts/lib/devkit.js` has one entry per stage — the script and the
  prompts drifting apart is the most likely failure here, because they're
  edited at different times.
- **`devkit-ship` consumes every verdict the chain produces.** Its gate
  table must have a row for each report-only stage that runs before it
  (`security`, `quality`, `ui-verify`, `datamodel`), each following the same rule: a
  verdict in the conversation is used, a stage that hasn't run is `UNKNOWN`,
  a stage that doesn't apply is `PASS (not applicable)` with the reason.
  A new verdict-producing component that ship doesn't know about is a
  report somebody has to remember to read, which is the failure ship exists
  to prevent.
- **The escalation marker agrees everywhere.** `devkit-specify` writes it;
  `continue-loop.js` and `session-welcome.js` match it. If the written form
  and the matched form ever disagree, the gate fails open and silently. The
  suite covers the matching; you check that the skill still instructs writing
  the ASCII keyword.
- **Frontmatter `description` fields still carry trigger phrases.** That text
  is how the harness decides when to invoke a component; an edit that
  improves the prose while dropping the triggers makes a component
  unreachable without changing a line of its body.

## 4. Check the README and docs/SDLC.md haven't drifted from the code

The README is long and documents real behavior — exit codes, state file
paths, hook conditions, matcher semantics. After any change to a script,
confirm the README still describes what the code does. A README that
confidently documents the previous behavior is worse than one that says
nothing.

`docs/SDLC.md` is worse-placed still: it is the file newcomers are pointed
at, and the file furthest from any change. It once stated "nothing commits,
pushes, tags" as a property of the whole toolkit for a full day after
`devkit-deliver` existed, and drew a six-stage loop while the code had
eleven. The static suite now fails when a component or stage name is absent
from either document, but it cannot check a *claim* — read the "What is
deliberately not automated" and "The loop at a glance" sections against the
code every time a component is added or a boundary moves. `CHANGELOG.md`
at the plugin root lists what changed and why; if the entry you are about to
write there contradicts a sentence in either document, that sentence is the
bug.

## 5. Report

State plainly: suite result (passed/failed counts), any drift found in the
prompt components, and any README claim that no longer matches the code. If
everything is clean, say so in one line — don't pad it.

If you changed anything in this plugin, **re-run the suite afterward.** An
eval that only ran before the fix hasn't verified the fix.
