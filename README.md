# rajesh-devkit

A personal Claude Code plugin: a full spec→implement→review→dependency-audit
dev loop, stack-agnostic by design — it infers a project's own layout, test
runner, and package ecosystem rather than assuming .NET/Flutter or any other
specific stack. Two hooks turn it into a milestone-driven *unattended* loop
against any host project's `PROGRESS.md`, if it has one.

## What this plugin is

- `devkit-specify` — an interactive skill acting as product owner: drafts a
  feature spec into `specs/<kebab-feature>.md`, reading the host repo's own
  code and decision-record docs first, then interviewing you one question at
  a time for anything it can't confidently infer.
- `devkit-implementer` — implements one spec test-first (RED-GREEN), one
  acceptance criterion at a time, detecting whatever test runner the project
  actually uses (`npm test`, `pytest`, `dotnet test`, `flutter test`, `go
  test`, `cargo test`, ...) instead of assuming one.
- `devkit-reviewer` — a report-only subagent that diffs the current change
  against its spec and ends with a single verdict line.
- `devkit-dep-audit` — a report-only subagent that checks the project's
  dependencies for known-vulnerable versions, across whichever package
  ecosystems are actually present (npm, PyPI, NuGet, pub, Go, Cargo, Maven, ...).
- `continue-loop.ps1` (Stop hook) — when a session stops, checks the host
  project's `PROGRESS.md` for the next not-started milestone and, if one
  exists, blocks the stop with an instruction to draft a spec first (if none
  exists yet) or implement it test-first and run the reviewer (if one does).
- `run-verify.ps1` (PostToolUse hook) — after every `Edit`/`Write`, runs the
  host project's own `.claude\verify.ps1` if it provides one.
- `track-milestones.ps1` (PostToolUse hook) — after every `Edit`/`Write`,
  detects any milestone that just flipped to done in `PROGRESS.md` and logs
  a timestamped "shipped" event, pairing with the "started" event
  `continue-loop.ps1` already logs.
- `session-welcome.ps1` (`SessionStart` hook) — greets a new session with
  what's next: the bootstrap checklist if `PROGRESS.md` doesn't exist yet,
  or the next milestone's status otherwise.
- `devkit-help` — the on-demand, verified version of the same check, for
  when you'd rather ask than wait for the automatic banner.
- `devkit-stats` — a skill that reports real duration, real USD cost, and a
  heuristic manual-effort comparison per milestone from that local telemetry
  log (see "Telemetry" below).

Nothing here is specific to any one codebase or language. The skill and
agents infer a project's layout, conventions, test runner, and dependency
ecosystems from what's actually in the repo (`CLAUDE.md`, `.claude/rules/`,
marker files like `package.json`/`pyproject.toml`/`*.csproj`/`pubspec.yaml`) —
the one convention this plugin does expect, and cannot infer, is a
`PROGRESS.md` with milestone rows, and only the two hooks depend on that (see
"What the host project must provide" below). The skill and subagents work
with or without one.

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

## Repository layout

```
rajesh-devkit/
├── .claude-plugin/
│   └── plugin.json              # name, version, description, author, license
├── agents/
│   ├── devkit-dep-audit.md      # dependency CVE audit, report-only
│   ├── devkit-implementer.md    # RED-GREEN implementer, stack-agnostic
│   └── devkit-reviewer.md       # spec-compliance review, report-only
├── skills/
│   ├── devkit-specify/
│   │   └── SKILL.md             # spec-drafting, product-owner style
│   ├── devkit-help/
│   │   └── SKILL.md             # on-demand "what's next" (verified SessionStart fallback)
│   └── devkit-stats/
│       └── SKILL.md             # timing + real cost + heuristic effort report
├── hooks/
│   └── hooks.json               # SessionStart -> session-welcome.ps1
│                                 # Stop -> continue-loop.ps1
│                                 # PostToolUse (Edit|Write) -> run-verify.ps1, track-milestones.ps1
├── scripts/
│   ├── continue-loop.ps1        # Stop hook: nudge toward next milestone
│   ├── run-verify.ps1           # PostToolUse hook: host project's verify.ps1
│   ├── track-milestones.ps1     # PostToolUse hook: log milestone-shipped events
│   ├── session-welcome.ps1      # SessionStart hook: "what's next" banner
│   └── token-report.ps1         # not a hook - invoked by devkit-stats on demand;
│                                 # scans session transcripts for real cost/tokens
└── README.md
```

