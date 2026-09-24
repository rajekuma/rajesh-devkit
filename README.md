# rajesh-devkit

A personal Claude Code plugin: an
onboard→spec→ux→implement→review→ship→document dev loop, stack-agnostic by
design — it infers a project's own layout, test runner, package ecosystem,
component library, and coverage thresholds rather than assuming .NET/Flutter
or any other specific stack. Hooks turn it into a milestone-driven
*unattended* loop against any host project's `PROGRESS.md`, if it has one.

One property holds across every component with a single, opt-in exception:
**nothing here commits, pushes, tags, merges, or opens a PR.** Several
components produce verdicts, and the loop respects them, but the working tree
is as far as they go.

The exception is `devkit-deliver`, and it is **off unless you enable the
`deliver` stage** — installing this plugin is never enough to grant it. Even
enabled, it is standing permission for the recoverable flow only (branch,
commit, push a feature branch, open a PR) and never for force-pushing,
pushing to a default branch, merging, deleting branches or rewriting history.
Those aren't a confirmation question; they're an irreversibility one. Tagging
a release is on the same side of that line: `devkit-release` prepares one
and prints the tag command; nothing here runs it.

> **New here?** [**docs/SDLC.md**](docs/SDLC.md) is the end-to-end
> walkthrough — how to take a product from nothing, or from an existing
> codebase, to shipped features one milestone at a time, with the reasoning
> behind each stage. This README is the reference: what each component does,
> how the hooks behave, and what gets written where.

## What this plugin is

- `devkit-onboard` — the entry point for a project that isn't on the loop
  yet, new or brownfield: inventories what already exists before writing
  anything, seeds the test-runner cache with a command it actually ran, and
  proposes a `PROGRESS.md` and the ADRs worth backfilling.
- `devkit-specify` — an interactive skill acting as product owner: drafts a
  feature spec into `specs/<kebab-feature>.md`, reading the host repo's own
  code and decision-record docs first, then interviewing you one question at
  a time for anything it can't confidently infer.
- `devkit-ux` — for anything with a user interface, the stage between spec
  and implementation: audits the existing components and tokens, enumerates
  the states that actually break interfaces (empty, loading, error,
  permission-denied), reads Figma when it's configured, and writes
  accessibility criteria into the spec where they'll be enforced.
- `devkit-datamodel` — the data-side counterpart of `devkit-ux`, for any
  milestone that changes stored data: turns the spec into
  `specs/<name>.data.md` — entities and constraints, the migration as an
  ordered sequence, a backfill for rows that already exist, a rollback path
  or an explicit statement that there isn't one, and what runs the migration
  against a real engine. Writes no migration file and no entity class; the
  plan is reviewed before it is in the schema, because a schema change is
  the one kind a follow-up commit can't undo.
- `devkit-implementer` — implements one spec test-first (RED-GREEN), one
  acceptance criterion at a time, detecting whatever test runner the project
  actually uses (`npm test`, `pytest`, `dotnet test`, `flutter test`, `go
  test`, `cargo test`, ...) instead of assuming one.
- `devkit-ui-verify` — runs the built UI the project's own way and drives it
  through every state the UX spec named, checking what actually rendered
  rather than what the tests assert. A state it could not reach is
  `UNVERIFIED`, never "fine" — and reached through a stub it wrote itself is
  not reached. Report-only.
- `devkit-reviewer` — a report-only subagent that diffs the current change
  against its spec and ends with a single verdict line.
- `devkit-quality` — the review the spec can't ask for: is the change built
  well enough to still be changeable, and will it hold at the volume the
  spec describes? Layering drift, duplication, a class becoming the place
  everything goes, N+1 and unbounded reads — checked against the project's
  own architecture rules and performance budgets, so a finding cites a rule
  the project wrote rather than a principle it didn't. Report-only.
- `devkit-security` — reviews the code you wrote for the classes that
  actually cause breaches — broken object-level authorization, tenant
  isolation, auth and session handling, injection, data exposure — against
  the project's own stated invariants (ADRs, rule files, how sibling
  endpoints do it), so a finding cites a rule the project wrote. Every
  finding names a file, a line and a reachable exploitation path. Distinct
  from `devkit-dep-audit`, which covers code someone else wrote.
- `devkit-ship` — the preflight between "the reviewer said ship" and "mark it
  done": CI status, coverage against the project's own threshold, dependency
  advisories, a secrets scan of the diff, any unaccounted acceptance
  criteria, and a row for every other gate that runs before it — the
  `devkit-security` and `devkit-quality` verdicts, the `devkit-ui-verify`
  verdict, and whether
  the migration `devkit-datamodel` planned is actually in the diff. A gate
  it couldn't run reports `UNKNOWN`, never `PASS`.
- `devkit-docs` — writes the changelog entry a shipped milestone earns, and
  hunts down the documentation that milestone just made wrong.
- `devkit-release` — at a Phase boundary, turns the accumulated changelog
  entries into a release: decides the semver bump from what actually
  shipped (with the evidence — a `SENSITIVE:` compatibility break is a
  major whether or not the changelog said so), rolls `[Unreleased]` into a
  versioned section, updates the version everywhere the project declares
  it, drafts release notes. Working tree only. It ends with the `git tag`
  command and never runs it — tagging is the one git operation that stays
  human in every configuration, because a tag is what registries and
  pipelines act on the moment it exists.
- `devkit-pipeline` — audits what actually gates a merge — build, tests,
  dependency and secret scanning — against whatever CI the repo already
  uses, or proposes a pipeline for a repo with none. Report-first: it never
  enables a branch protection or commits a workflow on its own.
- `devkit-deliver` — the one component that touches git, and **off unless
  the `deliver` stage is enabled** in `.claude/devkit.json` (it checks the
  file itself; being asked by name is not the opt-in). Branches per Phase,
  commits with a message that says why, pushes the feature branch, opens
  the PR at a Phase boundary, and tracks the branch in `PROGRESS.md`'s In
  flight block so an interrupted run resumes. Never force-pushes, never a
  default branch, never merges, never tags.
- `devkit-adr` — records an architecture decision properly, interviewing for
  the alternatives and consequences that aren't inferable from code.
- `devkit-dep-audit` — a report-only subagent that checks the project's
  dependencies for known-vulnerable versions, across whichever package
  ecosystems are actually present (npm, PyPI, NuGet, pub, Go, Cargo, Maven, ...),
  and for licences that conflict with the project's own posture — its
  licence, how it ships, any stated policy — rather than a generic rule. A
  GPL dependency is a finding in a proprietary product and not in an MIT
  library; an AGPL one in a hosted service is the case people miss; an
  undeclared licence is all-rights-reserved and gets named.
- `continue-loop.js` (Stop hook) — when a session stops, checks the host
  project's `PROGRESS.md` for the next not-started milestone and, if one
  exists, blocks the stop with an instruction to draft a spec first (if none
  exists yet) or implement it test-first and run the reviewer (if one does).
- `run-verify.js` (PostToolUse hook) — after every `Edit`/`Write`, runs the
  host project's own verify script if it provides one — `.claude/verify.js`,
  `.sh` or `.ps1`, first match wins.
- `track-milestones.js` (PostToolUse hook) — after every `Edit`/`Write`,
  detects any milestone that just flipped to done in `PROGRESS.md` and logs
  a timestamped "shipped" event, pairing with the "started" event
  `continue-loop.js` already logs.
- `session-welcome.js` (`SessionStart` hook) — greets a new session with
  what's next: the bootstrap checklist if `PROGRESS.md` doesn't exist yet,
  or the next milestone's status otherwise.
- `devkit-help` — the on-demand, verified version of the same check, for
  when you'd rather ask than wait for the automatic banner.
- `devkit-roadmap` — the component that bends the loop into a circle.
  When the queue is empty or a Phase just closed, it proposes the next
  milestones from evidence rather than a blank page: what the shipped specs
  left `## Out of scope`, the `Tracked follow-ups` whose unblock condition
  has since been met, the gap to the product vision, and whatever production
  signal the repo records (issues via `gh`, `docs/incidents/`,
  `docs/feedback/`). Every candidate carries its evidence; it interviews
  for the priority call; it writes rows only on approval and never starts a
  milestone. A project that records no production signal is told so in one
  sentence, not given a simulated feedback loop.
