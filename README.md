# rajesh-devkit

A personal Claude Code plugin: one spec-drafting skill, one report-only reviewer
subagent, and two hooks that turn an unattended session into a milestone-driven
dev loop against any host project's `PROGRESS.md`.

## What this plugin is

- `devkit-specify` — an interactive skill that drafts a feature spec into
  `specs/<kebab-feature>.md`, reading the host repo's own code and `docs/adr/`
  first, then interviewing you one question at a time for anything it can't
  confidently infer.
- `devkit-reviewer` — a report-only subagent that diffs the current change
  against its spec and ends with a single verdict line.
- `continue-loop.ps1` (Stop hook) — when a session stops, checks the host
  project's `PROGRESS.md` for the next not-started milestone and, if one
  exists, blocks the stop with an instruction to implement it test-first and
  run the reviewer.
- `run-verify.ps1` (PostToolUse hook) — after every `Edit`/`Write`, runs the
  host project's own `.claude\verify.ps1` if it provides one.

Nothing here is specific to any one codebase — the skill, agent, and hooks
only assume a `specs/` folder and a `PROGRESS.md` with milestone rows, which
is a convention this plugin expects the host project to follow (see "What the
host project must provide" below).

**Why `devkit-` prefixed names.** Claude Code's component loader treats a
`name:` collision between two loaded components as an error ("all discovered
components register — name conflicts cause errors" per the plugin-structure
reference). A host project that already has its own `specify` skill or
`reviewer` agent — this plugin was itself modeled on one that does — would
collide with unprefixed names the moment this plugin was installed there. The
`devkit-` prefix means this plugin installs cleanly everywhere, including a
project that already has its own identically-purposed components under
different names, at the cost of typing `devkit-specify`/`devkit-reviewer`
instead of the shorter form. One residual thing worth knowing: the *trigger
phrases* in each description ("write a spec", "review the diff", etc.) still
overlap with a project's own similarly-described skill/agent if both are
installed at once — different `name:` avoids a load error, but doesn't
guarantee which one a natural-language trigger picks when two plausible
matches exist in the same project.

## Install

```bash
claude plugin marketplace add /c/Dev/dev-marketplace
claude plugin install rajesh-devkit@dev-marketplace --scope project
```

Run both from inside the host project's repo root (e.g. `MyHomeMaintenance`).
`--scope project` records the install in that repo's own Claude Code config,
so it only applies there — repeat the two commands in any other project you
want it in.

## Skills

| Name | Trigger | Model / effort | What it does |
|---|---|---|---|
| `devkit-specify` | "write a spec", "spec this feature", "specify \<feature\>", "draft a spec for \<feature\>", "let's spec \<feature\>" | `fable`, `effort: high` | Reads the relevant code and `docs/adr/`, interviews you one question at a time for anything it can't infer, writes `specs/<kebab-feature>.md`, then stops — never scaffolds implementation code itself. |

## Subagents

| Name | Model | Tools | Trigger | Verdict format |
|---|---|---|---|---|
| `devkit-dep-audit` | `haiku` | `Read, Bash, Glob, Grep` | "audit dependencies", "check for vulnerable packages", "scan dependencies for CVEs", "dependency security check" | Report-only. Runs `dotnet list package --vulnerable --include-transitive` (NuGet) and `osv-scanner --recursive` (pub/Dart, and NuGet lock files too if present) — both back onto the GitHub Advisory Database / osv.dev, which aggregate NVD/CVE entries alongside ecosystem-specific advisories. Reports coverage (what was and wasn't scanned, and why), a findings table, then:<br>**Verdict: ship** — everything present was scanned, no Critical/High findings.<br>**Verdict: needs-changes** — a Critical/High finding exists.<br>**Verdict: discuss** — an ecosystem present couldn't be scanned (tool missing, no lock file) so coverage is incomplete.<br>This checks *known-vulnerable dependency versions* only — it's not a substitute for `claude-security` or any other code-level vulnerability scan; install that separately if you want both (see "Security tooling" below). |
| `devkit-reviewer` | `haiku` | `Read, Bash, Glob, Grep` | "review the diff", "review against the spec" | Report-only — never edits files. Maps every acceptance criterion in the matched spec to the diff (Met / Not Met / Partially Met with file/line evidence), lists correctness risks, out-of-scope changes, and convention violations, then ends with exactly one of:<br>**Verdict: ship** — criteria met, no material risks.<br>**Verdict: needs-changes** — unmet criteria or correctness risks found.<br>**Verdict: discuss** — ambiguity needing the owner's judgment.<br>Followed by one line: files reviewed (count) and diff size (lines added/removed). |

## Hooks

| Event | Matcher | Script | Trigger condition | Blocking behaviour |
|---|---|---|---|---|
| `Stop` | *(none — Stop doesn't support matchers)* | `scripts/continue-loop.ps1` | Fires on every session stop. No-ops (exit 0) if: the harness reports `stop_hook_active` (already mid-continuation); the host project has its own `.claude/skills/spec-loop/SKILL.md` (deferred to entirely — see below); no `PROGRESS.md` exists; no not-started milestone is found; or the same milestone has already been nudged 8 times (runaway-loop guard, counter kept in `%TEMP%\rajesh-devkit-continue-loop`, keyed per project + milestone). | Otherwise **exit 2** — writes the next milestone name to stderr with an instruction to implement it test-first (RED-GREEN, one acceptance criterion at a time) and then invoke `devkit-reviewer` on the diff before treating it as done. Exit 2 on a Stop hook blocks the stop and feeds that stderr text back to Claude as the reason to keep going. |
| `PostToolUse` | `Edit\|Write` | `scripts/run-verify.ps1` | Fires after every Edit or Write tool call. | If `.claude\verify.ps1` doesn't exist in the host project, exits 0 silently (no-op). If it exists, runs it and **exits with whatever code it returned** — no remapping. `verify.ps1`'s own exit-code convention is what decides whether Claude sees the failure (see the contract below). |

### Why the Stop hook defers to a project's own loop skill

If a host project already has a milestone-loop skill (like the `spec-loop`
skill this was modeled after), that skill owns its own stop conditions
deliberately — a reviewer `discuss` verdict, a Phase-boundary pause, a genuine
ambiguity. An unconditional Stop hook has no way to tell "the skill chose to
pause here on purpose" from "the session just stopped" — it would nudge past
exactly the pauses the skill built in. So `continue-loop.ps1` checks for
`.claude\skills\spec-loop\SKILL.md` first and gets out of the way entirely if
it's there, acting only as a fallback for projects that don't have an
equivalent skill of their own.

## What the host project must provide

**`PROGRESS.md` milestone format.** `continue-loop.ps1` scans top to bottom
for the first line matching either:

- A markdown table row with a not-started glyph in a cell by itself:
  `| <#> | <milestone name> | ⬜ |` (also recognises `⏳`) — matches this
  plugin's originating project's per-Phase tables.
- A plain markdown task item: `- [ ] <text>`.

Whichever pattern appears first, top to bottom, in the file wins. If neither
pattern matches anywhere, the hook treats the project as having nothing left
to do and stays silent.

**`.claude\verify.ps1` contract.** Optional. If present, it's invoked with no
arguments after every Edit/Write and its exit code is passed straight through
by `run-verify.ps1`. Claude Code only treats **exit code 2** from a
PostToolUse hook as "surface this to Claude" — so if you want a failing verify
step to actually get Claude's attention, `verify.ps1` itself should exit `2`
on failure (any output on its own stdout/stderr passes through unchanged,
since `run-verify.ps1` doesn't redirect it). Any other non-zero code still
propagates but isn't guaranteed the same treatment. A typical `verify.ps1`
runs the project's fast checks — lint, a quick test subset, a build — and
should stay fast, since it runs after *every* edit.

## Security tooling

`devkit-dep-audit` (above) only answers one question: does a dependency you
pulled in already have a public CVE/advisory against it? It does not look for
flaws in the code you wrote yourself — injection, auth bugs, hardcoded
secrets, logic errors. For that, install Anthropic's official
[`claude-security`](https://claude.com/product/claude-security) plugin
separately (from the marketplace you already have registered):

```bash
claude plugin install claude-security@claude-plugins-official
```

The two are complementary, not overlapping — run both if you want real
coverage before something ships. Neither replaces GitHub Dependabot alerts if
the repo lives on GitHub: Dependabot runs continuously with no session or
agent involved, which is worth enabling regardless (Settings → Code security
→ Dependabot alerts, or `gh api` — see your host project's own setup notes).

## Troubleshooting

- **The Stop hook never fires.** Check `$env:CLAUDE_PROJECT_DIR` is set (the
  harness sets it automatically) and that `PROGRESS.md` exists at that root,
  not in a subfolder. Confirm the plugin is actually installed for this
  project: `claude plugin list`.
- **The Stop hook keeps firing on the same milestone.** That's the 8-nudge
  cap working as intended once it stops — check
  `%TEMP%\rajesh-devkit-continue-loop\<hash>.json` for the current count, and
  delete that file to reset it once you've actually made progress.
- **The Stop hook fires even though I'm running my own loop skill.** Confirm
  the skill file is exactly at `.claude\skills\spec-loop\SKILL.md` relative to
  the project root — a differently-named or differently-located loop skill
  isn't detected, by design (this plugin can't guess every possible name).
- **`run-verify.ps1` does nothing.** By design, unless
  `.claude\verify.ps1` exists in the host project. Create it if you want the
  edit-time check.
- **PowerShell execution policy errors.** Both hooks are declared in exec
  form (`"command": "powershell.exe"`, `"args": [...]`) with
  `-NoProfile -ExecutionPolicy Bypass -File`, specifically so a locked-down
  IT execution policy doesn't block them. If you still see a policy error,
  confirm nothing upstream (a system-wide `AllSigned` policy via Group Policy)
  overrides `-ExecutionPolicy Bypass` at the machine level — that one flag
  can't override a Group-Policy-enforced restriction.
- **Marketplace add fails on the relative path.** `dev-marketplace`'s
  `marketplace.json` points at `rajesh-devkit` with `"source": "../rajesh-devkit"`,
  which assumes the two folders stay siblings. If you move either one,
  update that path (or switch it to an absolute path).