Installed elsewhere as a git submodule at `dev-marketplace/plugins/rajesh-devkit`
(see "Install" below) — a real git checkout of this same repo pinned to one
commit, not a duplicated copy of the files. It needs an explicit sync after
changes here (see Troubleshooting), it doesn't track this repo live.

## Install

```bash
claude plugin marketplace add /c/Dev/dev-marketplace
claude plugin install rajesh-devkit@dev-marketplace --scope project
```

Run both from inside the host project's repo root (e.g. `MyHomeMaintenance`).
`--scope project` records the install in that repo's own Claude Code config,
so it only applies there — repeat the two commands in any other project you
want it in.

## Getting started in a brand-new project

This is the full sequence, from an empty folder to the loop nudging you
toward milestone 1. Steps 1-2 are collaborative conversation, not commands —
don't skip them by jumping straight to `PROGRESS.md`, since everything after
depends on them.

1. **`git init`** in the project folder.
2. **Talk through the product intent with Claude** — what this actually is,
   who it's for, what it deliberately isn't. This is a conversation, not
   something any skill here automates (`CLAUDE.md` is about conventions, not
   intent — keep them separate). Save the result somewhere like
   `docs/product_vision.md`.
3. **Run `claude init`** to generate/update `CLAUDE.md` from the repo as it
   stands (even a near-empty scaffold is fine — it's meant to grow, not be
   complete on day one). Point it at the vision doc from step 2 in a
   "where the detail lives" table, since `devkit-specify` reads `CLAUDE.md`
   first.
4. **Break the vision into milestones and write `PROGRESS.md`** — a table
   per phase, every row starting unstarted:

   ```markdown
   ## Phase 1 — <name>

   | # | Milestone | Status |
   |---|---|---|
   | 1 | <name> | ⬜ |
   | 2 | <name> | ⬜ |
   ```

   This is the one file the plugin's hooks actually require. Everything
   before this step is prep; this step is what the loop reads.
5. *(Optional)* **Seed `docs/adr/`** if any big, hard-to-reverse decisions
   are already made (a datastore choice, an auth mechanism). Not required
   to start — `devkit-specify` checks for this folder and reads whatever's
   there, but there's no auto-created ADR template the way there is for
   specs, so write the first one by hand (or ask Claude to draft it) to
   establish the format.
6. **Install the plugin** (the two commands above).
7. **Start a session** (or say "how do I use this plugin" / "what's next"
   any time). The `SessionStart` hook checks project state automatically —
   if `PROGRESS.md` doesn't exist yet, it repeats steps 2-5 as a checklist;
   if it does, it names the next unstarted milestone and tells you whether
   it needs a spec first. `devkit-help` is the on-demand version of the same
   check, in case the automatic banner doesn't show up the way you'd expect
   in your setup (see Troubleshooting).

## Creating the first spec, then starting the dev loop

Once the milestone queue exists, there is no separate "start the loop"
command — the `Stop` hook nudges automatically the next time a session
pauses. The one thing worth doing deliberately first:

