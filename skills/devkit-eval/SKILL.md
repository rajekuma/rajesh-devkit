---
name: devkit-eval
description: Runs this plugin's own regression suite and checks its prompt-based components for drift — the deterministic script tests in tests/run-tests.ps1, plus the invariants those tests can't reach (component boundaries, defined verdict lines, README claims that no longer match the code). Run it after editing any part of this plugin, before committing. Trigger phrases — "run the devkit tests", "eval the plugin", "check the plugin still works", "devkit regression".
model: sonnet
---

# Evaluate this plugin

This plugin edits other people's projects unattended. A regression here is
quiet by construction: a nudge that stops firing, a gate that stops matching,
a boundary an agent stops respecting. None of those announce themselves — the
loop just gets subtly worse, in someone else's repo.

There are two kinds of component here and they fail in different ways, so
check both.

## 1. The deterministic half — run the suite

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/tests/run-tests.ps1"
```

Covers the PowerShell hooks end-to-end: real processes, real exit codes, real
stderr, against throwaway fixture projects in `$env:TEMP`. Exit 0 means all
green; exit 1 prints each failure with its reason.

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
# The official runner. Works on macOS/Linux; on Windows it currently
# mangles the scaffold path (see tests/run-evals.ps1's header).
claude plugin eval . --scaffold --allow-tools Bash Write Edit --runs 1 --max-cost-usd 15
```

```powershell
# Windows bridge: same case files, driven through `claude -p --plugin-dir`.
powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-evals.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-evals.ps1 -Case 'ship-*' -KeepTemp
```

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
  `devkit-dep-audit`, `devkit-ship` and `devkit-help` must each still state
  that they don't modify files. That sentence disappearing is a real
  behavioral change.
- **Nothing has quietly acquired permission to commit.** No component in this
  plugin commits, pushes, tags, merges, or opens a PR — that's a deliberate
  property of the whole toolkit, stated in the README. Grep for it.
- **Every component that ends in a verdict still defines its exact verdict
  strings.** `devkit-reviewer` (ship / needs-changes / discuss) and
  `devkit-ship` (clear / blocked / clear-with-unknowns). The orchestrator
  routes on these; a reworded verdict silently breaks the routing.
- **The handoff chain is unbroken.** `devkit-specify` → (`devkit-ux` if there's
  a UI) → `devkit-implementer` → `devkit-reviewer` → `devkit-ship` →
  `devkit-docs`. Each component should name what precedes and follows it.
  Check `continue-loop.ps1`'s nudge messages name the same chain — the script
  and the prompts drifting apart is the most likely failure here, because
  they're edited at different times.
- **The escalation marker agrees everywhere.** `devkit-specify` writes it;
  `continue-loop.ps1` and `session-welcome.ps1` match it. If the written form
  and the matched form ever disagree, the gate fails open and silently. The
  suite covers the matching; you check that the skill still instructs writing
  the ASCII keyword.
- **Frontmatter `description` fields still carry trigger phrases.** That text
  is how the harness decides when to invoke a component; an edit that
  improves the prose while dropping the triggers makes a component
  unreachable without changing a line of its body.

## 4. Check the README hasn't drifted from the code

The README is long and documents real behavior — exit codes, state file
paths, hook conditions, matcher semantics. After any change to a script,
confirm the README still describes what the code does. A README that
confidently documents the previous behavior is worse than one that says
nothing, and this is the single most likely thing to be stale, because it's
the file furthest from the change.

## 5. Report

State plainly: suite result (passed/failed counts), any drift found in the
prompt components, and any README claim that no longer matches the code. If
everything is clean, say so in one line — don't pad it.

If you changed anything in this plugin, **re-run the suite afterward.** An
eval that only ran before the fix hasn't verified the fix.