- `devkit-eval` — this plugin's own regression check: runs the hook suite,
  runs the behavioral evals, and reads the prompt components for the drift
  neither suite can catch (a report-only agent that stopped saying so, a
  reworded verdict string, a document describing last week's behaviour).
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
different names. **The trigger phrases are namespaced too, and that part
matters more than the names.** Prefixing only the `name:` avoids a load
error; it does nothing about which component a natural-language phrase
reaches, because the harness matches on the description's trigger phrases.
Every phrase here contains "devkit" — so a bare "write a spec" reaches a
project's own component, and "devkit spec this feature" unambiguously reaches
this one. `tests/static.test.js` enforces it, since it is the kind of rule
that decays the first time someone adds a component in a hurry.

## Repository layout

```
rajesh-devkit/
├── .claude-plugin/
│   └── plugin.json              # name, version, description, author, license
├── agents/
│   ├── devkit-datamodel.md      # schema + migration + backfill + rollback plan
│   ├── devkit-deliver.md        # branch, commit, push, PR - OPT-IN, off by default
│   ├── devkit-dep-audit.md      # dependency CVE audit, report-only
│   ├── devkit-docs.md           # changelog/release notes + stale-doc hunt, post-ship
│   ├── devkit-implementer.md    # RED-GREEN implementer, stack-agnostic
│   ├── devkit-pipeline.md       # CI/CD audit or scaffold, gates not files
│   ├── devkit-quality.md        # design + performance review vs the project own rules
│   ├── devkit-release.md        # semver bump + changelog roll-up + notes; never tags
│   ├── devkit-reviewer.md       # spec-compliance review, report-only
│   ├── devkit-security.md       # code-level vulns vs the project own invariants
│   ├── devkit-ui-verify.md      # drives the built UI through every specified state
│   ├── devkit-ship.md           # pre-ship preflight: CI, coverage, advisories, secrets
│   └── devkit-ux.md             # spec -> screens/states/tokens/a11y criteria
├── skills/
│   ├── devkit-adr/
│   │   └── SKILL.md             # writes an architecture decision record
│   ├── devkit-eval/
│   │   └── SKILL.md             # this plugin's own regression + drift check
│   ├── devkit-onboard/
│   │   └── SKILL.md             # gets a new or brownfield project onto the loop
│   ├── devkit-roadmap/
│   │   └── SKILL.md             # proposes the next milestones from what shipped + production
│   ├── devkit-stats/
│   │   └── SKILL.md             # timing + real cost + heuristic effort report
│   ├── devkit-specify/
│   │   └── SKILL.md             # spec-drafting, product-owner style
│   ├── devkit-help/
│   │   └── SKILL.md             # on-demand "what's next" (verified SessionStart fallback)
│   └── devkit-stats/
│       └── SKILL.md             # timing + real cost + heuristic effort report
├── tests/
│   ├── helpers.js              # throwaway fixtures + real-process hook runner
│   ├── lease-fixtures.js       # stands in for the other session, in its own tree
│   ├── gates.test.js           # stale-verdict detection, against real git repos
│   ├── static.test.js          # well-formedness: parse, ASCII, frontmatter, hooks.json
│   ├── hooks.test.js           # behavioural: real processes, real exit codes
│   └── run-evals.ps1           # Windows bridge for `claude plugin eval` (see evals/)
├── hooks/
│   └── hooks.json               # SessionStart -> session-welcome.js
│                                 # Stop -> continue-loop.js
│                                 # PostToolUse (Edit|Write) -> run-verify.js, track-milestones.js,
│                                 #                              write-resume.js
├── scripts/                     # hooks are Node: they run on Windows, macOS and Linux
│   ├── lib/
│   │   ├── devkit.js           # shared: PROGRESS.md parsing, spec lookup,
│   │   │                         # the SENSITIVE matcher, deference, telemetry
│   │   ├── provider.js         # which provider/model tiers this session got
│   │   ├── lease.js            # is another session already working this milestone
│   │   │                         # in this working tree right now?
│   │   ├── gates.js            # was this gate verdict issued against the tree
│   │   │                         # that is here now?
│   │   └── arm.js              # is THIS session driving the loop?
│   ├── continue-loop.js        # Stop hook: nudge toward next milestone, in a
│   │                             # session that said "devkit continue"
│   ├── loop-command.js         # UserPromptSubmit hook: "devkit continue" /
│   │                             # "devkit pause" start and stop the loop
│   ├── run-verify.js           # PostToolUse hook: host's verify.js/.sh/.ps1
│   ├── track-milestones.js     # PostToolUse hook: log milestone-shipped events
│   ├── write-resume.js         # PostToolUse hook: the resume checkpoint, so a
│   │                             # session killed by a usage limit loses nothing
│   ├── session-welcome.js      # SessionStart hook: "what's next" banner
│   ├── record-gate.js          # not a hook - stamps a gate verdict with the tree
│   │                             # it saw; `check` says which went stale
│   └── token-report.js         # not a hook - invoked by devkit-stats on demand;
│                                 # scans session transcripts for real cost/tokens
├── profiles/                    # point the loop at another provider; nothing
│   ├── devkit.js               # in agents/ or skills/ names a model, so this
│   │                             # launcher re-targets the whole chain, any OS
│   ├── openrouter.json         # tier -> model, edited rather than coded (the fallback)
│   ├── openrouter-*.json       # candidates to measure: lean, luna, nemotron-free
│   ├── catalogue.js            # which gateway models are new since you last looked
│   └── check.js                # verifies those IDs still exist, with prices; --new
├── docs/
│   ├── SDLC.md                 # the loop, explained without the plugin
│   └── model-learnings.md      # every model tried: score, real cost, lesson
└── README.md
```

`.claude-plugin/` holds both a `plugin.json` and a `marketplace.json`, which
is what makes this repo **self-hosting**: it is simultaneously the plugin and
a one-plugin marketplace listing itself at `"source": "."`. That's why
installing needs no clone and no separate marketplace repo — see "Install"
below.

## Install

This repository is its own marketplace, so installing it takes two commands
and no clone. Run both **from inside the project you want the loop in**:

```bash
claude plugin marketplace add rajekuma/rajesh-devkit
claude plugin install rajesh-devkit@rajesh-devkit --scope project
```

`--scope project` records the install in that repo's own Claude Code config,
so it applies only there — repeat the two commands in any other project you
want it in. Then say *"how do I use this plugin"* to invoke `devkit-help`,
which reports what to do next in that specific repository.

> **Start Claude Code *in* the project directory — not in a parent of it.**
> A project-scoped plugin is loaded only for sessions whose working
> directory is that project. Start `claude` one level up (in `C:\Dev`
> rather than `C:\Dev\MyProject`) and **none of its agents, skills or
> hooks load — silently.** Nothing errors, and nothing warns.
>
> **`claude plugin list` saying "enabled" is not evidence the plugin is
> active in the session you are in.** It reports what is installed for the
> directory you ran *it* from, not what the current session loaded. What
> proves it is the session itself: the available-agents list (`/agents`, or
> asking the session which subagents it can use) must include
> `rajesh-devkit:devkit-implementer` and friends. If they are missing, the
> plugin is not loaded, whatever the list says.
>
> This cost an entire dogfooding session. It ran from `C:\Dev` against a
> plugin installed `--scope project` in `C:\Dev\MyHomeMaintenance`; the
> hook *scripts* could still be run by hand with `CLAUDE_PROJECT_DIR` set,
> which made the loop look like it was working for hours. It surfaced only
> when delegating to `devkit-implementer` failed with "Agent type not
> found".
>
> **When to use `--scope user` instead.** If you routinely start Claude Code
> from a parent directory, work across many repositories, or want the loop
> available everywhere on this machine, install once with `--scope user`.
> The trade-off: it is then live in *every* project you open, including ones
> that were never set up for it (the hooks stay quiet where there is no
> `PROGRESS.md`, but the agents and skills are all offered), and the install
> is no longer recorded in the repository for the rest of a team to see.
> Project scope is the right default for a shared repo; user scope is the
> right one for a personal toolbox you carry between projects.

**Requirements.** Node — and you almost certainly have it already, because
Claude Code needs it. **Everything you run is a Node script, and the same
command works on Windows, macOS and Linux:** the hooks, the provider
launcher (`node profiles/devkit.js`), the model check, the cost scanner
`devkit-stats` uses, and the regression suite (`node --test`, built in — no
npm install). Nothing here asks you to run a PowerShell or bash script.

### On Windows

Windows adds three traps that have nothing to do with this plugin but will
hit you while using it. All three were hit, in one sitting, on a real
Windows 11 work machine:

- **"…cannot be loaded… is not digitally signed."** Your PowerShell
  execution policy is `AllSigned` (common on managed machines; check with
  `Get-ExecutionPolicy -List`), so PowerShell refuses every unsigned `.ps1`.
  Node scripts are not affected — the policy governs `.ps1` files only — which
  is why every command in this README is `node …`. You do not need to change
  the policy, and you never need `sudo` or an admin window for anything here.
- **Typing `claude` in PowerShell gives that same error.** An npm install of
  Claude Code creates three launchers — `claude`, `claude.cmd` and an
  unsigned `claude.ps1` — and PowerShell picks the `.ps1`. Type
  **`claude.cmd`** instead, or use Command Prompt or Git Bash, where plain
  `claude` works. `node profiles/devkit.js` sidesteps it entirely: it starts
  the real `claude.exe` behind those launchers directly.
- **PowerShell and Command Prompt take different syntax.** `$env:NAME = 'x'`
  is PowerShell; in Command Prompt (the prompt looks like `C:\...>` with no
  `PS` in front) the same line fails with *"The filename, directory name, or
  volume label syntax is incorrect"* — and then `claude` runs without the
  variable, silently. That is precisely how a "successful" OpenRouter test
  once went to the Claude subscription instead. The launcher removes the need
  to set these variables by hand at all.

What is still shell-based, and why you never run it directly:
`tests/run-evals.ps1` is the Windows bridge for this repo's own behavioral
evals — it works around a Windows bug in `claude plugin eval` (scaffold paths
reach `bash -c` unescaped, so `C:\Dev\...` arrives mangled). Always start it
through **`node tests/run-evals.js`**, which passes it a per-process policy
exception, so it runs under `AllSigned` without changing anything. The eval
fixtures (`evals/*/scaffold.sh`) are bash, run by the eval runner via Git
Bash, which comes with Git for Windows. A host project's own
`.claude/verify.ps1`, if it chooses to have one, is that project's choice.

<details>
<summary>Other install routes</summary>

**From a local checkout** — for developing the plugin itself, or pinning to
a working copy:

```bash
git clone https://github.com/rajekuma/rajesh-devkit
claude plugin marketplace add ./rajesh-devkit
claude plugin install rajesh-devkit@rajesh-devkit --scope project
```

**For one session only**, without installing anything:

```bash
claude --plugin-dir /path/to/rajesh-devkit
```

Useful for trying it against a project before committing to it, and the way
`tests/run-evals.ps1` loads the plugin under test.

</details>

### Updating — it does not happen by itself

A new release pushed here does **not** reach projects that already have
the plugin installed, unless you do something about it. Three facts
explain why:

- **Auto-update is off by default for this marketplace.** Claude Code
  turns it on by default only for official Anthropic marketplaces and ones
  added from claude.ai; every other third-party marketplace, this one
  included, starts with it off.
- **Updates are detected by `version`, not by commit.** `plugin.json`
  declares a `version`, so Claude Code treats the plugin as unchanged until
  that string changes: a push without a bump leaves every installed copy
  on its cached version, forever. Every release here bumps it for exactly
  that reason — anyone changing this repository must do the same.
- **The installed copy lives on each machine.** `--scope project` records
  in the repository that the plugin is *enabled*; the downloaded copy is
  cached per machine and per user. Every person, on every machine, updates
  separately.

**To update by hand**, from inside the project:

```bash
claude plugin marketplace update rajesh-devkit
claude plugin install rajesh-devkit@rajesh-devkit --scope project
```

Then restart Claude Code in that project, or run `/reload-plugins` in a
session that's already open. Inside a session, `/plugin update` does the
same job.

**To have it update itself**, turn auto-update on once per machine: run
`/plugin` in an interactive `claude` terminal, open **Marketplaces**,
choose `rajesh-devkit`, and select **Enable auto-update**. Claude Code then
checks in the background after a session starts (with a random delay of up
to ten minutes), downloads any new version, and asks you to run
`/reload-plugins`. The session you are in keeps the version it loaded at
launch until you reload or restart. An administrator can turn it on for a
whole organization instead with `"autoUpdate": true` on this marketplace's
`extraKnownMarketplaces` entry in managed settings. Setting
`DISABLE_AUTOUPDATER` switches plugin auto-updates off as well, unless
`FORCE_AUTOUPDATE_PLUGINS=1` is also set.

**To check what you are actually running**, start a session in the project
and look for the `rajesh-devkit:devkit-*` agents. `claude plugin list`
shows the installed version, but — as the warning above explains — not
whether the session in front of you loaded it.

Behaviour described here is as of the Claude Code docs, [Discover plugins
→ Configure auto-updates](https://code.claude.com/docs/en/discover-plugins)
and [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces);
check there if a command has moved.

## Customize it for your project

Everything the plugin does can be shaped per project without touching the
plugin itself. Six places, in order of how much they change:

**1. Which steps the loop runs — `.claude/devkit.json`** (committed, so the
team shares it). `devkit-onboard` asks and writes it during setup; edit it any
time:

```json
{
  "stages": ["specify", "implement", "review", "quality", "security", "ship", "docs"],
  "loopStart": "keyword"
}
```

Leave a stage out and the loop never asks for it. Every stage is on by
default except `deliver`: `specify`, `ux`, `datamodel`, `implement`,
`ui-verify`, `review`, `quality`, `security`, `ship`, `docs`, `release`,
`pipeline`. No UI? Drop `ux` and `ui-verify`. The other keys — `loopStart`,
`loop`, `checkpointCommit`, `parkedPattern`, `sensitivePatterns`,
`sessionLeaseTtlMinutes`, `prices` — are explained in "The rest of
`.claude/devkit.json`".

**2. Just for you — `.claude/rajesh-devkit/devkit.local.json`.** Same shape,
gitignored, and it wins over the committed file, so you can run a narrower
loop than the team without changing it for anyone.

**3. How the agents do the work — your project's own rules.** This is the
most powerful one, and it needs no plugin settings at all. Every agent reads
`CLAUDE.md`, `.claude/rules/*.md` and your ADRs (`docs/adr/`) before it does
anything, and follows what's written there over its own defaults. Write your
conventions down once and every milestone obeys them:

```markdown
<!-- .claude/rules/data.md -->
- Migrations are EF Core, in src/Infrastructure/Persistence/Migrations.
- We never roll back a migration; we fix forward. No down-migrations,
  restore scripts or backup steps in plans.
- Integration tests run against a real Postgres via docker compose.
```

With that file, `devkit-datamodel` cites the forward-only rule instead of
asking for a rollback, and `devkit-ship` accepts it.

**Data modelling runs only when a milestone changes stored data.** An
existing schema is the baseline, never re-planned; a milestone that adds no
table, column, constraint, index, entity or seed skips the data-model step
and writes no `.data.md`. If your project never changes its schema through
this loop, drop `datamodel` from `stages` altogether.

**4. A check after every edit — `.claude/verify.js`** (or `.sh`, `.ps1`).
Whatever it does — a build, a lint, a fast test subset — runs after every
edit Claude makes, and a failure is fed straight back. See "Hooks".

**5. How tests are run — `.claude/rajesh-devkit/test-runners.json`.** Written
automatically the first time the implementer (or `devkit-onboard`) finds a
working test command; edit it if the command changes. `"exclusive": true` on
an entry marks a suite that must never run twice at once.

**6. Which models the fallback uses — `profiles/openrouter.json`** in your
clone of this repository. One line per tier; see "Which model each component
runs on in the fallback".

**The quickest route for a new project** is to say `devkit onboard this
project`: it inventories what exists, writes `PROGRESS.md`, seeds the test
command, asks which stages you want, and writes `.claude/devkit.json` — then
point it at your conventions in `.claude/rules/`.

## When you hit the usage limit

Nothing switches automatically, and nothing can: the provider is fixed when
`claude` starts, and at the limit no hook gets a turn to run. It doesn't need
to. Every edit updates `.claude/rajesh-devkit/resume.json`, so a new session
under another provider picks up exactly where the old one stopped.

1. **Don't save anything.** The spec's ticks, the working tree and
   `resume.json` are already current. Exit the limited session with `/exit`
   (or Ctrl+C twice). If it's open in another terminal tab, exit it there
   first — otherwise the plugin sees two live sessions on one milestone and
   stops to ask which owns it.
2. **Open a terminal in the project folder** — not a parent of it, or the
   plugin doesn't load (see Install). In VS Code, the built-in terminal
   already starts there, as long as you opened the project folder itself.
3. **Start the fallback session:**
   ```bash
   node <plugin>/profiles/devkit.js openrouter
   ```
   The same command in PowerShell, Command Prompt, Git Bash, VS Code's
   terminal, macOS and Linux. `<plugin>` is your clone of this repository,
   e.g. `C:\Dev\rajesh-devkit`.
4. **Check the banner** says you're on OpenRouter and where to resume, then
   say `devkit continue`.
5. **When the limit resets**, `/exit` and start `claude` again in the
   project — on Windows in PowerShell or VS Code's default terminal, type
   `claude.cmd` (see "On Windows"). It resumes from the same file.

- **Never `claude --continue` or `--resume` across the switch.** It replays
  the whole old conversation to the new provider, billed as fresh input.
- **Only implement, review and ship on the fallback.** Wait for Claude for
  specs, ADRs, roadmap work and any milestone marked `SENSITIVE:` — a weaker
  model there produces plausible mistakes everything downstream then trusts.
- **The Claude Code panel in VS Code, and the desktop app, always use your
  Claude login.** The launcher can't change that; the fallback runs in a
  terminal, which can sit right beside the panel.
- **Keep a spend cap on the OpenRouter key.** Nothing here can enforce one.
- **Keep fallback sessions short and scoped** — see "What a fallback session
  really costs" below.

### What a fallback session really costs

Every request re-sends the whole conversation, and a gateway bills all of
it. Before any work starts, each request already carries about **45,000
tokens** — Claude Code's own instructions, its tool definitions, your
`CLAUDE.md` and the plugin's agent and skill listings. On your Claude
subscription those repeats are cached and cost little; through a gateway they
cost much more.

Measured on a real fallback session: **26 minutes on `qwen/qwen3-coder`, 192
requests, 18.6 million input tokens, 14 thousand output tokens — about
$8.50**, which emptied a $10 balance and ended in `402 … exceed your
available credits`. It was an open-ended task ("look at the app and suggest
mobile UI work"): lots of reading, several background agents, and a context
that grew past 120k tokens per request.

- **Scope each fallback session to one milestone step**, then `/exit` and
  relaunch. `resume.json` makes the restart cheap; the cost grows with how
  long one conversation runs, not with how many you start.
- **Do open-ended exploration on your subscription**, not on the gateway.
- **The profiles cap the context at 100k tokens** (`maxContextTokens`), so
  Claude Code compacts sooner and late requests cost less. Lower is cheaper
  but summarises older detail sooner; your own
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` wins if you set one.
- **A 402 is the account balance, not the key's limit.** The key's credit
  limit only caps what that key may spend of the balance, and OpenRouter
  reserves each running request's worst-case cost up front — so several
  requests at once can be refused while the balance is still above zero.
  Add credit on OpenRouter's Credits page, and watch its Activity page during
  a session.

**One-time setup:** put your OpenRouter key alone on one line in
`~/.devkit/openrouter_api_key.txt` (`C:\Users\<you>\.devkit\…` on Windows —
watch for Notepad saving it as `.txt.txt`), add credit to the OpenRouter
account, then check with
`node <plugin>/profiles/devkit.js openrouter --dry-run`.

**One click in VS Code.** VS Code's agent-session picker ("New session in
<project> with Claude / Copilot") is owned by VS Code extensions, and a
Claude Code plugin cannot add an OpenRouter entry to it. A task gets you the
next best thing — **Terminal → Run Task → devkit: OpenRouter session** —
running the same launcher in a terminal inside the project. Put this in the
project's `.vscode/tasks.json`, with the path pointing at your clone:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "devkit: OpenRouter session",
      "type": "process",
      "command": "node",
      "args": ["C:/Dev/rajesh-devkit/profiles/devkit.js", "openrouter"],
      "options": { "cwd": "${workspaceFolder}" },
      "presentation": { "reveal": "always", "focus": true, "panel": "dedicated" },
      "problemMatcher": []
    }
  ]
}
```

`"type": "process"` runs `node` directly, with no shell in between, so the
Windows execution policy never comes into it. The path is machine-specific:
keep `.vscode/` gitignored (or the file uncommitted) so it doesn't land on
someone else's machine pointing at a folder they don't have. The session runs
in the task's terminal, not the Claude chat panel, which always uses your
Claude login. A second task with `"--dry-run"` added to `args` is a handy
check that the key and mapping are right before you need them.

**Keep the two copies in step.** The launcher runs from your clone; the
agents, skills and hooks in your project come from the *installed* copy,
which only moves when you update it — see "Updating" above.

The detail behind every step is in "Running on another provider, and
surviving a usage limit" below.

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

Once the milestone queue exists, **the loop starts when you say so**:
`devkit continue`. Until then a session is yours for anything else, and the
`Stop` hook stays out of it (see "Starting and stopping the loop"). The one
thing worth doing deliberately first:

1. **Say "spec this feature: `<milestone name>`"** (or just "spec this
   feature" and name it when asked) — invokes `devkit-specify`, which reads
   the repo and `CLAUDE.md` first, interviews you for anything it can't
   infer, and writes `specs/<kebab-case-feature>.md`.
2. **Once the spec exists, say `devkit continue`.** The loop takes the
   milestone and the `Stop` hook drives each step from there — implement
   with strict TDD, then the review, quality, security and ship gates —
   pushing on every time the session pauses. `devkit pause` stops it at any
   point; the ticks and `resume.json` keep the place.
3. **When the milestone ships, the loop stops and waits for you.** That is
   the moment to look at what shipped. `devkit continue` again takes the
   *next* milestone — spec first if it needs one. For a deliberately
   unattended run through the whole queue, say `devkit continue all`
   instead. Run `devkit-stats` any time to see real duration/cost and the
   heuristic effort comparison so far.

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
     `continue-loop.js` defers to it entirely and never fires (see "Why
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
   claude plugin marketplace add rajekuma/rajesh-devkit
   claude plugin install rajesh-devkit@rajesh-devkit --scope project
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

## Which model each component runs on, and why

The rule: **model need is inversely proportional to how much expertise the
prompt already encodes.** A component whose instructions *are* a checklist
needs a model that executes well. A component whose job is judging what it
doesn't know needs a model that reasons well.

**Skills** (`model: inherit` — they run on whatever your session runs on):

| Component | Run it on | Why |
|---|---|---|
| `devkit-specify` | **a strong model** (Opus / Fable) | Its real job is deciding what it *doesn't* know — which gaps take a default and which must be asked, and whether a requirement touches one of the five sensitive categories when that isn't obvious. That can't be reduced to a checklist; if it could, the checklist would already be in the skill. The failure mode is the worst kind available here: a weaker model fills gaps confidently and produces a *plausible* spec with invented requirements. It looks fine, and everything downstream treats the spec as truth. It also writes the `SENSITIVE:` marker, and the escalation gate cannot catch what was never marked. |
| `devkit-adr` | **a strong model** (Opus / Fable) | Two judgments carry it: refusing to record a non-decision, and never inventing a rationale. The second is the most damaging failure in this plugin — a fabricated "why" is indistinguishable from a real one and gets quoted back years later by someone assuming a human wrote it. |
| `devkit-onboard` | anything from Sonnet up | The most procedural component here: inventory, detect the stack, run the test command, write `PROGRESS.md`, run `session-welcome.js` to confirm the loop can parse it. Its judgment calls (don't clobber, which ADRs are load-bearing) are stated very explicitly, and explicit instructions are what mid-tier models follow reliably. It also verifies its own work by executing things, so mistakes surface instead of hiding. 9/9 on its eval. |
| `devkit-roadmap` | **a strong model** (Opus / Fable) | The same failure mode as `devkit-specify`, one level up: a weaker model fills the blank page with plausible features. Its whole discipline is refusing a candidate with no evidence line, and that refusal is the judgment. |
| `devkit-help`, `devkit-stats`, `devkit-eval` | anything | Mechanical: relay a status check, read a telemetry log, run a suite. |

**Subagents** (frontmatter `model:` is honoured, and they don't follow your
session):

| Component | Model | Why |
|---|---|---|
| `devkit-ux` | `sonnet` | Measured, not assumed: 9/9 on its eval, enumerating all eight states, reusing only existing tokens, and deriving the forbidden-vs-not-found consequence of the spec's `SENSITIVE:` requirement unprompted. It works because this component's prompt **is** the expertise — the state list and the accessibility list are written out explicitly, so the model executes a well-specified checklist rather than inventing method. |
| `devkit-implementer`, `devkit-ship`, `devkit-docs` | `sonnet` | Procedure plus evidence-gathering against a spec that already exists. |
| `devkit-datamodel`, `devkit-ui-verify`, `devkit-pipeline`, `devkit-release`, `devkit-deliver` | `sonnet` | Same shape: a written procedure, executed against files that already exist. Each has a rule that carries its whole value (no migration file; UNVERIFIED not fine; never commit a workflow; never tag; check the config first) and those rules are stated explicitly enough for a mid-tier model to hold. Measured on `ui-verify`: the first eval run found the rule under-specified rather than the model failing to follow it. |
| `devkit-security`, `devkit-quality` | `sonnet` | Read the project's own invariants first, then the diff. The judgment — is this a reachable path, does this finding cost anything — is real, but it is judgment *against a stated rule*, which is the kind a mid-tier model does reliably. A generic checklist pass would be haiku work; a review that cites the project's ADR is not. |
| `devkit-reviewer`, `devkit-dep-audit` | `haiku` | Mechanical: map criteria to a diff, run a scanner. |

### Skills inherit your session model; subagents don't

This is the single most useful thing to know about running this plugin, and
it is not what the frontmatter appears to say.

**A skill runs in your session, on your session's model.** Measured, because
the behaviour isn't documented: `devkit-help` declares `model: haiku`, and
invoked from a session forced to Opus, all seven of its turns were served by
`claude-opus-5`. A skill's declared `model:` had no effect on the
Skill-tool-in-session path — which is how skills are normally invoked. The
one documented way a skill gets its own model is `context: fork`, which turns
it into a forked subagent; `devkit-specify` and `devkit-adr` interview you one
question at a time, and forking would break exactly that, so they stay
in-session by design.

So `devkit-specify`, `devkit-adr`, `devkit-onboard` and `devkit-help` declare
`model: inherit` — stating plainly what actually happens rather than naming a
model that is silently ignored.

**The practical consequence: you choose the model for spec and ADR work by
choosing your session's model.** Specification is where a weak model does the
most damage — its failure mode is a plausible spec with invented
requirements, which everything downstream then treats as truth — so run
`devkit-specify` and `devkit-adr` in a session set to Opus or another strong
model. If you hit a rate limit mid-spec, open a fresh session on an available
model and carry on; the skill will follow it. Nothing needs editing.

**Subagents are the opposite.** They honour their frontmatter `model:` and get
their own context. A 429 from `devkit-ux`, `devkit-implementer`,
`devkit-ship`, `devkit-docs` or `devkit-reviewer` does not follow your session
model, and recovery is a retry with the `Agent` tool's `model` parameter,
which overrides the definition for that one call.

Model tiers have **separate quotas** — Opus stays available while Fable is
exhausted, and vice versa — so a tier override is a real escape hatch, not
just a downgrade. There is no automatic failover in either case.

## Running on another provider, and surviving a usage limit

Two problems, one answer. The first is cost: a flat subscription has a
five-hour rolling window and a weekly cap, and a loop that runs several
agentic stages per milestone reaches them. The second is what happens *at*
that moment — historically the loop simply stopped until the window reset,
which is the thing that actually costs velocity.

### Nothing here names a model

Every component in this plugin asks for a **tier** — `model: sonnet`,
`model: haiku` — and not one of them names a model ID or a provider. That is
deliberate, and it is what makes the whole loop portable: the four alias
variables Claude Code reads (`ANTHROPIC_DEFAULT_OPUS_MODEL`,
`ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`,
`ANTHROPIC_DEFAULT_FABLE_MODEL`) decide what each tier resolves to, and
`ANTHROPIC_BASE_URL` decides who serves it. Set those and every subagent here
re-targets at once. **No file in `agents/` or `skills/` needs editing, and
there is no model-mapping block to maintain in config.**

What this plugin adds is the two things that abstraction doesn't give you:
telling you which provider is actually live (the session banner says so
whenever it isn't the default), and pricing non-Claude models in the cost
report (`prices` in `.claude/devkit.json` — see Telemetry).

### The profiles

One command, identical in PowerShell, Command Prompt, Git Bash, bash and
zsh. `<plugin>` is wherever this repository is on your machine
(e.g. `C:\Dev\rajesh-devkit`):

```bash
node <plugin>/profiles/devkit.js openrouter
```

That starts a normal interactive `claude` session with OpenRouter as the
provider. Anything after the profile name goes straight to `claude`, so a
one-request smoke test is:

```bash
node <plugin>/profiles/devkit.js openrouter -p "Reply with the single word: pong"
```

and `--dry-run` shows what would run — base URL, tier mapping, which
`claude` it found, a masked key — without starting anything. To use the
subscription again, just run `claude` as usual (or `node
<plugin>/profiles/devkit.js claude`, which also strips any gateway variables
left in your shell by an earlier experiment).

**Why a launcher.** The variables only matter to one process — the `claude`
you are about to start — so the launcher sets them on that process and
nowhere else. Nothing is left behind in your shell, there is no "switch
back" step to forget, and no `.ps1` or `source`-able script is involved. It
replaced `devkit-env.ps1` / `devkit-env.sh`, which edited the current shell
instead and failed on a locked-down Windows machine in every way described
under "On Windows" above.

**The API key** comes from the `OPENROUTER_API_KEY` environment variable if
it is set, and otherwise from a one-line file:
`~/.devkit/openrouter_api_key.txt` (on Windows,
`C:\Users\<you>\.devkit\openrouter_api_key.txt`). The file is the easy
option on Windows — write it once, never set a variable again. Watch the
name: with Windows' default of hiding extensions, Notepad saves
`openrouter_api_key.txt` as `openrouter_api_key.txt.txt` while Explorer
shows one `.txt`. The launcher says so if it finds the doubled name. It lives in
your home folder, outside every repository, so it cannot be committed; it is
a plain-text secret, so keep it as private as any other. The key is never
passed as an argument (that would land in shell history) and never printed
in full. **Credit is not the same as a key limit:** raising a key's credit
limit in the OpenRouter dashboard adds no money; paid models need a balance
on the account (its Credits page), and the key's limit then caps what that
key may spend from it — set one.

**The session's model.** A gateway session starts on the `sonnet` tier
unless you pass `--model`. Found live: without an explicit model, Claude
Code carried its default alias's `[1m]` context suffix onto the gateway ID
(`qwen/...:free[1m]`), which OpenRouter rejects. `sonnet` rather than `opus`
because a fallback session is for orchestration and implementation; spec and
ADR work should wait for the subscription (see "Which stages to run cheap"
below). `--model opus` overrides it.

**Free models are for proving the wiring, not for work.** OpenRouter's
`:free` models need no credit, but allow 50 requests a day (1,000 once $10
has ever been purchased) and 20 a minute, and their providers throttle hard
— expect `429 · Provider returned error`. Claude Code retries a 429 by
itself, so one command can spend several of the 50. Some free backends also
cannot parse Claude Code's tool definitions at all (seen:
`grammar rejected: tool "DesignSync" … unsupported schema keyword
"minLength"`). A `pong` through Claude Code is 20,000+ input tokens, because
every request carries its system prompt and tool list — about a cent on
`qwen/qwen3-coder`, about ten cents on `anthropic/claude-sonnet-4.5`.

#### Which model each component runs on in the fallback

Every component asks for a tier, and `profiles/openrouter.json` maps each
tier to one OpenRouter model. With the shipped mapping:

| Component | Tier | On your Claude subscription | In the OpenRouter fallback |
|---|---|---|---|
| The session itself — the orchestrator that follows the loop | the session's | the model you picked | `qwen/qwen3-coder` (the launcher starts on `sonnet`); `--model opus` gives `anthropic/claude-sonnet-4.5` |
| Skills: `devkit-specify`, `devkit-adr`, `devkit-roadmap`, `devkit-onboard`, `devkit-help`, `devkit-stats`, `devkit-eval` | inherit the session | the session's model | the session's model — `qwen/qwen3-coder` by default |
| `devkit-implementer`, `devkit-ship`, `devkit-docs`, `devkit-ux`, `devkit-ui-verify`, `devkit-datamodel`, `devkit-quality`, `devkit-security`, `devkit-pipeline`, `devkit-release`, `devkit-deliver` | `sonnet` | Claude Sonnet | `qwen/qwen3-coder` |
| `devkit-reviewer`, `devkit-dep-audit` | `haiku` | Claude Haiku | `google/gemini-2.5-flash` |
| *(`opus` / `fable` tiers)* | — | — | `anthropic/claude-sonnet-4.5`, only reached with `--model opus` |

Three consequences worth knowing:

- **Nearly the whole loop runs on one model** in the fallback, security and
  quality review included. That is the trade you make for staying unblocked;
  see "Which stages to run cheap" for what to hold back.
- **The mapping is per tier, not per component.** Changing the `sonnet` line
  changes all eleven agents above at once; there is no per-agent override.
- **Spec, ADR and roadmap work would run on the session's model too** — so
  wait for your Claude window for those rather than pay for
  `--model opus` through the gateway.

#### The best measured fallback so far: `openrouter-hybrid`

```bash
node <plugin>/profiles/devkit.js openrouter-hybrid
```

Driving the loop and doing the work turned out to be different skills.
`openai/gpt-6-luna` writes good code cheaply ($0.10 in / **$0.01 cached** /
$0.50 out) but, as the session model, ran `devkit-implementer` in an isolated
copy of the repo, so its work never reached the project (2/9).
`qwen/qwen3-coder` orchestrates properly. The hybrid profile's
`"sessionTier": "opus"` runs the **session on qwen3-coder** (the opus tier)
while every agent that asks for `sonnet` — the implementer and ten others —
runs on **Luna**. On `implementer-red-green` it scored **9/9, matching
Claude, for about $0.07**. That is one run: treat it as the front-runner, not
settled, until a second run or a real milestone agrees. Any profile can set
`sessionTier` the same way.

#### Exploring models — and keeping score in `docs/model-learnings.md`

The fallback is also where you try new models, cheaply and on purpose.
**[docs/model-learnings.md](docs/model-learnings.md) is the running record**:
every model tried, its eval score, what it really cost, what went wrong and
the lesson — including the $8.50 session and the free-tier dead ends. Add a
row every time; a result nobody wrote down gets paid for twice.

- **What's new:** `node profiles/check.js --new` lists the tool-capable
  models the gateway added since this machine last looked, with fresh,
  cached and output prices. The first run just records a baseline.
- **A nudge, not an interruption:** starting a gateway session prints one
  line, at most once a week, when there are new tool-capable models. Never
  during the loop — a milestone isn't the place for a shortlist.
  `DEVKIT_NO_MODEL_NOTICE=1` turns it off.
- **Trying one:** copy a profile, put the model's id on the `sonnet` line,
  run `node profiles/check.js <name>`, then
  `node tests/run-evals.js --case implementer-red-green --profile <name>`,
  and record the result. Candidate profiles ship for `openrouter-lean`,
  `openrouter-luna` (GPT-6 Luna, with a 10× cache discount) and
  `openrouter-nemotron-free`.
- **Look at the cached-input price**, not only the list price: in a long
  session most input is re-sent context. `qwen/qwen3-coder` discounts it 3×;
  many others 10×.

#### A second, cheaper profile — to measure, not to trust

`profiles/openrouter-lean.json` maps the same tiers to cheaper models, chosen
from the live catalogue for tool support and price:

| Tier | `openrouter` | `openrouter-lean` |
|---|---|---|
| sonnet | `qwen/qwen3-coder` — $0.30 / $1.00 | `qwen/qwen3-coder-next` — $0.12 / $0.80 |
| haiku | `google/gemini-2.5-flash` — $0.30 / $2.50 | `google/gemini-2.5-flash-lite` — $0.10 / $0.40 |
| opus / fable | `anthropic/claude-sonnet-4.5` — $3 / $15 | `deepseek/deepseek-v4-pro` — $0.95 / $1.90 |

(Per million input / output tokens, OpenRouter list prices on 2026-09-23;
`node profiles/check.js <profile>` prints today's.) Use it with
`node profiles/devkit.js openrouter-lean`. It is a candidate: cheaper is only
cheaper if the model can hold a red-green loop, and a model that can't costs
more in reviewer rounds than it saves. Send one `pong` through it, and ideally
run the `implementer-red-green` eval under it, before making it your default:

```bash
node tests/run-evals.js --case implementer-red-green --profile openrouter-lean
```

`--profile` runs the case with exactly the environment the launcher gives a
fallback session, and keeps the judge that grades it on your Claude login.
Any `profiles/<name>.json` you add works the same way. Read the real cost on
OpenRouter's Activity page: the eval summary prices a model Claude Code
doesn't know as if it were Claude, and overstated one run about fifteen-fold.

**Measured (2026-09-23/24), `implementer-red-green`, same case, three setups:**

| | Claude login | `openrouter` | `openrouter-lean` |
|---|---|---|---|
| Score | **9/9** | **8/9** | **3/9** |
| Real cost | subscription | ~$0.21 | ~$0.07 |
| Ran `devkit-implementer` to completion | yes | yes | no — stopped it mid-work three times, then did the job itself |
| RED before GREEN | yes, and reported it | yes (fail→pass per criterion in the trace), but didn't report it | no |

`openrouter` is a real fallback for implementation: its one miss is that its
report didn't *say* what its trace shows it did. `openrouter-lean` fails for
a reason price doesn't predict: in this Claude Code build a subagent starts
in the background and the session is notified when it finishes, and
`qwen3-coder-next` wouldn't wait — it stopped the implementer, relaunched it,
messaged it "are you done yet?", stopped it again, and finished the
milestone itself, so none of the implementer's discipline ran (no criteria
ticked, no runner cached). Keep it as a candidate to re-measure, not a
default.

**Read fallback reports more carefully.** `devkit-implementer` now has to
*show* the RED for each criterion — the test's name and the failure it
printed — rather than claim it. With that rule, Claude kept 9/9 and produced
exactly that table. `qwen/qwen3-coder` stayed at 8/9: on a second run it did
the work correctly again (batched RED-GREEN, criteria ticked, runner cached)
but wrote a generic "all criteria met" report — no RED evidence, no batch
disclosure, no performance snapshot — and created a `PROGRESS.md` the project
never had, which the prompt says not to do. It follows the *doing* part of a
long prompt well and the *reporting and don't-do-this* rules less reliably,
and it varies run to run. On the fallback, check the code and the ticks, not
the prose.

**Model suggestions from elsewhere — check them first.** Advice found online
(including AI search summaries) has recommended, for this exact loop, a model
the catalogue lists with **no tool calling** (`qwen/qwen-2.5-coder-32b-instruct`
— Claude Code cannot run on it at all), a "completely free" model that is
paid (`google/gemini-2.5-flash`), and a reasoning model at $10 / $50 per
million "within a $10 credit" — when a single Claude Code request carries
20,000+ tokens of system prompt and tool definitions. `node profiles/check.js`
now fails any model without tool support, and prints real prices.

`profiles/openrouter.json` holds the tier→model mapping, so changing which
model does the coding is a one-line edit, not a code change. **Run
`node profiles/check.js` before relying on it**: it verifies every ID still
exists and prints today's list price per million tokens. Model names get
renamed and retired constantly, and a stale ID doesn't fail at launch — it
fails at the first request, in the middle of a milestone.

Four things worth knowing before you point this anywhere:

- **Claude Code speaks the Anthropic Messages API, and only that.** An
  OpenAI-compatible endpoint — Google AI Studio's, for instance — will not
  work behind `ANTHROPIC_BASE_URL` no matter how the variables are set. Use a
  gateway that exposes an Anthropic-format endpoint (OpenRouter's does), or
  run a translating proxy. Gemini and every open model are reachable *through*
  such a gateway; they are not reachable directly.
- **The base URL is `https://openrouter.ai/api`, not `.../api/v1`.** Claude
  Code appends `/v1/messages` itself; a base ending in `/v1` produces a 404
  that reads exactly like an auth failure.
- **A gateway credential replaces your subscription for that whole session.**
  Every token is billed to whoever owns the credential. Set a hard spend cap
  in the provider's dashboard — the plugin cannot enforce one.
- **The provider is fixed when the CLI process starts.** Nothing inside a
  running session can change it: not a hook, not a skill, not a subagent.
  They are all children of a process whose credentials were resolved before
  they existed. (A `Stop` hook that writes `/model X` to stderr does nothing
  either — stderr on exit 2 is text handed back to Claude, not a command the
  harness runs.) Switching providers is always: set the environment, start a
  **new** session.

### Surviving the limit itself

A hard usage-limit block gives the session **no turn at all**. No `Stop` hook
fires, nothing gets tidied up, no summary is written. Whatever is on disk at
that instant is the entire record — so this plugin makes sure that record is
complete without anyone having to remember to write it.

`scripts/write-resume.js` runs on **PostToolUse**, the one event that has
already fired by then, and rewrites `.claude/rajesh-devkit/resume.json` after
every edit: milestone, spec, spec status, criteria ticked, next criterion,
branch, whether the tree is dirty, which provider served it. Every field is
derived from the repo, so it needs no cooperation from the model and can
never be more than one edit stale. `SessionStart` reads it back, which is
why a brand-new session — different window, different machine, different
provider — opens with *"picking up M28, mid-flight: criteria 7/24, resume at
criterion 8, branch feat/phase5-expenses, tree dirty"* instead of
rediscovering the project from scratch.

So the handoff is (the short checklist is "When you hit the usage limit",
near the top):

1. Work normally. `resume.json` is current at every instant; nothing to do.
2. The limit hits mid-criterion. Nothing is lost — ticked criteria are in the
   spec, the code is in the working tree, the position is in `resume.json`.
3. In the project folder, `node <plugin>/profiles/devkit.js openrouter`. The
   banner says where you were. Carry on.
4. When the window resets: exit that session and start plain `claude` (or
   `claude.cmd` in PowerShell) — a new session, same path. Nothing depends on
   which provider did which criterion.

**Do not use `claude --continue` across a provider switch.** Resuming replays
the entire transcript to the new provider as fresh input tokens — there is no
prompt cache across providers — so it costs the most at exactly the moment
you switched in order to spend less, and it hands your longest context to
your cheapest model. A fresh session plus the resume file is both cheaper and
more reliable.

If the work also has to survive the *machine* going away, turn on
`"checkpointCommit": true` in `.claude/devkit.json`. `devkit-implementer`
then commits `wip(M<N>): …` on the feature branch after each green criterion,
and `devkit-deliver` squashes that run into the real milestone commit when it
ships. Off by default, because per-criterion commits are history noise; worth
it when a stop outlasts the machine staying on.

### Which stages to run cheap

Not an even trade. Ranked by how much a weaker model costs you:

| Stage | On a cheap model |
|---|---|
| `devkit-reviewer`, `devkit-dep-audit` | Fine. Already `haiku`-tier: map criteria to a diff, run a scanner. Highest volume, lowest stakes — the best place to save. |
| `devkit-docs`, `devkit-ship` | Usually fine. Procedure against evidence that already exists. |
| `devkit-implementer` | Workable, and the main thing you're paying for. Needs real tool-use and a model that can hold a red-green loop; one that can't will cost you more in reviewer rounds than it saved. Measure it. |
| `devkit-specify`, `devkit-adr`, `devkit-roadmap` | **Wait for the window instead.** Their failure mode is a *plausible* spec with invented requirements, which everything downstream then treats as truth — and `devkit-specify` is also what writes the `SENSITIVE:` markers the escalation gate depends on. A gate cannot catch what was never marked. |
| A milestone whose spec is marked `SENSITIVE:` | Wait. That marker means it touches an invariant, an auth boundary, a data model, an integration or backward compatibility — the cases where a subtle wrong answer is most expensive to find later. |

Measure rather than assume: run `claude plugin eval` under a profile and see
which cases an open model actually fails. `devkit-stats` reports cost per
provider once you've priced the models in `prices`, so the trade-off stays a
number rather than a feeling.

## Skills

| Name | Trigger | Model / effort | What it does |
|---|---|---|---|
| `devkit-onboard` | "devkit onboard this project", "set up devkit here", "get this repo on the devkit loop" | `fable`, `effort: high` | Gets a project — brand-new or with years of history — to the state the loop needs. Inventories what already exists first and never clobbers it (`CLAUDE.md`, `specs/`, a tracker under any name, other `.claude` assets, a `spec-loop`-shaped skill that would suppress the `Stop` hook), detects the stack and **seeds `test-runners.json` with a command it actually ran**, reconstructs product intent from what's already written rather than a blank page, then proposes a `PROGRESS.md` (offering the lightweight and thorough options honestly instead of choosing for you) and a shortlist of load-bearing ADRs to backfill. Ends by running the real `session-welcome.js` check to prove the loop can parse what it just built. |
| `devkit-adr` | "devkit adr", "devkit write an ADR", "devkit record this decision" | `fable`, `effort: high` | Writes `docs/adr/<NNNN>-<kebab-title>.md`, closing the gap where `devkit-specify` *reads* decision records but nothing ever wrote one. Detects the project's existing convention (folder name, numbering, section shape) from the most recent records and matches it. Refuses to write an ADR for a non-decision, and interviews for the parts that carry the value and are never inferable — the alternatives actually rejected, the forces in tension, the consequences accepted including the bad ones, and what would make you revisit it. Never invents a rationale. Links the record back into the spec and updates any ADR it supersedes. |
| `devkit-eval` | "run the devkit tests", "devkit eval", "devkit regression" | `sonnet` | This plugin's own regression check, for editing *this repo* rather than a host project. Runs `node --test tests/*.test.js` (below), then checks the half no script can assert: that report-only components still declare themselves report-only, that nothing has quietly gained permission to commit, that verdict strings the orchestrator routes on are unchanged, that the handoff chain in the prompts still matches the chain in `continue-loop.js`'s nudge messages, and that the README hasn't drifted from the code. |
| `devkit-specify` | "devkit spec this feature", "devkit specify \<feature\>", "draft a devkit spec for \<feature\>" | `fable`, `effort: high` | Learns the repo's own layout and conventions (`CLAUDE.md`, `.claude/rules/`, whatever decision-record folder it finds) before reading the relevant code, interviews you one question at a time for anything it can't infer, writes `specs/<kebab-feature>.md`, then stops — never scaffolds implementation code itself. Marks any requirement touching an existing invariant, a security/auth boundary, a data-model change, an external integration, or a backward-compatibility break with `🔒 SENSITIVE:` — the marker the escalation gate (see "Hooks" below) keys off of — and leads its final report with those flags if any exist. |
| `devkit-help` | "devkit help", "how do I use devkit", "getting started with devkit" | `haiku` | Runs the same state check as the `SessionStart` hook (below) and relays it conversationally — the verified on-demand fallback for the automatic banner. Read-only. |
| `devkit-stats` | "devkit stats", "devkit cost report", "devkit milestone timing" | `haiku` | Reads the local telemetry log, pairs each milestone's started/shipped events, and reports real duration, real USD cost (via `token-report.js`'s transcript scan), and a heuristic manual-effort/speedup comparison per milestone (see "Telemetry" below for what's measured vs. estimated). Read-only. |

## Subagents

| Name | Model | Tools | Trigger | Verdict format |
|---|---|---|---|---|
| `devkit-ux` | `fable` | `Read, Write, Edit, Glob, Grep, Bash` | "devkit ux spec", "devkit ux pass", "devkit design this screen" | Runs between `devkit-specify` and `devkit-implementer` on anything with a user interface — the stage this toolkit previously skipped entirely, leaving every interface decision to be made implicitly, mid-implementation. Audits the existing component library and design tokens **before** designing anything, so it reuses rather than reinvents. Enumerates the states that actually break interfaces (empty, loading, partial, error, permission-denied, success, destructive-confirm) rather than only the happy path everyone builds. Reads Figma via MCP when it's configured and translates frames into the project's existing tokens instead of transcribing raw hex and pixel values; works from the feature spec alone when it isn't, which is the normal case and not a degraded one. Writes `specs/<name>.ux.md` — no component code — and **appends its accessibility criteria to the feature spec's own `## Acceptance criteria`**, which is what gives them teeth: the implementer works from criteria, and `devkit-reviewer`/`devkit-ship` gate on them. |
| `devkit-ship` | `sonnet` | `Read, Bash, Glob, Grep` | "devkit ship check", "devkit preflight", "devkit can I mark this done" | Report-only. Asks the question `devkit-reviewer` doesn't: the diff matches its spec, but is everything *around* it shippable? Five gates — unaccounted acceptance criteria and open follow-ups, CI status (detects the CI system rather than assuming GitHub; reads it via `gh` when that's actually available), test coverage **against whatever threshold the project itself already declares** rather than one invented here, dependency advisories when the diff touched a manifest, and a secrets scan of the diff. Its central rule: **a gate it couldn't run is `UNKNOWN`, never `PASS`** — an unrun check reported as green buys false confidence at precisely the moment someone decides to ship. Its corollary: **a verdict stamped against a tree that has since changed, or not stamped at all, is `STALE`, never `PASS`** (see "Stale gate verdicts").<br>**Verdict: blocked** — a gate failed; lists what to fix, in order.<br>**Verdict: stale** — nothing failed, but a verdict describes code that is no longer there; re-run those gates, then ship again.<br>**Verdict: clear-with-unknowns** — nothing failed but something couldn't be checked; never silently promoted to `clear`.<br>**Verdict: clear** — every gate passed on the current tree or was legitimately not applicable. |
| `devkit-docs` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash` | "devkit docs", "devkit changelog", "devkit update the docs" | Runs after `devkit-ship` comes back clear. Two jobs, the second mattering more: write the changelog entry (from the user's point of view — "sessions now survive a restart", not "refactored the auth middleware"), and **hunt down the documentation the change just falsified** — the README example that no longer runs, the renamed flag still documented as current, the obsolete setup step. Stale docs beat missing docs for harm, because people follow them. Matches the project's existing changelog format and won't start one where none exists. Fixes what it can verify from the diff and *reports* what it can't, rather than writing a plausible-sounding correction it couldn't confirm. |
| `devkit-datamodel` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash` | "devkit datamodel", "devkit schema design", "devkit migration plan" | The data-side counterpart to `devkit-ux`, and the stage this plugin used to lack entirely: a `SENSITIVE:` data-model flag stopped the loop and then offered no help. Detects the project's own ORM and migration convention, then plans the change as a *sequence* rather than an event — additive versus destructive, the backfill and what it costs at production scale, what happens to writes landing mid-migration during a rolling deploy, and the rollback path or an explicit statement that there isn't one. Writes `specs/<name>.data.md` and appends criteria to the feature spec; writes no migration and no entity class. Leads its report with anything irreversible, because that is the part a human must actually agree to. |
| `devkit-pipeline` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash` | "devkit pipeline", "devkit ci audit", "devkit what gates our merges" | Audits or scaffolds delivery. `devkit-ship` *reads* CI status and assumes a meaningful pipeline exists; this is the component that makes that true. Its framing is deliberate: not "does a workflow exist" but **"what would actually stop a bad change?"** — reporting each gate as **GATED** (failure blocks a merge), **RUNS** (executes, blocks nothing) or **MISSING**, plus **UNKNOWN** where it could not check, because the gap between GATED and RUNS is invisible from a list of green checkmarks. Never enables branch protection, never commits a workflow, and never adds a scanner nobody will read — a permanently ignored job trains a team that red means nothing. |
| `devkit-ui-verify` | `sonnet` | `Read, Glob, Grep, Bash` | "devkit ui verify", "devkit check the screens", "devkit ui verification" | Report-only, and the only component that checks what a person actually sees. Every other gate reads code: the reviewer maps criteria to a diff, ship reads CI and coverage, the suite asserts through an API — none can tell you the empty state renders a blank screen or the loading spinner never clears. A passing suite and a broken screen coexist comfortably. Runs the app the project's own way, drives each state the `.ux.md` named, and captures the copy that actually rendered rather than a paraphrase. Its rule mirrors `devkit-ship`: **a state it could not reach is UNVERIFIED, never fine** — inducing an error state often needs a failure you have to cause, and an unchecked state reported as working is worse than no check.<br>**Verdict: matches / mismatches / partly-unverified.** |
| `devkit-deliver` | `sonnet` | `Read, Write, Edit, Bash, Glob, Grep` | "devkit deliver this milestone", "devkit commit and push", "devkit open the PR" | **The one component that touches git, and off unless the `deliver` stage is enabled.** Branches per Phase (`feat/phase<N>-<slug>`), commits with a message explaining *why*, pushes, and opens a PR **only at a Phase boundary** — a PR per milestone fragments review. Tracks `Branch:` in `PROGRESS.md`'s `## In flight` so an interrupted run resumes instead of redoing. Refuses to start unless review said `ship` and preflight said `clear`; **never delivers on `blocked`**. Enabling it is standing permission for the recoverable flow only — never force-push, never push to a default branch, never merge or enable auto-merge, never delete a branch or rewrite history, never `git add -A` blind, never `--no-verify`. If the situation seems to call for one of those, something is wrong that a human should look at. |
| `devkit-security` | `sonnet` | `Read, Bash, Glob, Grep` | "devkit security review", "devkit check this for vulnerabilities", "devkit security scan" | Report-only, and deliberately **not** a generic OWASP checklist. Its highest-value move is reading the project own stated invariants first — ADRs, `.claude/rules/`, and how sibling endpoints already do it — so "check multi-tenancy" becomes the precise question *does this new entity carry the global query filter the ADR requires?* A violated invariant the project wrote down itself needs no convincing. Works the classes that actually cause breaches, in descending order of how often each is a real root cause: broken object-level authorization (BOLA/IDOR), tenant isolation, auth and session handling, injection, sensitive data exposure, mass assignment. Every finding names a file, a line and a reachable exploitation path — "potential risk" with no path is noise, and noise is how a security review gets ignored. Covers the diff; the rest of the repo is UNKNOWN, never clean.<br>**Verdict: clear / blocked / clear-with-unknowns**, matching `devkit-ship`. |
| `devkit-implementer` | `sonnet` | `Read, Write, Edit, Bash, Glob, Grep` | "devkit implement the spec", "devkit implement \<feature\>", "run devkit-implementer" | Not report-only — writes code and tests. Checks `.claude\rajesh-devkit\test-runners.json` for a cached test command per area first; only derives one from marker files (`package.json`→`npm test`, `pytest.ini`/`pyproject.toml`→`pytest`, `*.csproj`/`*.sln`→`dotnet test`, `pubspec.yaml`→`flutter test`, `go.mod`→`go test`, `Cargo.toml`→`cargo test`) — and verifies it actually runs, not just that the marker matched — on a cache miss, writing the result back so future milestones skip re-derivation (verified: 9 tool calls to derive-and-cache vs. 2 on a cache hit, zero re-derivation). Implements one acceptance criterion at a time, RED then GREEN, never loosening a test to make it pass. For a type that doesn't exist yet it writes a compiling skeleton with none of the rules first, so the RED is behavioural rather than a compile error. It may batch several criteria through RED-GREEN only at one named grain, with a genuine RED for the whole batch and a per-criterion test that fails on that criterion's own regression, and it always discloses the batch. It never runs two test processes at once, and re-runs a surprising red alone before believing it. Checkpoints ticks into the spec and a `PROGRESS.md` `## In flight` block if the project has that convention; skips it if not. Reports back criteria covered, tests added, full-suite status, and a performance snapshot (criteria/run, suite duration, anything that cost time without progress) — never invokes the reviewer itself. |
| `devkit-dep-audit` | `haiku` | `Read, Bash, Glob, Grep` | "devkit dep audit", "devkit audit dependencies", "devkit scan for CVEs" | Report-only. Detects whichever package ecosystems are present (npm/yarn/pnpm, PyPI, NuGet, pub/Dart, Go, Cargo, Maven, ...) from marker files, then runs `osv-scanner --recursive` as the universal pass (covers most ecosystems in one command) plus ecosystem-native fallbacks (`dotnet list package --vulnerable`, `npm audit`, `pip-audit`) only where the universal pass can't reach (e.g. NuGet without a lock file) — all backed by the GitHub Advisory Database / osv.dev, which aggregate NVD/CVE entries alongside ecosystem-specific advisories. Reports coverage (what was and wasn't scanned, and why), a findings table, then:<br>**Verdict: ship** — everything present was scanned, no Critical/High findings.<br>**Verdict: needs-changes** — a Critical/High finding exists.<br>**Verdict: discuss** — an ecosystem present couldn't be scanned (tool missing, no lock file, unrecognised ecosystem) so coverage is incomplete.<br>This checks *known-vulnerable dependency versions* only — it's not a substitute for `claude-security` or any other code-level vulnerability scan; install that separately if you want both (see "Security tooling" below). |
| `devkit-reviewer` | `haiku` | `Read, Bash, Glob, Grep` | "devkit review the diff", "devkit review against the spec", "run devkit-reviewer" | Report-only — never edits files. Maps every acceptance criterion in the matched spec to the diff (Met / Not Met / Partially Met / **Deferred**, with file/line evidence), lists correctness risks, out-of-scope changes, and convention violations. It reviews the committed diff *plus* the uncommitted working tree as it is on disk, and re-checks every specific finding against the file's current contents before reporting it. It ends with exactly one of:<br>**Verdict: ship** — criteria met, no material risks.<br>**Verdict: needs-changes** — unmet criteria or correctness risks found.<br>**Verdict: discuss** — ambiguity needing the owner's judgment.<br>Followed by one line: files reviewed (count) and diff size (lines added/removed). |

## Hooks

| Event | Matcher | Script | Trigger condition | Blocking behaviour |
|---|---|---|---|---|
| `SessionStart` | *(none supported)* | `scripts/session-welcome.js` | Fires when a genuine new session starts (`source: "startup"` — skips resume/clear/compact to avoid repetitive noise mid-project). | Never blocks — always exits 0. Prints contextual guidance: the bootstrap checklist if `PROGRESS.md` doesn't exist, an escalation notice if the next milestone's spec is `🔒 SENSITIVE:`-flagged, "let's spec this" if it has no spec, "implement it" if it does, or "nothing queued" if none are unstarted. Before any of those, it checks whether another live session already holds this milestone in this working tree; if so it withholds the "resume at criterion N" instruction and prints the conflict with its evidence instead (see "Two sessions, one working tree"). Its exact on-screen behavior via the harness is unverified (see Troubleshooting) — `devkit-help` is the tested fallback. |
| `Stop` | *(none — Stop doesn't support matchers)* | `scripts/continue-loop.js` | Fires on every session stop. No-ops (exit 0) if: the harness reports `stop_hook_active` (already mid-continuation); the host project has its own `.claude/skills/spec-loop/SKILL.md` (deferred to entirely — see below); no `PROGRESS.md` exists; no not-started milestone is found; **this session never said `devkit continue`, or said it for a milestone that has since shipped** (silently, and before the collision check — an idle session is not working the milestone, so it cannot collide over it; see "Starting and stopping the loop"); or the same milestone has already been nudged 8 times (runaway-loop guard, counter kept in `%TEMP%\rajesh-devkit-continue-loop`, keyed per project + milestone). | Otherwise **exit 2**. Checked first, above the nudge counter and the telemetry append: if another live session already holds this milestone in this working tree, it surfaces that with its evidence and asks who owns the milestone, rather than nudging the chain forward — a collision is not a nudge, so it burns none of the eight and logs no `milestone_started`. Failing that, three possible instructions to stderr, checked in order: (1) if the milestone's spec is `🔒 SENSITIVE:`-flagged and hasn't been escalated yet this milestone, stop and ask the user whether to implement directly at higher reasoning instead of delegating — shown once per milestone, not on every repeat nudge (see "Sensitive-milestone escalation" below); (2) if no spec exists yet, draft one with `devkit-specify` first; (3) otherwise implement test-first (RED-GREEN) and invoke `devkit-reviewer` on the diff. Exit 2 on a Stop hook blocks the stop and feeds that stderr text back to Claude as the reason to keep going. |
| `PostToolUse` | `Edit\|Write` | `scripts/run-verify.js` | Fires after every Edit or Write tool call. | If no verify script (`.claude/verify.js`, `.sh` or `.ps1`) exists in the host project, exits 0 silently (no-op). If it exists, runs it and **exits with whatever code it returned** — no remapping. The verify script's own exit-code convention is what decides whether Claude sees the failure (see the contract below). |
| `PostToolUse` | `Edit\|Write` | `scripts/track-milestones.js` | Fires after every Edit or Write tool call, alongside `run-verify.js` (same matcher, both run). | Never blocks — always exits 0. Re-parses `PROGRESS.md`'s milestone statuses, diffs against a stored snapshot, and appends a `milestone_shipped` telemetry event for anything that just flipped to done. No-ops silently if there's no `PROGRESS.md` or no recognisable milestone lines. |
| `PostToolUse` | `Edit|Write` | `scripts/write-resume.js` | Fires after every Edit or Write tool call, alongside the other two. | Never blocks - always exits 0. Rewrites `.claude/rajesh-devkit/resume.json` with where the loop actually is: milestone, spec, spec status, criteria ticked, next criterion, branch, dirty tree, provider. Every field is derived from the repo, so it needs no cooperation from the model and can never be more than one edit stale. This is the hook that makes a usage limit survivable - it is the only one that has already run when a session is blocked mid-criterion and gets no further turn. `SessionStart` reads it back. It also renews this session's entry in `session-lease.json` on every edit, which is the most frequent sign of life the plugin can publish. Defers to a project own loop skill like every other writing hook. |

| `UserPromptSubmit` | *(none)* | `scripts/loop-command.js` | Fires on every prompt; acts only when the prompt *starts with* `devkit continue`, `devkit continue all` or `devkit pause`. | Never blocks — always exits 0. `continue` records that this session drives the next milestone (or, with `all`, the whole queue) and hands the session the Stop hook's current instruction as its first step; `pause` removes that and drops the session's claim on the milestone. Everything else passes through untouched. |

### Starting and stopping the loop

```
devkit continue       take the next milestone; the loop drives it until it ships, then waits
devkit continue all   the same for the whole queue - an unattended run
devkit pause          stop driving this session and drop its claim
```

Type them as the whole message, or at least at the start of it; mentioning
them mid-sentence ("why did devkit continue stop?") changes nothing.

**Any session can continue the loop** — the window where the milestone
started, a new one, another machine, or the OpenRouter fallback. Progress
lives on disk (the spec's ticks, the working tree, `resume.json`), not in the
window, so a brand-new session that says `devkit continue` resumes at the
next unticked criterion rather than starting over.

- **Each session starts idle** and needs its own `devkit continue`. That is
  what keeps a window opened for other work from being driven.
- **Saying it again is harmless.** If a session stops being nudged and you
  are not sure why — after `/clear`, say — just say `devkit continue`.
- **Two windows can't drive the same milestone.** `devkit continue` checks
  first: if another live session already holds the milestone, the loop is
  *not* started — you're told which session holds it, and asked nothing
  again. To move the milestone, say `devkit pause` (or `/exit`) in the other
  window, then `devkit continue` in this one. A window that has already
  closed, crashed or hit a usage limit needs nothing: its claim expires on
  its own about 15 minutes after its last activity.
- **If a collision turns up later** (another session starts the same
  milestone after this one did), the next pause reports it **once**, pauses
  the loop in this session and releases its claim. It never repeats the
  question. That repetition was a real cost: a hook can't hear "I'll do other
  work", so it used to ask at every stop, and each time forced another turn
  with the whole conversation attached — on a paid gateway, 80–100k tokens a
  time. (Under `"loopStart": "always"` there is no loop to pause, so there it
  still repeats.)

**Why the loop waits to be asked.** Until 0.7 the `Stop` hook drove *every*
session in a project with an unfinished milestone, and every session claimed
that milestone just by existing — `SessionStart` claimed it, every edit and
every stop renewed it. Found in real use: after a milestone ended, a new
session opened for unrelated work was told at every stop that another
session held the next milestone and asked which one owned it. The user
answered "neither"; the hook, which cannot hear answers, asked again at the
next stop. That session's own advice was to switch the plugin's hook off —
the opposite of what a loop plugin should teach.

Now a session is driven only after `devkit continue`, and only a driving
session claims a milestone, so an idle session is never nudged, never asked
about collisions, and never reported to anyone else as "the other session".
The start-up banner still says what's next and how to start it. The state
lives in `.claude/rajesh-devkit/loop-arm.json`, keyed by session id, next to
the rest of the gitignored state; `devkit continue` in a fresh session
resumes from `resume.json` exactly as before.

**The loop stops at every shipped milestone** unless you said `all`. That is
deliberate: it is the point at which a person looks at what shipped before
the next thing starts. A project that genuinely wants every session driven
unattended can set `"loopStart": "always"` in `.claude/devkit.json` to get the
pre-0.7 behaviour back.

### Why the Stop hook defers to a project's own loop skill

If a host project already has a milestone-loop skill (like the `spec-loop`
skill this was modeled after), that skill owns its own stop conditions
deliberately — a reviewer `discuss` verdict, a Phase-boundary pause, a genuine
ambiguity. An unconditional Stop hook has no way to tell "the skill chose to
pause here on purpose" from "the session just stopped" — it would nudge past
exactly the pauses the skill built in. So `continue-loop.js` checks for
`.claude\skills\spec-loop\SKILL.md` first and gets out of the way entirely if
it's there, acting only as a fallback for projects that don't have an
equivalent skill of their own.

**That detection is a default, not a verdict.** It was a one-way door for
too long: the project this toolkit was extracted from still carries the
`spec-loop` skill it grew out of, so installing the plugin there did
precisely nothing — every hook stood down, the banner explained why, and the
only way to actually try the plugin was to delete the fallback first and
hope. `"loop": "devkit"` in `.claude/devkit.json` hands the stop conditions
to this plugin with both loops sitting on disk; `"loop": "project"` stands
down even where no such skill exists. With no config, detection decides
exactly as it always did.

### Sensitive-milestone escalation

Not every milestone deserves the same amount of automated trust. A schema
migration and a copy-tweak used to get nudged toward implementation
identically — nothing in the loop distinguished them. This mirrors
`spec-loop`'s own real rule (a milestone touching money/decimal handling,
multi-tenancy, or an existing invariant stops and asks whether to implement
it yourself at higher reasoning instead of delegating), generalized past
those specific categories:

`devkit-specify` marks a requirement `🔒 SENSITIVE:` when it touches an
existing invariant, a security/authorization boundary, a data-model change,
an external integration, or a backward-compatibility break — a
machine-checked marker, not just a stylistic flag, used consistently enough
that `continue-loop.js` can grep for it. Three places check for it, on
purpose, since none of them alone covers every path a milestone could take
toward implementation:

**How the marker is matched.** The scripts match the ASCII keyword alone
(`SENSITIVE\s*:`, case-sensitive) — **the lock glyph is not required.** This
gate fails *open*: a marker that isn't recognised means a milestone that
should have paused for a human gets auto-delegated instead, silently. Since
the marker is written by a probabilistic model and read by an exact matcher,
the matcher is the side that has to be forgiving. Dropping the glyph
requirement makes every realistic near-miss still escalate — no space after
the glyph, a variation selector (`U+FE0F`) appended to it, the glyph omitted
entirely, or the spec file read back through the wrong codepage (which
mangles the emoji but never the ASCII word). Requiring uppercase keeps
ordinary prose like "not sensitive: just a note" from tripping it. False
positives are the safe direction here — one extra question, versus losing
the gate entirely.

- **`continue-loop.js`** — the primary, automated gate. Escalates instead
  of nudging toward implementation, once per milestone (tracked in the same
  nudge-cap state file as an `escalationShown` field) — not on every repeat
  nudge, since that would just be noise once a human has already seen it.
- **`session-welcome.js` / `devkit-help`** — covers the case where a
  session never actually stops between drafting the spec and someone asking
  to implement it, so the `Stop` hook never gets a chance to fire.
- **`devkit-specify`'s own final report** — leads with the flags, for the
  same-turn case where implementation is requested immediately after the
  spec is written, before either of the above would ever see it.

None of the three *enforce* anything — they're all advisory prompts to
whichever Claude session reads them. The actual decision (implement directly
at higher reasoning, or standard delegation is fine) is always the user's,
asked explicitly, every time a new sensitive milestone is encountered.

**Measured limitation, worth knowing before you rely on this.** The gate
holds for the *loop* case — nudge, next turn, escalate — and **does not hold
reliably for the same-turn case.** Told *"continue with the next milestone"*,
a session implemented a `SENSITIVE:`-flagged milestone in one turn across
three eval runs — writing the code, adding tests, once marking `PROGRESS.md`
done — and only then asked, or didn't ask at all. The cause is structural:
`continue-loop.js` is a `Stop` hook and a single straight-through turn never
stops in between, so only `SessionStart` can act first, and that is prose a
model may not treat as binding. Rewording it more forcefully did not change
the outcome.

`evals/escalation-gate-integration` is deliberately left **failing** as the
mechanical record of this. Real enforcement would need a `PreToolUse` hook
that *denies* `Edit`/`Write` while the current milestone is flagged and
unacknowledged — a design change, not a fix, and not built. Until then: if a
milestone is genuinely sensitive, decide the approach before saying
"continue", rather than trusting the gate to interrupt you.

### Two sessions, one working tree

Every other piece of state this plugin keeps answers *where did the work get
to* — `PROGRESS.md`'s `## In flight` block, the spec's ticked criteria,
`resume.json`, `git status`. None of them answers *is somebody holding it
right now*, and for a while the hooks read the first as an answer to the
second.

**What that cost, measured.** On 2026-09-22 at 21:37, `session-welcome.js`
greeted a new session in `MyHomeMaintenance` with "picking up M28 — Expense
Categories, mid-flight … resume at criterion 4". Another session had started
in the same working tree nine minutes earlier and was already implementing
M28: within that window it wrote `ExpenseCategoryService.cs`,
`ExpenseCategoryEndpoints.cs` and a 44-test `ExpenseCategoryEndpointTests.cs`,
and added `app.MapExpenseCategoryEndpoints();` plus its DI registration — the
exact two lines the newly-greeted session had independently diagnosed as
missing and was about to write itself. Nothing caught it. The second session
happened to re-list the test directory for an unrelated reason and noticed a
25KB file that hadn't been there minutes earlier. Its `dotnet test` baseline
(554 integration tests green) was already stale when it read it, and a later
filtered run reported 36 failures that were really just a stale build.

**The lease.** Each session publishes its presence to
`.claude/rajesh-devkit/session-lease.json`, next to `resume.json` and
gitignored by the same rule. `SessionStart` claims, `PostToolUse` renews on
every edit, `Stop` renews at every pause. The file holds a *list* of leases,
not one slot, because two sessions working different milestones in one tree is
legitimate and a single slot would make each evict the other.

**Keyed on session id, not pid.** The harness hands every hook a `session_id`
— verified against a live harness on `SessionStart`, `Stop` and `PostToolUse`,
not assumed from documentation. It is stable for the life of a session, unique
across them, and unlike a pid it isn't reused and doesn't belong to a hook's
own short-lived child process. `Get-Process claude` was considered and
rejected: it's Windows-only, which defeats the whole reason these hooks are
Node (see `hooks.json`), and it can't tell which repository a process belongs
to. Three `claude` processes on a machine say nothing about whether any of
them is in *this* tree. It's evidence for a human, never a mechanism.

**Liveness uses two independent signals.** A lease is live if *either* is
fresh within the TTL:

| Signal | Advances when | Blind to |
|---|---|---|
| `renewedAt` | one of this plugin's hooks runs | a long read-only stretch — `PostToolUse` only fires on an edit |
| transcript mtime | the harness appends a turn, whatever the session is doing | a session whose transcript has been moved or cleaned up |

The transcript is the one that matters, because reading-and-testing is exactly
what the *other* session was doing during the incident. Taking the later of
the two means a session has to go quiet on both counts before its claim
expires — the conservative direction, since calling a live session dead costs
a missed warning about a real collision.

**Stale claims expire.** A session killed by a usage limit gets no turn and so
never releases anything. The TTL (15 minutes by default, `sessionLeaseTtlMinutes`
to change it) clears it, and the next hook to write prunes it from the file.
Without that, the fix would be worse than the bug: a crashed session would
lock the next one out of its own milestone permanently.

**Only one shape is a conflict** — *same worktree, same milestone, a different
session, still alive*. Everything else is somebody working the way they meant
to, and a false alarm there is worse than the collision it was guarding
against:

| Situation | Conflict? | Why |
|---|---|---|
| Different session, same tree, same milestone, live | **yes** | the incident |
| Same session re-entering (`/clear`, `--resume`, a second `SessionStart`) | no | nobody to collide with |
| Different git worktree | no | `git rev-parse --show-toplevel` returns each worktree's own root, so two checkouts of one repository never match — true by construction, not by luck |
| Different milestone in the same tree | no | the queue was split on purpose |
| Lease past its TTL | no | see above |
| No lease file, corrupt file, unwritable directory | no | fails open |
| No `session_id` in the payload | no | `devkit-help` and `devkit-eval` run these scripts directly with no payload; with no identity there's no way to tell our own lease from a stranger's, and guessing would mean telling a solo session it's colliding with itself |

**What detection does — and deliberately doesn't.** It is not a lock and not
an arbiter. `session-welcome.js` withholds the "resume at criterion N"
instruction and prints the conflict with its evidence instead — the other
session's id, its branch, how long ago it was last seen and by which signal.
`continue-loop.js` exits 2 with the same evidence rather than nudging the
chain forward. Both end by asking the owner which session should own the
milestone. Neither decides.

That restraint is the design, not a shortcut. Two sessions in one tree is
sometimes exactly what was intended — a second window reading while the first
builds — and from inside a hook that is indistinguishable from a collision. A
mechanism that guessed would be wrong in the legitimate case, which is the
more common one. Blocking the *stop* to ask a question is the same move the
sensitive-milestone gate makes, and it blocks no work: reading, reviewing and
answering questions carry on fine.

**Failing open is enforced, not intended.** Every read and write is
best-effort, and the suite covers a missing lease, a corrupt one, a lease of
the wrong shape, a state directory that can't be written, and a hook invoked
with no payload at all. Writing that last test found a real latent bug in
code that predates the lease: `appendTelemetry` did an unguarded `mkdirSync`,
so a file sitting where `.claude/rajesh-devkit/` belongs threw straight out of
`continue-loop.js` — exit 1 with a Node stack trace instead of exit 2 with its
nudge, silently costing the project its whole Stop loop. It's guarded now.

### Stale gate verdicts — a verdict describes the diff it saw

**What went wrong.** In M28, `devkit-reviewer` returned `ship`,
`devkit-security` returned `clear`, `devkit-quality` returned `clean`. The
orchestrator then applied two of quality's findings — an edit to
`ExpenseCategoryService.ListAsync` and a docstring — and carried on toward
ship with all three verdicts treated as current. They described a diff that
no longer existed. `devkit-ship` caught it only because it re-runs the suite
itself and happened to run *after* the edits; a fix applied after ship would
have been marked done over code nothing verified. The chain read as one-way —
gate, gate, gate, ship — and that was the bug.

**The fix: a verdict is stamped with the tree it saw.**
`scripts/record-gate.js` is a small command (not a hook) that the Stop
hook's nudge tells the orchestrator to run, with its absolute path filled
in:

```bash
node <plugin>/scripts/record-gate.js review ship    # stamp a verdict
node <plugin>/scripts/record-gate.js check          # FRESH or STALE, per gate
```

The stamp is a content hash of the working tree — committed, staged,
unstaged and untracked alike, minus what `.gitignore` excludes — computed
through a throwaway git index, so the user's own staging is never touched.
It lives in `.claude/rajesh-devkit/gates.json`, gitignored with the rest of
the state. `check` hashes the tree again and compares. It is computed on
demand rather than kept up to date by the `PostToolUse` hook on purpose:
that hook fires only on `Edit`/`Write`, so an edit made through Bash (a
formatter, `sed`, codegen) would slip past it; hashing at the moment of the
question has no such hole.

**It fails safe.** A verdict reads `FRESH` only when its stamp provably
matches the tree now. Everything else is `STALE`: the tree changed, the
verdict was recorded for another milestone, the project is not a git
repository, git is missing, or — the case that matters most — a verdict
exists in the conversation with no stamp at all. Unknown provenance is never
a pass: a gate re-run unnecessarily costs minutes; a stale pass costs
shipping code nobody verified.

**Where it is enforced.**
- `continue-loop.js`'s chain now says what happens after a gate's findings
  are applied: every verdict stamped before that edit is stale, and the
  gates run again — gates, fixes, gates, until a round passes with no edits
  after it. It asks for one last `check` before the milestone is closed out,
  which is what catches a fix applied *after* ship.
- The Stop hook itself re-judges every stamp recorded for the current
  milestone at each stop and names any that went stale — the half of this
  that needs nobody to remember anything. (It only hashes the tree when the
  milestone has stamps at all, so a project that never records costs
  nothing.)
- `devkit-ship` reports a stale verdict as **`STALE`** — not `PASS`, not
  `BLOCKED` — with its own verdict, **`stale`**, ranked below `blocked` and
  above `clear-with-unknowns`. It is kept distinct from `UNKNOWN`: STALE
  means "ran, but on something else", UNKNOWN means "never ran", and the fix
  differs. Ship now has a Review row too, since the reviewer's verdict is the
  one most likely to be issued first and acted around afterwards.
- `devkit-deliver` refuses to commit on a `stale` preflight.

**What is not stamped.** `devkit-datamodel` produces a plan *before* the
code exists, so its stamp would always read stale and teach everyone to
ignore the word; ship checks that plan against the diff directly instead.

**The honest limit.** Recording relies on the orchestrator running
`record-gate`. When it forgets, nothing false happens — the verdict is
unstamped, so ship reports it `STALE` and the gate runs again. Forgetting
costs a re-run, never a false pass, which is the direction that matters.

### Loop stages — not everyone runs the whole chain

A product owner wants to write specs and document what shipped. A UX
designer wants the design stage and nothing downstream of it. A backend
engineer wants schema, implementation and review. A DevSecOps engineer wants
pipelines and release gating. And a project that already has its own
spec/implement/review loop wants only the parts it lacks.

A loop that nudges toward stages its owner never wanted is noise they learn
to ignore — which costs you the nudges that *did* matter. So the chain is
configurable, in one committed file:

```json
// .claude/devkit.json
{ "role": "product-owner", "stages": ["specify", "docs"] }
```

Valid stages: `specify`, `ux`, `datamodel`, `implement`, `ui-verify`,
`review`, `quality`, `security`, `ship`, `docs`, `release`, `pipeline`,
`deliver`. Every one except `deliver` is
on by default. `role` is a label for humans; only `stages` changes
behaviour. `devkit-onboard` asks the question during setup and writes the
file.

**No file means every stage is enabled**, so a project that never answers
behaves exactly as it did before this existed. For a narrower loop that's
yours alone rather than the repo's, `.claude/rajesh-devkit/devkit.local.json`
takes the same shape, is gitignored, and wins over the committed one. A
malformed file is treated as absent and the full loop runs — a hook that dies
on a typo in a config file is worse than one that does what it always did.

Two behaviours make a narrow loop a real loop rather than a crippled one:

- **It stops.** When every enabled stage for a milestone is done, the `Stop`
  hook allows the stop instead of pushing toward stages nobody enabled. A
  product owner's loop genuinely ends at "the spec exists".
- **It stays quiet about work it doesn't own.** A `ux`-only or `ship`-only
  loop facing a milestone with no spec says nothing, rather than telling
  someone to go write one.

The escalation gate follows the same rule: it fires only when `implement` is
enabled, because its entire question is whether to delegate to
`devkit-implementer`. With implementation out of scope, there's nothing to
ask.

**One combination gets named, not blocked.** A loop with `implement` on and
`review`, `security` or `ship` off calls code done without that check.
That's legitimate — a backend engineer whose team reviews in the PR may want
exactly that — but the config file makes it look identical to a loop nobody
thought about, and the "`UNKNOWN`, never `PASS`" rule lives inside
`devkit-ship`, so switching `ship` off removes the one place an unrun
check would have been reported. The `SessionStart` banner therefore adds
one sentence naming the gate stages that are off whenever `implement` is
on, once per session. `skippedGates()` in `scripts/lib/devkit.js` is the
whole rule; a loop that doesn't implement gets no note, because there's no
code to gate.

**What stage config does not fix: trigger-phrase collisions.** Stages control
what the loop *nudges toward*. Every installed component is still loaded by
the harness, so if a host project already has a skill triggered by "write a
spec", `devkit-specify` answers to that phrase too. Disabling the `specify`
stage doesn't change that — it's a separate problem with a separate fix.

### The rest of `.claude/devkit.json`

`stages` and `role` are the two most people need. The other keys exist
because a real project turned out to need them, and each one defaults to the
behaviour that existed before it:

```json
{
  "role": "full-stack-developer",
  "stages": ["specify", "ux", "implement", "review", "security", "ship", "docs"],
  "loop": "devkit",
  "loopStart": "keyword",
  "parkedPattern": "not spec'd",
  "checkpointCommit": true,
  "sessionLeaseTtlMinutes": 15,
  "sensitivePatterns": ["Money is `decimal`", "multi-tenan", "existing invariant"],
  "prices": { "qwen/qwen3-coder": { "input": 0.3, "output": 1.0 } }
}
```

- **`loop`** — `"devkit"` makes this plugin drive even where the project has
  its own `spec-loop` skill; `"project"` makes it stand down even where it
  doesn't. Absent, detection decides, exactly as before. This exists because
  detection alone is a one-way door: the project this toolkit was extracted
  from still has the skill it grew out of, so installing the plugin there
  did nothing at all, and the only way to try it was to delete the fallback
  first. Now both can sit on disk and one of them drives.
- **`loopStart`** — `"keyword"` (the default) means a session is driven by
  the loop only after the user says `devkit continue`; `"always"` drives
  every session from the moment it starts, which was the behaviour before
  0.7 and is right for a project that runs unattended on purpose. See
  "Starting and stopping the loop".
- **`parkedPattern`** — a regex matched against the *annotation* in a
  milestone row's status cell. A row that matches is skipped by the loop and
  reported by `devkit-help` instead. Defaults to "not spec'd" and its
  spellings, because a tracker that doubles as an idea list has rows that are
  genuinely unstarted and genuinely not next — nobody has decided to build
  them — and without this the loop stalls on the first one forever, nudging
  for a spec somebody deliberately parked. Parked is not hidden: they are
  still listed on request.
- **`checkpointCommit`** — `true` makes `devkit-implementer` commit
  `wip(M<N>): …` after each green criterion, which `devkit-deliver` squashes
  at ship. Off by default. See "Running on another provider" for the one
  situation that earns the history noise.
- **`sessionLeaseTtlMinutes`** — how long another session's claim on a
  milestone stays believable without a fresh sign of life. Defaults to 15.
  Clamped to 1–240, because 0 would switch collision detection off silently
  and a huge value would let a crashed session hold its milestone hostage —
  the exact lockout the TTL exists to prevent. See "Two sessions, one working
  tree" below.
- **`sensitivePatterns`** — extra regexes that fire the escalation gate,
  ORed with the built-in `SENSITIVE:` marker. For a project whose spec
  template predates this plugin and flags the same five categories in its own
  words. They can only make the gate fire *more* often, which is the safe
  direction for a gate that fails open. A malformed pattern disables itself
  and says so; it never takes the hook down.
- **`prices`** — $/MTok for models the cost report has never heard of, i.e.
  anything served through a gateway. Without it, a milestone run on a gateway
  reports `$0.00`, and a cost report that says a run was free is worse than
  one that admits it doesn't know. `node profiles/check.js` prints current
  list prices to copy from.

### A loop per person, on the same repo

The stage list is what lets two people work the same project without either
one's loop nagging about the other's job. The committed `.claude/devkit.json`
is the repo's declared process; `.claude/rajesh-devkit/devkit.local.json` is
one person's, gitignored, and wins.

A UX designer joining a project whose backend loop is already running wants
their machine to nudge toward design work and nothing downstream of it:

```json
// .claude/rajesh-devkit/devkit.local.json  (theirs alone, not committed)
{ "role": "ux-designer", "stages": ["ux", "ui-verify"] }
```

That loop nudges toward `devkit-ux` while a milestone's `.ux.md` is missing,
toward `devkit-ui-verify` once there's a built UI to drive through its
states, and **says nothing at all** about a milestone that has no spec yet —
writing specs isn't their job, and a nudge to do someone else's work is how a
loop teaches you to ignore it. Meanwhile the repo's committed config is
untouched, so nobody else's loop changes.

### Test layers — what a green tick actually proves

A criterion can be ticked by a test that never exercised the path production
uses, and that is the most expensive kind of green: everything downstream now
believes it. The failure shape is concrete — a suite that builds its schema
from the model never executes a migration, so it cannot fail on a broken one
no matter how many tests it has. A real project shipped a table with no
migration for exactly that reason, and CI would have caught it if CI had ever
run the migration path.

So a criterion that **cannot honestly be proven by a unit test** is marked
with the layer that proves it:

```markdown
- [ ] complete(store, id) sets done = true on that task
- [ ] [integration] the migration applies cleanly to a populated database
- [ ] [contract] the /tasks response still carries every field the mobile client reads
- [ ] [e2e] a user can archive a task from the list and it is gone after reload
```

`[integration]` is a real dependency this codebase owns (database,
migration, queue). `[contract]` is an agreement with something deployed
separately — a mobile client, a partner API, a webhook consumer — proven by
the recorded contract both sides run. `[e2e]` is the full user path, and is
reserved for criteria genuinely about the whole path. They are not
interchangeable: an `[integration]` mark on what is really a `[contract]`
criterion buys a Postgres-backed test that never sees the client that will
break.

`devkit-specify` marks it. `devkit-implementer` must prove it at that layer,
and **stops rather than quietly satisfying it with a substitute** if the
integration suite cannot run on this machine. `devkit-reviewer` checks where
the test actually lives and what it runs against, not merely that a test
exists. The implementer also reports which layer each criterion was proven
at, so a downgrade is visible rather than inferred.

Unmarked means a unit test genuinely proves it. The markers are not
ceremony — they are for things whose truth depends on something the unit
test cannot see. A project with no contract or end-to-end mechanism gets a
finding from the implementer, not a unit test dressed as one.

### Localisation — copy is a key, not a literal

`devkit-ux` finds how the project handles user-visible strings before it
writes any (`.arb` + `intl`, `i18next`, `.resx`, gettext, `strings.xml`, a
`t()` helper — whatever is actually there), reads three existing keys for
the naming convention, and then specifies every string as a key plus its
default-locale text, with plurals and arguments in the mechanism's own
form. It appends localisation criteria to the feature spec — no hardcoded
string, every locale has the key, counts use the plural form — so
`devkit-implementer` adds entries to the locale files rather than typing
English into a widget, `devkit-reviewer` names any literal that slipped
through, and `devkit-ui-verify` drives a second locale where one ships.

A project with no i18n mechanism gets plain copy and one line under Open
design decisions. Adding i18n is a project decision; a UX spec doesn't
introduce it through the back door, and it doesn't work against a project
that already has it either — which is what a spec full of literal strings
was doing.

### Observability and performance — decided in the spec, not discovered in production

A feature that works and cannot be debugged when it doesn't is half-built,
and nothing in a spec's acceptance criteria said otherwise. Two sections in
the spec template close that: `## Observability` says what the person on
call sees - which events, with which fields, through the project's own
logging or metrics mechanism, never a secret or a request body - and
`## Performance budget` says the volume the feature must hold at and the
latency it must meet there, as a number someone can measure.

Both become criteria the loop gates on: `[observability]` marks one
asserting the event or metric exists with the named fields, `[perf]` one
asserting the budget at the budget's volume. `devkit-implementer` emits
through what the project already uses. Nothing here requires a particular
stack: OpenTelemetry, Prometheus, Datadog and Application Insights are
project decisions, and most projects have structured logging long before
they have a metrics pipeline. A signal the project has no mechanism for is
handled one of two ways — if the project has *recorded a plan* for it (a
`PROGRESS.md` milestone, an ADR), the criterion is specified in
mechanism-neutral terms and deferred into `Tracked follow-ups` with that
milestone as the unblock condition, so the feature ships with the logging
it can have now and the metrics arrive already specified; if there is no
mechanism *and* no plan, the implementer **stops** — picking a stack is an
ADR, and an ad-hoc print statement is noise, not observability. `devkit-reviewer` checks the fields and the
volume. `devkit-quality` reviews the diff's queries and loops against the
budget's number, and says so when it had to pick one because the spec
didn't.

The plugin still ships no telemetry into your product. What it does is
refuse to let "how will we know this works in production" go unasked.

### Tracked follow-ups — deferred work that can't vanish

A criterion someone decides *not* to implement is the one thing in this loop
that used to disappear without trace: it stayed unticked in the spec, the
implementer's report explaining why scrolled out of the session, and nothing
afterwards remembered it existed. The spec then sat there looking like an
unfinished job rather than a finished one with a recorded exception.

So a deliberate deferral goes in **`PROGRESS.md`'s `## Tracked follow-ups`
table**, which `devkit-implementer` appends a row to:

```markdown
## Tracked follow-ups

| Item | Status | Source | Notes |
|---|---|---|---|
| archive(store, id) removes a done task from list() | ⬜ | [specs/task-completion.md](specs/task-completion.md) | Deferred 2026-09-17 during M4. Why: depends on the notification service, which isn't built yet. Unblocks when: notifications ship (M7). |
```

**Why `PROGRESS.md` and not the spec**, since the spec is where the criterion
lives and co-location looks obviously right: a follow-up exists precisely
because someone returns to it *later*, but a spec's active life **ends** when
it ships. Recorded in the spec, a follow-up is archived the moment it's
created — filed into a document nobody re-opens.

This isn't reasoning from first principles; it's measured. The project this
toolkit was modelled on has run this loop for 45 milestones and carries **36
open follow-ups — and 11 of the 15 specs they point at are already
`Status: Implemented`.** Every one of those would now be invisible if it had
been written into the spec. (The plugin originally did put them in the spec.
That was wrong, and this is the correction.)

Three rules keep it honest:

- **The criterion stays unticked** in `## Acceptance criteria` while the
  milestone is in flight. A deferred criterion is not a met one, and ticking
  it to tidy up is the exact silent loss this prevents.
- **The `Source` column preserves the context** co-location would have given
  you — it points back at the spec and criterion, so nothing is lost, just
  indexed.
- **Never record it in both places.** Double-entry drifts, and then nobody
  knows which is true. The table is the source of truth.

`devkit-reviewer` reads the table and reports every deferred criterion by
name even when its verdict is still `ship`; it returns `needs-changes` for a
criterion that's ticked *and* has a follow-up row, or dropped with no row at
all. `devkit-ship` blocks on any unchecked criterion with no row. And
`devkit-specify` reads the table before writing a new spec — one read rather
than a grep across every spec — so a feature that's really an old follow-up
coming due gets linked to the original instead of silently restated as new
work.

## Testing this plugin

```bash
node --test
```

36 test cases, `node:test` — built in, so no Pester, no npm install, nothing
to set up, and it runs on Windows, macOS and Linux alike. Invoke it through
`devkit-eval` to also get the drift checks that no script can make.

(`node --test tests/` does **not** work on Node 22 — it treats the directory
as a module path and fails with `Cannot find module`. Bare `node --test`
auto-discovers `*.test.js`.)

Most of it is **behavioral, not unit**: the hooks are executed as real
processes against throwaway fixture projects under the OS temp dir, with
stdin fed a JSON payload and stdout/stderr/exit code captured separately —
because exit code 2 plus the right stderr text *is* this plugin's contract
with the harness. Testing the contract survives refactoring in a way that
testing internals doesn't, and it proved that: **this suite carried over from
the PowerShell hooks to the Node ones without a single behavioural assertion
changing.** Covered: the escalation matcher against every realistic rendering
of the marker, nudge routing, every quiet-exit condition, all three hooks
deferring together to a project's own loop, the once-per-milestone escalation
state, the 8-nudge cap, telemetry format and BOM-freeness, `.gitignore`
idempotency, `run-verify`'s exit-code pass-through and lookup order, and
`session-welcome.js` agreeing with `continue-loop.js` (which is
`devkit-help`'s entire promise).

On its first run this suite immediately earned itself, in both directions:

- **A real latent bug** — `track-milestones.js` carried a raw `🟨` literal in
  a comment. That's `U+1F7E8`: astral, 4 bytes, the same hazard class as the
  lock emoji, even though this README previously listed it among the "3-byte"
  glyphs that were fine. The static check now rejects any 4-byte UTF-8
  sequence mechanically, since eyeballing is exactly how it got in. (The
  hooks are Node now, and the equivalent check keeps their sources ASCII.)
- **A vacuous test of its own** — the BOM assertion used
  `String.StartsWith([char]0xFEFF)`, and .NET's default culture-sensitive
  comparison treats U+FEFF as ignorable, so it matched *every* string, just
  like `StartsWith('')`. It's checked in raw bytes now.

Both looked identical from the summary line, which is why `devkit-eval` says
to diagnose before fixing: a test asserting the wrong thing is its own bug,
and "fixing" the product to satisfy it makes things strictly worse.

### Behavioral evals for the agents and skills

The suite above can't reach the prompt-based components. `evals/` holds
one case per component in `claude plugin eval`'s own format — a scaffolded
fixture project, a prompt, and mostly **deterministic** graders
(`file_exists`, `regex` on file contents, `tool_used`) so a case asserts on
what the component actually wrote and which tools it actually ran, not on
a judge's impression of the transcript. `evals/README.md` lists every case
and the invariant it locks in.

```bash
node tests/run-evals.js
node tests/run-evals.js --case 'ship-*' --keep-temp
```

One command on every OS. On macOS and Linux it runs the official runner
(`claude plugin eval . --scaffold --allow-tools Bash Write Edit --runs 1
--max-cost-usd 15`); on Windows it runs `tests\run-evals.ps1`, the same case
files through a bridge, with a per-process policy exception so an
`AllSigned` machine doesn't refuse it — never start that `.ps1` by hand.
The bridge exists because the official runner currently passes each scaffold path to
`bash -c` unescaped, so `C:\Dev\...` arrives as `C:Devrajesh-devkit...` and
every scaffolded case fails before Claude starts. The bridge script also
works around two machine-level traps found while getting it running: a
system-profile `WindowsApps` entry on `PATH` that's access-denied (which
makes Claude's Bash sandbox refuse to start) and `git fsmonitor--daemon`,
which detaches on the first `git add` and hangs any runner that waits on the
whole process tree.

Every eval run is a real Claude session on your credential, separate from
the desktop app's login. If runs come back with "Failed to authenticate",
run `claude login` first.

## What the host project must provide

**`PROGRESS.md` milestone format.** `continue-loop.js` scans top to bottom
for the first line matching either:

- A markdown table row with a not-started glyph in a cell by itself:
  `| <#> | <milestone name> | ⬜ |` (also recognises `⏳`) — matches this
  plugin's originating project's per-Phase tables.
- A plain markdown task item: `- [ ] <text>`.

Whichever pattern appears first, top to bottom, in the file wins. If neither
pattern matches anywhere, the hook treats the project as having nothing left
to do and stays silent.

**Verify-script contract.** Optional. `run-verify.js` looks for one of these
in the host project, taking the first that exists, in this fixed order on
every platform:

| File | Run with |
|---|---|
| `.claude/verify.js` | `node` — always available, so this is the portable choice |
| `.claude/verify.sh` | `bash` |
| `.claude/verify.ps1` | `pwsh`, or `powershell.exe` on Windows |

The order is fixed rather than platform-dependent so the behaviour is
predictable: you can tell which script will run by looking at the repo, not
by knowing whose laptop it's on. A project that only has `verify.ps1` keeps
working exactly as before.

Whichever is found is invoked with no arguments after every Edit/Write and
**its exit code is passed straight through, unmapped**. Claude Code only
treats **exit code 2** from a PostToolUse hook as "surface this to Claude" —
so if you want a failing verify step to actually get Claude's attention, your
script should exit `2` on failure (its own stdout/stderr passes through
unchanged; `run-verify.js` doesn't redirect it). Any other non-zero code still
propagates but isn't guaranteed the same treatment. A typical verify script
runs the project's fast checks — lint, a quick test subset, a build — and
should stay fast, since it runs after *every* edit.

If a verify script exists but no interpreter for it does — a `verify.ps1` in
a repo cloned onto macOS with no `pwsh` — `run-verify.js` exits `0` and says
so loudly on stderr. Exiting `2` there would block every edit over a setup
problem, but staying silent would be worse: a verify gate that quietly never
runs is the same "unrun check assumed green" failure `devkit-ship` exists to
prevent.

**What this plugin writes into the host project, unprompted.** Beyond
reading `PROGRESS.md`/`specs/`/`CLAUDE.md`, three things live under
`.claude\rajesh-devkit\` (created automatically, gitignored automatically —
see "Telemetry" below): the telemetry log, the cached test-runner command
(`test-runners.json` — see "Subagents" above), and the
one `.gitignore` line covering all of it.

`test-runners.json` is an array of
`{area, command, workingDirectory, detectedFrom}`, written by
`devkit-implementer` on a cache miss and seeded by `devkit-onboard`. **`area`
is derived, never invented**: the stack's directory relative to the repo root,
or the literal `root` when the stack is the repo root — `root`, `frontend`,
`services/api`. That rule exists because two components write this file. When
`area` was "a short name you choose consistently", onboard seeded `"root"`
and the implementer derived `"tasklist"` for the same single-stack project
(caught by the evals); the implementer's lookup would then miss a stack that
was already cached and append a second entry for the same directory, leaving
two answers for one question. There is one entry per `workingDirectory` —
writers replace a matching entry rather than appending.

An entry may also carry `"exclusive": true` and a one-line
`"exclusiveReason"`: this suite must never run concurrently with itself.
Learned the expensive way in M28, where overlapping runs against one shared
PostgreSQL database produced 19 phantom failures, then 5, in tests the
milestone never touched, and a stray `testhost.exe` stalled `dotnet build`
on file locks twice — none of it reproducible alone. `devkit-implementer`
and `devkit-ship` both run one test process at a time regardless, and
re-run a red result alone before believing it; the flag tells every later
run *why*, before it starts, rather than after an afternoon of diagnosis. Nothing else in the plugin writes
to the host project unprompted — `devkit-implementer` otherwise only writes
what you asked it to implement, and every report-only component
(`devkit-reviewer`, `devkit-dep-audit`, `devkit-stats`) never writes anything.

## Telemetry

`continue-loop.js` logs a `milestone_started` event the first time it nudges
toward a new milestone; `track-milestones.js` logs the matching
`milestone_shipped` event the moment `PROGRESS.md` marks it done. Both append
to one JSONL file **inside the host project**:
`.claude\rajesh-devkit\telemetry.jsonl` (plus `telemetry.snapshot.json`,
`track-milestones.js`'s own bookkeeping for detecting a status flip).
`devkit-stats` reads that file and reports duration per milestone.

Four more files share that directory and the same one-line `.gitignore`
rule: `loop-arm.json`, which sessions the user started the loop in (see
"Starting and stopping the loop"); `resume.json`, the machine-written checkpoint that makes a usage limit
survivable; `session-lease.json`, which records which sessions are currently
live against this working tree and on which milestone (see "Two sessions, one
working tree"); and `gates.json`, each gate's latest verdict stamped with the
tree it saw (see "Stale gate verdicts"). All four are per-machine state,
never shared history.

**Why in-project rather than a machine-global path.** An earlier version
stored this at `%LOCALAPPDATA%\rajesh-devkit\telemetry\<hash>.jsonl` — the
reasoning at the time was avoiding any modification to a host project's git
tracking without being asked first. That held up, but came at a real cost:
not portable across machines or a `git clone`, not discoverable without
knowing the hash formula, and gone for good if the profile ever gets
cleared. Asked directly, and moved it: the first time either script writes
here, it also adds one `.gitignore` line for `.claude/rajesh-devkit/` —
idempotent (checked before appending), preserves whatever's already in
`.gitignore` including a file with no trailing newline, and creates
`.gitignore` from scratch if the project has none yet. Verified both edge
cases directly, not assumed. The nudge-cap counter (a different concern —
a runaway-loop safety valve, not telemetry) stays at
`%TEMP%\rajesh-devkit-continue-loop\<hash>.json`: that one genuinely
benefits from the OS clearing it eventually, so it was left where it was.

**Timing coverage is only for milestones actually driven through the Stop
hook.** A milestone implemented by hand in a session that never stopped
won't have a `milestone_started` event and won't show a duration —
`devkit-stats` says so rather than silently omitting it.

**Real USD cost per milestone.** `scripts/token-report.js` scans this
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
figure — never silently dropped, never guessed. Lookup also falls back to
the bare model ID when the transcript records a dated snapshot suffix (e.g.
`claude-haiku-4-5-20251001`) — found for real: a genuine report understated
its total by ~10% before this fallback existed, since the exact-match lookup
silently routed those tokens into `unknownModelTokens` instead.

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

- **Escalation keeps re-appearing for the same milestone.** It should only
  show once (`escalationShown: true` in
  `%TEMP%\rajesh-devkit-continue-loop\<hash>.json`) — if it's repeating,
  check whether something is clearing that state file between nudges (a
  full state reset also clears `escalationShown`, same as the nudge count).
- **A milestone that should have escalated didn't.** Check the spec file
  contains the uppercase word `SENSITIVE:` immediately before the flagged
  requirement. The lock glyph in front of it is optional and so is the
  spacing — what the matcher needs is the ASCII keyword and its colon (see
  "How the marker is matched" above). If the requirement was paraphrased
  ("this one is risky") or flagged with a different convention entirely,
  nothing will fire; re-run `devkit-specify`, or add the marker by hand.
- **Contributing to this plugin: don't put a raw emoji literal directly in
  a `.ps1` file's source.** Found the hard way: a BOM-less `.ps1` file's
  4-byte/astral-plane UTF-8 characters (most emoji, including the lock
  marker) get misread by Windows PowerShell 5.1's default-codepage script
  parsing — a real syntax error (`Missing ')' in method call`), not just a
  display glitch. Build the string from its Unicode codepoint instead:
  `[char]::ConvertFromUtf32(0x1F512)`. This applies to the status glyphs too,
  and one of them is easy to get wrong: ⬜ (`U+2B1C`), ✅ (`U+2705`), ⏳
  (`U+23F3`) and ⏸ (`U+23F8`) really are 3-byte, but **🟨 is `U+1F7E8` —
  astral, 4 bytes, same hazard class as the lock**, despite sitting visually
  alongside the others. The suite now enforces this mechanically
  (it rejects any 4-byte UTF-8 sequence in a `.ps1`, comments included) rather
  than leaving it to eyeballing, which is exactly how 🟨 slipped through. The
  genuinely 3-byte glyphs
  happened not to break the parser this way, but they were *also* silently
  relying on an accidental cancellation (the same misinterpretation hitting
  both the script's own literals and `Get-Content`'s default-encoding reads
  of `PROGRESS.md`) rather than being genuinely correct — every glyph in
  this plugin's scripts is now built the same codepoint-safe way, and every
  `Get-Content` call reading non-ASCII content specifies `-Encoding UTF8`
  explicitly. Don't reintroduce either shortcut.
- **`devkit-implementer` is using a stale test command** (the project
  switched test frameworks, moved directories, or the cached one was wrong
  to begin with). Delete or edit
  `.claude\rajesh-devkit\test-runners.json` — a broken cached command that
  fails as a genuine tooling error self-heals on the next run (the agent
  updates the entry once it finds a working equivalent), but a command
  that's merely *wrong* now (points at a test suite that no longer exists,
  say) won't be detected as broken and needs manual correction.
- **Don't want the automatic `.gitignore` edit at all.** Add
  `.claude/rajesh-devkit/` to `.gitignore` yourself before the first
  milestone nudge — both scripts check for that exact line first and skip
  the write entirely if it's already there, so pre-adding it is a complete
  opt-out of the auto-edit, not just a race you might win.
- **Telemetry from before this was moved is stranded at
  `%LOCALAPPDATA%\rajesh-devkit\telemetry\<hash>.jsonl`.** There's no
  auto-migration — it's an orphaned file now. Safe to delete once you don't
  need the history; nothing reads that path anymore.
- **No welcome banner appears when a new session starts.** `SessionStart`
  hooks' exact on-screen behavior wasn't empirically verified against a
  live harness while building this (this plugin's own OAuth doesn't carry
  into a nested `claude` session, so a real end-to-end "does the banner
  actually render" test wasn't possible — `session-welcome.js`'s own logic
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
  not in a subfolder. Then confirm the plugin is actually *loaded in this
  session* — not merely installed: check the session's available agents
  include `rajesh-devkit:devkit-implementer`. `claude plugin list` saying
  "enabled" does not prove it; the usual cause is a session started from a
  parent directory of a `--scope project` install (see "Install").
- **"Agent type not found" for a `devkit-*` subagent.** Same cause, every
  time so far: the session's working directory is not the project the
  plugin was installed into. Restart Claude Code *in* that directory, or
  install with `--scope user`.
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
  not a bug in `token-report.js`.
- **`devkit-stats` shows a cost total but `unknownModelTokens` is
  non-zero.** A model outside `token-report.js`'s pricing table appeared in
  the window — check its `byModel` output for which one, then update the
  `$Pricing` table in the script if it's a model this plugin should know
  about now.
- **`run-verify.js` does nothing.** By design, unless
  a verify script exists in the host project (`.claude/verify.js`, `.sh` or
  `.ps1`). Create one if you want the edit-time check. If one exists but its
  interpreter doesn't, the hook says so on stderr rather than skipping
  silently.
- **`node` not found when a hook fires.** The hooks are declared in exec form
  (`"command": "node"`, `"args": [...]`), so `node` must be resolvable on the
  `PATH` the harness launches them with. It normally is — Claude Code is a
  Node program — but a native-installer build can bundle its own runtime
  without putting `node` on your `PATH`. `node --version` in the same shell
  you launch Claude from is the quick check; if that fails, install Node or
  add it to `PATH`.
- **"…cannot be loaded… is not digitally signed" (Windows).** PowerShell's
  execution policy, refusing an unsigned `.ps1`. Nothing you need to run in
  this plugin is a `.ps1` — use the `node …` commands as written. If it's
  `claude` itself that fails this way, PowerShell picked npm's `claude.ps1`
  shim: type `claude.cmd`, or use Command Prompt or Git Bash. Don't relax the
  policy machine-wide, and don't reach for `sudo` or an admin window; see
  "On Windows" under Install.
- **An OpenRouter test answered, but nothing shows on OpenRouter's Activity
  page.** It went to your Claude subscription: the variables never reached
  `claude`. The classic cause is `$env:` lines typed into Command Prompt,
  where they fail and `claude` runs anyway. Use `node
  <plugin>/profiles/devkit.js openrouter`, which sets them on the `claude` it
  starts, and check with `--dry-run` first.
- **`devkit-stats` says no telemetry exists yet.** Either the Stop hook has
  never fired for this project (check `PROGRESS.md` exists and has a
  recognisable milestone line), or the milestone in question was implemented
  by hand without the session ever stopping in between — that's the known
  timing-only coverage gap documented above, not a bug to chase.
- **A milestone shows "started" but never "shipped."** `track-milestones.js`
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
| `ae54ee7` | 2026-09-15 | Added `token-report.js` (real USD cost from session transcripts, pricing sourced from the `claude-api` skill, verified against a real transcript) and extended `devkit-stats` with cost + a heuristic manual-effort/speedup comparison; dogfooding this one too found and fixed a real pairing gap (a `milestone_shipped` event with no preceding `milestone_started` — a telemetry reset mid-milestone, not a bug — wasn't handled, only the reverse case was) |
| `f63d6fd` | 2026-09-15 | Added a spec-existence check to `continue-loop.ps1` (it previously nudged toward implementing a milestone even with no spec yet — verified in all three cases: no spec, kebab-case filename match, header-scan fallback match); added `session-welcome.ps1` (`SessionStart` hook) and `devkit-help` (the verified on-demand fallback, since `SessionStart`'s exact on-screen behavior couldn't be tested against a live harness) |
| `a23f59f` | 2026-09-16 | Documented the existing/downloaded-project onboarding path alongside the brand-new-project one — inventory existing `.claude` components first, review rather than regenerate an existing `CLAUDE.md`, read existing docs for product intent instead of starting fresh, and the lightweight-vs-thorough `PROGRESS.md` retrofit choice |
| `070a524` | 2026-09-16 | Fixed `token-report.js`: a dated model-snapshot ID (`claude-haiku-4-5-20251001`) wasn't matching the pricing table's bare key, silently understating a real report's total by ~10% — found running an actual report, not a scripted test |
| `97d392e` | 2026-09-16 | Moved telemetry from `%LOCALAPPDATA%\rajesh-devkit\telemetry\<hash>.jsonl` to in-project `.claude/rajesh-devkit/` (gitignored automatically, one idempotent `.gitignore` edit) — asked directly why it wasn't in-project, and the portability/discoverability tradeoffs favored moving it; verified against a `.gitignore` with no trailing newline and an already-existing one |
| `4b457ce` | 2026-09-16 | `devkit-implementer` now caches the discovered test-runner command in `.claude/rajesh-devkit/test-runners.json` instead of re-deriving it every milestone — considered (and rejected, with reasoning) a Haiku subagent for running tests and a hook that auto-commits/pushes first; caching the test command was the one of the three that actually held up. Verified: 9 tool calls to derive-and-cache vs. 2 on a cache hit, zero re-derivation |
| `0b0afcc` | 2026-09-16 | Added the sensitive-milestone escalation gate (`devkit-specify` marks `🔒 SENSITIVE:`, three places check for it — `continue-loop.ps1`, `session-welcome.ps1`/`devkit-help`, `devkit-specify`'s own report — shown once per milestone) from a full-plugin gap analysis. Testing it for real surfaced a genuine bug: a raw emoji literal in a BOM-less `.ps1` file broke PowerShell 5.1's parser outright, which in turn revealed the *existing* status-glyph matching had only ever worked by an accidental cancellation of two encoding bugs. Fixed properly across all three affected scripts — every glyph built from a verified codepoint, every relevant `Get-Content` call explicit about `-Encoding UTF8` |

The last six commits all came from actually running each shipped file against
a scratch regression fixture (a local sibling repo, not published) rather than just reading
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
  The fix that follows from that constraint is the one this repo now uses:
  **`"source": "."`** — the marketplace lists the plugin at its own root, so
  the path never leaves the marketplace tree. Verified end to end: adding this
  directory as a marketplace and installing from it resolves `0.2.0` and
  reports `enabled`. A separate marketplace repo with the plugin vendored in
  as a submodule also works and is what this used before, but it is strictly
  more moving parts for a single-plugin marketplace.
- **Changed something here but the installed plugin doesn't reflect it.**
  An install is a *copy* under `~/.claude/plugins/cache/`, not a live link.
  Refresh the catalog and reinstall:
  `claude plugin marketplace update rajesh-devkit` then
  `claude plugin install rajesh-devkit@rajesh-devkit --scope project`.
  `claude plugin list` shows the version actually installed, which is the
  quickest way to tell whether a change reached it. While iterating on the
  plugin itself, `claude --plugin-dir <path>` skips the cache entirely and
  loads the working tree.