1. **Say "spec this feature: `<milestone name>`"** (or just "spec this
   feature" and name it when asked) — invokes `devkit-specify`, which reads
   the repo and `CLAUDE.md` first, interviews you for anything it can't
   infer, and writes `specs/<kebab-case-feature>.md`.
2. **Once the spec exists, either say "implement it"** (invokes
   `devkit-implementer` directly), **or just keep working and let the
   session pause naturally** — `continue-loop.ps1` checks for that spec
   before nudging, so from here on it tells you to implement with strict
   TDD and then invokes `devkit-reviewer`, rather than nudging toward a spec
   that doesn't exist yet.
3. **From here it's genuinely a loop**, not a one-shot: once `devkit-
   reviewer` gives a `ship` verdict and `PROGRESS.md`'s row flips to `✅`,
   the next session pause nudges toward the *next* milestone — spec first
   if it needs one, implement directly if it already has one. Run
   `devkit-stats` any time to see real duration/cost and the heuristic
   effort comparison so far.

## Adding to an existing project (already has code, or cloned from GitHub)

The install commands are identical to the brand-new-project case — the
difference is what to check *before* installing, because an existing repo
usually already has some (or all) of what the brand-new walkthrough builds
from scratch, and blindly repeating those steps risks clobbering or
duplicating it.

1. **Inventory what already exists, before touching anything.** Ask Claude
   directly: *"Search this project's `.claude` folder (and
   `%USERPROFILE%\.claude`) for any existing skills, subagents, commands, or
   hooks, and check for `CLAUDE.md`, a `specs/` folder, `docs/adr/`, and any
   milestone/roadmap tracking file (`PROGRESS.md`, `ROADMAP.md`, `TODO.md`,
   GitHub Issues/Projects) — list what's there before we go further."* This
   is exactly the inventory step this plugin itself started from — a
   30-second check that avoids every collision risk below.
   - **A same-named skill/agent already exists** (e.g. a project that
     already has its own `specify` or `reviewer`) — this plugin's `devkit-`
     prefix means it won't collide (see "Why `devkit-` prefixed names"
     above), but confirm there isn't already a `devkit-`-prefixed one from
     a previous install.
   - **A `.claude/skills/spec-loop/SKILL.md`-shaped skill already exists** —
     `continue-loop.ps1` defers to it entirely and never fires (see "Why
     the Stop hook defers to a project's own loop skill"). Not a problem,
     just don't expect the automatic nudge if this project already has its
     own loop.
2. **`CLAUDE.md` already exists.** Review it first. Running `claude init`
   again should read and refine what's there rather than blindly overwrite
   it — but this hasn't been independently verified against every version,
   so skim the diff afterward rather than trusting it blind. If there's no
   `CLAUDE.md` at all despite real code existing, this is exactly the case
   `claude init` is built for — it has an actual codebase to learn from,
   unlike the brand-new-project case where it produces something thin.
3. **Product intent is probably already documented somewhere** — a
   `README.md`, a wiki, an existing `docs/` folder, even just commit
   history and open issues. Don't start the product-intent conversation
   from zero: ask Claude to read what already exists and summarize its
   understanding back to you for correction, then save the confirmed
   version to `docs/product_vision.md` (or wherever this project already
   keeps that kind of doc — match its existing convention rather than
   imposing a new one).
4. **`PROGRESS.md` — the real judgment call for a project with history.**
   Two honest options, pick based on how much you value complete history
   versus getting the loop running quickly:
   - **Lightweight (faster):** start `PROGRESS.md` now with only
     upcoming/planned milestones as rows, and one short prose note at the
     top along the lines of "existing functionality (auth, the X module,
     ...) predates this tracker and isn't retroactively itemized here." The
     loop only cares about unstarted rows going forward.
   - **Thorough (more complete, more upfront work):** retroactively write a
     row — optionally backed by a retroactive spec written from the actual
     existing code — for each major already-shipped feature, marked `✅`
     from day one. This is a real, working pattern (a project this plugin
     was itself modeled on did exactly this: "started writing one
     retroactive spec per milestone from the actual code, for future
     reference"), but it's genuinely more work before the loop does
     anything new.
5. **`docs/adr/` — backfill only what's actually load-bearing.** If a past
   decision is still shaping how you'd implement new milestones (a datastore
   choice, an auth mechanism already baked into the codebase), write it down
   now so `devkit-specify` doesn't contradict it later. Skip decisions that
   don't actually constrain anything going forward.
6. **Install** (same two commands as the brand-new-project case):

   ```bash
   claude plugin marketplace add /c/Dev/dev-marketplace
   claude plugin install rajesh-devkit@dev-marketplace --scope project
   ```

7. From here, it's the same as any project: the `SessionStart` banner (or
   `devkit-help` on demand) tells you what's next, and "Creating the first
   spec, then starting the dev loop" above applies unchanged.

One reassurance worth stating plainly for a repo that already has its own
git remote, CI, and branch protections: nothing in this plugin commits,
pushes, or touches git config on its own. `devkit-implementer` explicitly
leaves its work uncommitted unless told otherwise (the working tree is its
own checkpoint) — everything that touches the remote stays your explicit
action.

## Skills

| Name | Trigger | Model / effort | What it does |
|---|---|---|---|
| `devkit-specify` | "write a spec", "spec this feature", "specify \<feature\>", "draft a spec for \<feature\>", "let's spec \<feature\>" | `fable`, `effort: high` | Learns the repo's own layout and conventions (`CLAUDE.md`, `.claude/rules/`, whatever decision-record folder it finds) before reading the relevant code, interviews you one question at a time for anything it can't infer, writes `specs/<kebab-feature>.md`, then stops — never scaffolds implementation code itself. |
| `devkit-help` | "how do I use this plugin", "devkit help", "get me started", "what's next", "getting started with rajesh-devkit" | `haiku` | Runs the same state check as the `SessionStart` hook (below) and relays it conversationally — the verified on-demand fallback for the automatic banner. Read-only. |
| `devkit-stats` | "show dev loop stats", "how long did each milestone take", "milestone timing report", "devkit stats", "how much did this cost", "token usage report" | `haiku` | Reads the local telemetry log, pairs each milestone's started/shipped events, and reports real duration, real USD cost (via `token-report.ps1`'s transcript scan), and a heuristic manual-effort/speedup comparison per milestone (see "Telemetry" below for what's measured vs. estimated). Read-only. |

## Subagents

| Name | Model | Tools | Trigger | Verdict format |
|---|---|---|---|---|
| `devkit-implementer` | `sonnet` | `Read, Write, Edit, Bash, Glob, Grep` | "implement the spec", "build the next milestone", "implement \<feature\>" | Not report-only — writes code and tests. Detects the project's test runner from marker files (`package.json`→`npm test`, `pytest.ini`/`pyproject.toml`→`pytest`, `*.csproj`/`*.sln`→`dotnet test`, `pubspec.yaml`→`flutter test`, `go.mod`→`go test`, `Cargo.toml`→`cargo test`) instead of assuming one. Implements one acceptance criterion at a time, RED then GREEN, never loosening a test to make it pass. Checkpoints ticks into the spec and a `PROGRESS.md` `## In flight` block if the project has that convention; skips it if not. Reports back criteria covered, tests added, full-suite status, and a performance snapshot (criteria/run, suite duration, anything that cost time without progress) — never invokes the reviewer itself. |
| `devkit-dep-audit` | `haiku` | `Read, Bash, Glob, Grep` | "audit dependencies", "check for vulnerable packages", "scan dependencies for CVEs", "dependency security check" | Report-only. Detects whichever package ecosystems are present (npm/yarn/pnpm, PyPI, NuGet, pub/Dart, Go, Cargo, Maven, ...) from marker files, then runs `osv-scanner --recursive` as the universal pass (covers most ecosystems in one command) plus ecosystem-native fallbacks (`dotnet list package --vulnerable`, `npm audit`, `pip-audit`) only where the universal pass can't reach (e.g. NuGet without a lock file) — all backed by the GitHub Advisory Database / osv.dev, which aggregate NVD/CVE entries alongside ecosystem-specific advisories. Reports coverage (what was and wasn't scanned, and why), a findings table, then:<br>**Verdict: ship** — everything present was scanned, no Critical/High findings.<br>**Verdict: needs-changes** — a Critical/High finding exists.<br>**Verdict: discuss** — an ecosystem present couldn't be scanned (tool missing, no lock file, unrecognised ecosystem) so coverage is incomplete.<br>This checks *known-vulnerable dependency versions* only — it's not a substitute for `claude-security` or any other code-level vulnerability scan; install that separately if you want both (see "Security tooling" below). |
| `devkit-reviewer` | `haiku` | `Read, Bash, Glob, Grep` | "review the diff", "review against the spec" | Report-only — never edits files. Maps every acceptance criterion in the matched spec to the diff (Met / Not Met / Partially Met with file/line evidence), lists correctness risks, out-of-scope changes, and convention violations, then ends with exactly one of:<br>**Verdict: ship** — criteria met, no material risks.<br>**Verdict: needs-changes** — unmet criteria or correctness risks found.<br>**Verdict: discuss** — ambiguity needing the owner's judgment.<br>Followed by one line: files reviewed (count) and diff size (lines added/removed). |

## Hooks

| Event | Matcher | Script | Trigger condition | Blocking behaviour |
|---|---|---|---|---|
| `SessionStart` | *(none supported)* | `scripts/session-welcome.ps1` | Fires when a genuine new session starts (`source: "startup"` — skips resume/clear/compact to avoid repetitive noise mid-project). | Never blocks — always exits 0. Prints contextual guidance: the bootstrap checklist if `PROGRESS.md` doesn't exist, "let's spec this" if the next milestone has none, "implement it" if it does, or "nothing queued" if none are unstarted. Its exact on-screen behavior via the harness is unverified (see Troubleshooting) — `devkit-help` is the tested fallback. |
| `Stop` | *(none — Stop doesn't support matchers)* | `scripts/continue-loop.ps1` | Fires on every session stop. No-ops (exit 0) if: the harness reports `stop_hook_active` (already mid-continuation); the host project has its own `.claude/skills/spec-loop/SKILL.md` (deferred to entirely — see below); no `PROGRESS.md` exists; no not-started milestone is found; or the same milestone has already been nudged 8 times (runaway-loop guard, counter kept in `%TEMP%\rajesh-devkit-continue-loop`, keyed per project + milestone). | Otherwise **exit 2** — checks whether a spec exists for the milestone (kebab-case filename guess, falling back to a header scan) and writes a matching instruction to stderr: draft one with `devkit-specify` if none exists, or implement it test-first (RED-GREEN, one acceptance criterion at a time) and invoke `devkit-reviewer` on the diff if it does. Exit 2 on a Stop hook blocks the stop and feeds that stderr text back to Claude as the reason to keep going. |
| `PostToolUse` | `Edit\|Write` | `scripts/run-verify.ps1` | Fires after every Edit or Write tool call. | If `.claude\verify.ps1` doesn't exist in the host project, exits 0 silently (no-op). If it exists, runs it and **exits with whatever code it returned** — no remapping. `verify.ps1`'s own exit-code convention is what decides whether Claude sees the failure (see the contract below). |
| `PostToolUse` | `Edit\|Write` | `scripts/track-milestones.ps1` | Fires after every Edit or Write tool call, alongside `run-verify.ps1` (same matcher, both run). | Never blocks — always exits 0. Re-parses `PROGRESS.md`'s milestone statuses, diffs against a stored snapshot, and appends a `milestone_shipped` telemetry event for anything that just flipped to done. No-ops silently if there's no `PROGRESS.md` or no recognisable milestone lines. |

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

## Telemetry

`continue-loop.ps1` logs a `milestone_started` event the first time it nudges
toward a new milestone; `track-milestones.ps1` logs the matching
`milestone_shipped` event the moment `PROGRESS.md` marks it done. Both append
to one JSONL file per project:
`%LOCALAPPDATA%\rajesh-devkit\telemetry\<hash>.jsonl`, where `<hash>` is the
uppercase-hex MD5 of the project's path (same value the nudge-cap counter
uses, computed the same way, but stored under `%LOCALAPPDATA%` rather than
`%TEMP%` since telemetry is meant to survive across sessions, not just one
run). `devkit-stats` reads that file and reports duration per milestone.

**Timing coverage is only for milestones actually driven through the Stop
hook.** A milestone implemented by hand in a session that never stopped
won't have a `milestone_started` event and won't show a duration —
`devkit-stats` says so rather than silently omitting it.

**Real USD cost per milestone.** `scripts/token-report.ps1` scans this
project's own session transcripts — the main session and every delegated
subagent run — for a given time window and sums their real `usage` fields.
It finds the right transcript directory deterministically from
`$CLAUDE_PROJECT_DIR` using Claude Code's own path-sanitization scheme
(every `: \ / .` and space becomes a literal hyphen — verified empirically
against real transcript folder names, including a nested-worktree path with
a leading dot), then reads each session's `<id>.jsonl` plus every
`<id>/subagents/agent-*.jsonl` it finds, filtering to assistant turns whose
own `timestamp` falls inside the window. Subagent invocations *do* get their
own transcript file (with a `.meta.json` naming the agent type/description),
so a subagent's spend is separable from the main thread's — confirmed by
inspecting a real transcript, not assumed.

Cost uses a pricing table baked into the script (input/output/cache-write/
cache-read per model, sourced from the `claude-api` skill, cached
2026-06-24 — **not fetched live**, so it goes stale if Anthropic changes
prices):

| Model | Input $/MTok | Output $/MTok | Cache write 5m / 1h $/MTok | Cache read $/MTok |
|---|---|---|---|---|
| `claude-opus-5` | 5.00 | 25.00 | 6.25 / 10.00 | 0.50 |
| `claude-sonnet-5` | 2.00 | 10.00 | 2.50 / 4.00 | 0.20 |
| `claude-haiku-4-5` | 1.00 | 5.00 | 1.25 / 2.00 | 0.10 |
| `claude-fable-5-1` | 10.00 | 50.00 | 12.50 / 20.00 | 0.25 |

Fable 5.1's cache-read rate (0.25) is a documented flat rate, not the usual
0.1× multiplier — don't "fix" it to match the others. A model outside this
table still reports its token counts (`unknownModelTokens`), just no dollar
figure — never silently dropped, never guessed.

**Verified, not just designed:** ran against a real subagent transcript from
this plugin's own end-to-end test (a `devkit-implementer` run, 72 turns) and
got $2.21 — cross-checked the raw usage-field sums against the transcript
file directly (not just trusted the script's own output) before trusting the
number.

**Heuristic manual-effort comparison, clearly separated from the two
measured figures above.** `devkit-stats` also estimates a person-hours range
for what the same milestone would take a competent engineer without AI
assistance, reasoning from the spec's acceptance criteria and whether any of
them touch something the spec's own template flags as sensitive (a new
invariant, a security boundary, a data-model change, an external
integration). This is a judgment call, not a measurement — always reported
as a range with reasoning shown and flagged `🚩 Heuristic estimate, not
measured`, never as a bare precise number. The implied speedup (estimate
midpoint ÷ real duration) is reported the same way, and only when both
figures actually exist for that milestone.

For overall session-level cost/token/tool-usage metrics (not milestone-level,
but real and zero-code today), Claude Code also has a built-in OpenTelemetry
exporter: set `CLAUDE_CODE_ENABLE_TELEMETRY=1` plus `OTEL_METRICS_EXPORTER`
and `OTEL_EXPORTER_OTLP_ENDPOINT` to point it at Prometheus/Grafana/any OTLP
backend. See Claude Code's own telemetry documentation for the full env-var
list.

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

- **No welcome banner appears when a new session starts.** `SessionStart`
  hooks' exact on-screen behavior wasn't empirically verified against a
  live harness while building this (this plugin's own OAuth doesn't carry
  into a nested `claude` session, so a real end-to-end "does the banner
  actually render" test wasn't possible — `session-welcome.ps1`'s own logic
  *was* fully tested by direct invocation, in all five states). If nothing
  shows up automatically, ask "how do I use this plugin" or "what's next" —
  that invokes `devkit-help`, which runs the identical check and is
  guaranteed to work the same way any other skill does.
- **The Stop hook still tells me to write a spec even though one exists.**
  Its spec-existence check tries a kebab-case filename guess first
  (matching `devkit-specify`'s own naming), then falls back to scanning
  each spec's header line for the milestone's number — if neither matches
  (an unusual filename with no `Milestone: M<N>` header line), it won't be
  found. Rename the file or add that header line.
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
- **`devkit-stats` reports $0 cost for a milestone that clearly took real
  work.** Check the milestone's started/shipped timestamps actually bracket
  when the work happened — a milestone whose telemetry got reset partway
  through (see the Telemetry section's "shipped, no started event" case)
  has no valid window to scan, and `$0`/`unavailable` is the honest answer,
  not a bug in `token-report.ps1`.
- **`devkit-stats` shows a cost total but `unknownModelTokens` is
  non-zero.** A model outside `token-report.ps1`'s pricing table appeared in
  the window — check its `byModel` output for which one, then update the
  `$Pricing` table in the script if it's a model this plugin should know
  about now.
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
- **`devkit-stats` says no telemetry exists yet.** Either the Stop hook has
  never fired for this project (check `PROGRESS.md` exists and has a
  recognisable milestone line), or the milestone in question was implemented
  by hand without the session ever stopping in between — that's the known
  timing-only coverage gap documented above, not a bug to chase.
- **A milestone shows "started" but never "shipped."** `track-milestones.ps1`
  only logs a ship event when a milestone's *status glyph itself* changes to
  `✅` (or `- [x]`) in `PROGRESS.md` — if the milestone shipped some other way
  (a different tracker file, a manual status note instead of the glyph),
  it won't be detected. Check the actual line in `PROGRESS.md` matches one of
  the two recognised formats.

## Commit history

| Commit | Date | Summary |
|---|---|---|
| `6931fe2` | 2026-09-15 | Initial scaffold: `devkit-specify`/`devkit-reviewer` copied with explicit `name:` frontmatter, `continue-loop.ps1`/`run-verify.ps1` hooks |
| `db7be31` | 2026-09-15 | Renamed to `devkit-specify`/`devkit-reviewer` to avoid a name-conflict load error in a host project that already has its own `specify`/`reviewer` |
| `b50897f` | 2026-09-15 | Added `devkit-dep-audit` for dependency CVE scanning |
| `94cd457` | 2026-09-15 | Generalized `devkit-specify` and `devkit-dep-audit` off MyHomeMaintenance-specific assumptions (`api/`/`mobile/` folders, dotnet/pub-only scanning); added `devkit-implementer` |
| `2e3de90` | 2026-09-15 | Added timing-only telemetry (`milestone_started`/`milestone_shipped` events) and `devkit-stats` |
| `c2d62d4` | 2026-09-15 | Fixed a UTF-8 BOM in telemetry/state writes (Windows PowerShell 5.1's `-Encoding utf8` quirk) — found by running the hooks against a real scratch project |
| `c64b340` | 2026-09-15 | Fixed `devkit-specify`'s circular template-precedence logic and undefined ask/default threshold — found by dogfooding the skill against a scratch project |
| `7ba1949` | 2026-09-15 | Fixed `devkit-implementer`'s missing broken-tooling branch and ambiguous "minimum code" guidance — found by a real RED-GREEN run (`npm test` genuinely fails on Node 22/Windows) |
| `8e3d28c` | 2026-09-15 | Fixed `devkit-reviewer`'s untracked-files gap and hardcoded rule filenames — found by a real review run against freshly created, unstaged files |
| `afc0d00` | 2026-09-15 | Fixed `devkit-dep-audit` creating a `package-lock.json` to make `npm audit` runnable, violating its own report-only contract; also fixed advisory-list truncation |
| `ae54ee7` | 2026-09-15 | Added `token-report.ps1` (real USD cost from session transcripts, pricing sourced from the `claude-api` skill, verified against a real transcript) and extended `devkit-stats` with cost + a heuristic manual-effort/speedup comparison; dogfooding this one too found and fixed a real pairing gap (a `milestone_shipped` event with no preceding `milestone_started` — a telemetry reset mid-milestone, not a bug — wasn't handled, only the reverse case was) |
| `f63d6fd` | 2026-09-15 | Added a spec-existence check to `continue-loop.ps1` (it previously nudged toward implementing a milestone even with no spec yet — verified in all three cases: no spec, kebab-case filename match, header-scan fallback match); added `session-welcome.ps1` (`SessionStart` hook) and `devkit-help` (the verified on-demand fallback, since `SessionStart`'s exact on-screen behavior couldn't be tested against a live harness) |
| `a23f59f` | 2026-09-16 | Documented the existing/downloaded-project onboarding path alongside the brand-new-project one — inventory existing `.claude` components first, review rather than regenerate an existing `CLAUDE.md`, read existing docs for product intent instead of starting fresh, and the lightweight-vs-thorough `PROGRESS.md` retrofit choice |

The last six commits all came from actually running each shipped file against
[a scratch regression fixture](../scratch-devkit-test) rather than just reading
them — see that project's `CLAUDE.md` for what's real there versus deliberately
broken/vulnerable on purpose.
- **Marketplace install fails with "source: Invalid input" or "source type
  your Claude Code version does not support."** Tested empirically: a
  `marketplace.json` plugin entry only accepts the bare relative-path string
  form (`"./plugins/<name>"`, matching the official `claude-plugins-official`
  marketplace's own pattern) — it rejects a path outside the marketplace's
  own tree (`"../rajesh-devkit"` fails validation) and rejects object-form
  sources (`{"source": "directory", ...}`, `{"source": "git", ...}`) as
  unsupported, regardless of CLI version (checked on 2.1.269 and 2.1.272).
  That's why this plugin is installed as a **git submodule** at
  `dev-marketplace/plugins/rajesh-devkit` rather than a true sibling folder —
  if you're setting this up fresh, see `dev-marketplace`'s own README/commit
  history for the exact `git submodule add` command, and don't revert to a
  sibling-folder layout, it won't install.
- **Changed something in `rajesh-devkit` but the installed plugin doesn't
  reflect it.** The submodule under `dev-marketplace/plugins/rajesh-devkit`
  is a pinned commit, not a live link — after committing here, sync it:
  `cd dev-marketplace/plugins/rajesh-devkit && git fetch <path-to-rajesh-devkit> master && git checkout FETCH_HEAD`,
  then commit the updated submodule pointer in `dev-marketplace` itself.
