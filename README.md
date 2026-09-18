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
Those aren't a confirmation question; they're an irreversibility one.

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
- `devkit-implementer` — implements one spec test-first (RED-GREEN), one
  acceptance criterion at a time, detecting whatever test runner the project
  actually uses (`npm test`, `pytest`, `dotnet test`, `flutter test`, `go
  test`, `cargo test`, ...) instead of assuming one.
- `devkit-reviewer` — a report-only subagent that diffs the current change
  against its spec and ends with a single verdict line.
- `devkit-ship` — the preflight between "the reviewer said ship" and "mark it
  done": CI status, coverage against the project's own threshold, dependency
  advisories, a secrets scan of the diff, and any unaccounted acceptance
  criteria. A gate it couldn't run reports `UNKNOWN`, never `PASS`.
- `devkit-docs` — writes the changelog entry a shipped milestone earns, and
  hunts down the documentation that milestone just made wrong.
- `devkit-adr` — records an architecture decision properly, interviewing for
  the alternatives and consequences that aren't inferable from code.
- `devkit-dep-audit` — a report-only subagent that checks the project's
  dependencies for known-vulnerable versions, across whichever package
  ecosystems are actually present (npm, PyPI, NuGet, pub, Go, Cargo, Maven, ...).
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
│   ├── devkit-datamodel.md      # schema + migration + backfill + rollback plan
│   ├── devkit-deliver.md        # branch, commit, push, PR - OPT-IN, off by default
│   ├── devkit-dep-audit.md      # dependency CVE audit, report-only
│   ├── devkit-docs.md           # changelog/release notes + stale-doc hunt, post-ship
│   ├── devkit-implementer.md    # RED-GREEN implementer, stack-agnostic
│   ├── devkit-pipeline.md       # CI/CD audit or scaffold, gates not files
│   ├── devkit-reviewer.md       # spec-compliance review, report-only
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
│   ├── devkit-specify/
│   │   └── SKILL.md             # spec-drafting, product-owner style
│   ├── devkit-help/
│   │   └── SKILL.md             # on-demand "what's next" (verified SessionStart fallback)
│   └── devkit-stats/
│       └── SKILL.md             # timing + real cost + heuristic effort report
├── tests/
│   ├── helpers.js              # throwaway fixtures + real-process hook runner
│   ├── static.test.js          # well-formedness: parse, ASCII, frontmatter, hooks.json
│   ├── hooks.test.js           # behavioural: real processes, real exit codes
│   └── run-evals.ps1           # Windows bridge for `claude plugin eval` (see evals/)
├── hooks/
│   └── hooks.json               # SessionStart -> session-welcome.js
│                                 # Stop -> continue-loop.js
│                                 # PostToolUse (Edit|Write) -> run-verify.js, track-milestones.js
├── scripts/                     # hooks are Node: they run on Windows, macOS and Linux
│   ├── lib/
│   │   └── devkit.js           # shared: PROGRESS.md parsing, spec lookup,
│   │                             # the SENSITIVE matcher, deference, telemetry
│   ├── continue-loop.js        # Stop hook: nudge toward next milestone
│   ├── run-verify.js           # PostToolUse hook: host's verify.js/.sh/.ps1
│   ├── track-milestones.js     # PostToolUse hook: log milestone-shipped events
│   ├── session-welcome.js      # SessionStart hook: "what's next" banner
│   └── token-report.js         # not a hook - invoked by devkit-stats on demand;
│                                 # scans session transcripts for real cost/tokens
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
want it in. Confirm it loaded with `claude plugin list`, then say
*"how do I use this plugin"* to invoke `devkit-help`, which reports what to
do next in that specific repository.

**Requirements.** Node — and you already have it, because Claude Code is a
Node program, which is exactly why every script here is written in it.
**The whole plugin runs on Windows, macOS and Linux alike**: the four hooks,
the cost scanner `devkit-stats` uses, and the regression suite (`node --test`,
built in — no Pester, no npm install).

One file stays PowerShell, deliberately: `tests/run-evals.ps1` exists
*because* of a Windows-specific bug — `claude plugin eval` passes scaffold
paths to `bash -c` unescaped there, so `C:\Dev\...` arrives mangled and every
scaffolded case dies before Claude starts. On macOS and Linux the official
runner works, and that's what you should use. Porting a Windows workaround to
other platforms would be a contradiction.

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

**Updating.** `claude plugin marketplace update rajesh-devkit` refreshes the
catalog; `claude plugin install` again picks up the new version. The version
in `.claude-plugin/plugin.json` moves whenever behaviour changes, so
`claude plugin list` tells you what you actually have.

</details>

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
   session pause naturally** — `continue-loop.js` checks for that spec
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
| `devkit-help`, `devkit-stats`, `devkit-eval` | anything | Mechanical: relay a status check, read a telemetry log, run a suite. |

**Subagents** (frontmatter `model:` is honoured, and they don't follow your
session):

| Component | Model | Why |
|---|---|---|
| `devkit-ux` | `sonnet` | Measured, not assumed: 9/9 on its eval, enumerating all eight states, reusing only existing tokens, and deriving the forbidden-vs-not-found consequence of the spec's `SENSITIVE:` requirement unprompted. It works because this component's prompt **is** the expertise — the state list and the accessibility list are written out explicitly, so the model executes a well-specified checklist rather than inventing method. |
| `devkit-implementer`, `devkit-ship`, `devkit-docs` | `sonnet` | Procedure plus evidence-gathering against a spec that already exists. |
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

## Skills

| Name | Trigger | Model / effort | What it does |
|---|---|---|---|
| `devkit-onboard` | "onboard this project", "set up devkit here", "get this repo on the loop", "bootstrap this project" | `fable`, `effort: high` | Gets a project — brand-new or with years of history — to the state the loop needs. Inventories what already exists first and never clobbers it (`CLAUDE.md`, `specs/`, a tracker under any name, other `.claude` assets, a `spec-loop`-shaped skill that would suppress the `Stop` hook), detects the stack and **seeds `test-runners.json` with a command it actually ran**, reconstructs product intent from what's already written rather than a blank page, then proposes a `PROGRESS.md` (offering the lightweight and thorough options honestly instead of choosing for you) and a shortlist of load-bearing ADRs to backfill. Ends by running the real `session-welcome.js` check to prove the loop can parse what it just built. |
| `devkit-adr` | "write an ADR", "record this decision", "adr for \<decision\>", "document why we chose" | `fable`, `effort: high` | Writes `docs/adr/<NNNN>-<kebab-title>.md`, closing the gap where `devkit-specify` *reads* decision records but nothing ever wrote one. Detects the project's existing convention (folder name, numbering, section shape) from the most recent records and matches it. Refuses to write an ADR for a non-decision, and interviews for the parts that carry the value and are never inferable — the alternatives actually rejected, the forces in tension, the consequences accepted including the bad ones, and what would make you revisit it. Never invents a rationale. Links the record back into the spec and updates any ADR it supersedes. |
| `devkit-eval` | "run the devkit tests", "eval the plugin", "check the plugin still works", "devkit regression" | `sonnet` | This plugin's own regression check, for editing *this repo* rather than a host project. Runs `tests/run-tests.ps1` (below), then checks the half no script can assert: that report-only components still declare themselves report-only, that nothing has quietly gained permission to commit, that verdict strings the orchestrator routes on are unchanged, that the handoff chain in the prompts still matches the chain in `continue-loop.js`'s nudge messages, and that the README hasn't drifted from the code. |
| `devkit-specify` | "write a spec", "spec this feature", "specify \<feature\>", "draft a spec for \<feature\>", "let's spec \<feature\>" | `fable`, `effort: high` | Learns the repo's own layout and conventions (`CLAUDE.md`, `.claude/rules/`, whatever decision-record folder it finds) before reading the relevant code, interviews you one question at a time for anything it can't infer, writes `specs/<kebab-feature>.md`, then stops — never scaffolds implementation code itself. Marks any requirement touching an existing invariant, a security/auth boundary, a data-model change, an external integration, or a backward-compatibility break with `🔒 SENSITIVE:` — the marker the escalation gate (see "Hooks" below) keys off of — and leads its final report with those flags if any exist. |
| `devkit-help` | "how do I use this plugin", "devkit help", "get me started", "what's next", "getting started with rajesh-devkit" | `haiku` | Runs the same state check as the `SessionStart` hook (below) and relays it conversationally — the verified on-demand fallback for the automatic banner. Read-only. |
| `devkit-stats` | "show dev loop stats", "how long did each milestone take", "milestone timing report", "devkit stats", "how much did this cost", "token usage report" | `haiku` | Reads the local telemetry log, pairs each milestone's started/shipped events, and reports real duration, real USD cost (via `token-report.js`'s transcript scan), and a heuristic manual-effort/speedup comparison per milestone (see "Telemetry" below for what's measured vs. estimated). Read-only. |

## Subagents

| Name | Model | Tools | Trigger | Verdict format |
|---|---|---|---|---|
| `devkit-ux` | `fable` | `Read, Write, Edit, Glob, Grep, Bash` | "ux spec", "design this screen", "what states does this need", "ux pass" | Runs between `devkit-specify` and `devkit-implementer` on anything with a user interface — the stage this toolkit previously skipped entirely, leaving every interface decision to be made implicitly, mid-implementation. Audits the existing component library and design tokens **before** designing anything, so it reuses rather than reinvents. Enumerates the states that actually break interfaces (empty, loading, partial, error, permission-denied, success, destructive-confirm) rather than only the happy path everyone builds. Reads Figma via MCP when it's configured and translates frames into the project's existing tokens instead of transcribing raw hex and pixel values; works from the feature spec alone when it isn't, which is the normal case and not a degraded one. Writes `specs/<name>.ux.md` — no component code — and **appends its accessibility criteria to the feature spec's own `## Acceptance criteria`**, which is what gives them teeth: the implementer works from criteria, and `devkit-reviewer`/`devkit-ship` gate on them. |
| `devkit-ship` | `sonnet` | `Read, Bash, Glob, Grep` | "ship check", "preflight", "is this ready to ship", "can I mark this done" | Report-only. Asks the question `devkit-reviewer` doesn't: the diff matches its spec, but is everything *around* it shippable? Five gates — unaccounted acceptance criteria and open follow-ups, CI status (detects the CI system rather than assuming GitHub; reads it via `gh` when that's actually available), test coverage **against whatever threshold the project itself already declares** rather than one invented here, dependency advisories when the diff touched a manifest, and a secrets scan of the diff. Its central rule: **a gate it couldn't run is `UNKNOWN`, never `PASS`** — an unrun check reported as green buys false confidence at precisely the moment someone decides to ship.<br>**Verdict: clear** — every gate passed or was legitimately not applicable.<br>**Verdict: blocked** — a gate failed; lists what to fix, in order.<br>**Verdict: clear-with-unknowns** — nothing failed but something couldn't be checked; never silently promoted to `clear`. |
| `devkit-docs` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash` | "update the docs", "changelog for this milestone", "release notes", "what docs did this break" | Runs after `devkit-ship` comes back clear. Two jobs, the second mattering more: write the changelog entry (from the user's point of view — "sessions now survive a restart", not "refactored the auth middleware"), and **hunt down the documentation the change just falsified** — the README example that no longer runs, the renamed flag still documented as current, the obsolete setup step. Stale docs beat missing docs for harm, because people follow them. Matches the project's existing changelog format and won't start one where none exists. Fixes what it can verify from the diff and *reports* what it can't, rather than writing a plausible-sounding correction it couldn't confirm. |
| `devkit-datamodel` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash` | "datamodel", "schema design", "design the migration", "what does this do to existing rows" | The data-side counterpart to `devkit-ux`, and the stage this plugin used to lack entirely: a `SENSITIVE:` data-model flag stopped the loop and then offered no help. Detects the project's own ORM and migration convention, then plans the change as a *sequence* rather than an event — additive versus destructive, the backfill and what it costs at production scale, what happens to writes landing mid-migration during a rolling deploy, and the rollback path or an explicit statement that there isn't one. Writes `specs/<name>.data.md` and appends criteria to the feature spec; writes no migration and no entity class. Leads its report with anything irreversible, because that is the part a human must actually agree to. |
| `devkit-pipeline` | `sonnet` | `Read, Write, Edit, Glob, Grep, Bash` | "pipeline", "set up CI", "audit the pipeline", "what gates our merges", "add security scanning to CI" | Audits or scaffolds delivery. `devkit-ship` *reads* CI status and assumes a meaningful pipeline exists; this is the component that makes that true. Its framing is deliberate: not "does a workflow exist" but **"what would actually stop a bad change?"** — reporting each gate as **GATED** (failure blocks a merge), **RUNS** (executes, blocks nothing) or **MISSING**, plus **UNKNOWN** where it could not check, because the gap between GATED and RUNS is invisible from a list of green checkmarks. Never enables branch protection, never commits a workflow, and never adds a scanner nobody will read — a permanently ignored job trains a team that red means nothing. |
| `devkit-ui-verify` | `sonnet` | `Read, Glob, Grep, Bash` | "verify the ui", "check the screens", "does it actually look right", "ui verification" | Report-only, and the only component that checks what a person actually sees. Every other gate reads code: the reviewer maps criteria to a diff, ship reads CI and coverage, the suite asserts through an API — none can tell you the empty state renders a blank screen or the loading spinner never clears. A passing suite and a broken screen coexist comfortably. Runs the app the project's own way, drives each state the `.ux.md` named, and captures the copy that actually rendered rather than a paraphrase. Its rule mirrors `devkit-ship`: **a state it could not reach is UNVERIFIED, never fine** — inducing an error state often needs a failure you have to cause, and an unchecked state reported as working is worse than no check.<br>**Verdict: matches / mismatches / partly-unverified.** |
| `devkit-deliver` | `sonnet` | `Read, Write, Edit, Bash, Glob, Grep` | "deliver this milestone", "commit and push this", "open the PR", "ship the phase" | **The one component that touches git, and off unless the `deliver` stage is enabled.** Branches per Phase (`feat/phase<N>-<slug>`), commits with a message explaining *why*, pushes, and opens a PR **only at a Phase boundary** — a PR per milestone fragments review. Tracks `Branch:` in `PROGRESS.md`'s `## In flight` so an interrupted run resumes instead of redoing. Refuses to start unless review said `ship` and preflight said `clear`; **never delivers on `blocked`**. Enabling it is standing permission for the recoverable flow only — never force-push, never push to a default branch, never merge or enable auto-merge, never delete a branch or rewrite history, never `git add -A` blind, never `--no-verify`. If the situation seems to call for one of those, something is wrong that a human should look at. |
| `devkit-implementer` | `sonnet` | `Read, Write, Edit, Bash, Glob, Grep` | "implement the spec", "build the next milestone", "implement \<feature\>" | Not report-only — writes code and tests. Checks `.claude\rajesh-devkit\test-runners.json` for a cached test command per area first; only derives one from marker files (`package.json`→`npm test`, `pytest.ini`/`pyproject.toml`→`pytest`, `*.csproj`/`*.sln`→`dotnet test`, `pubspec.yaml`→`flutter test`, `go.mod`→`go test`, `Cargo.toml`→`cargo test`) — and verifies it actually runs, not just that the marker matched — on a cache miss, writing the result back so future milestones skip re-derivation (verified: 9 tool calls to derive-and-cache vs. 2 on a cache hit, zero re-derivation). Implements one acceptance criterion at a time, RED then GREEN, never loosening a test to make it pass. Checkpoints ticks into the spec and a `PROGRESS.md` `## In flight` block if the project has that convention; skips it if not. Reports back criteria covered, tests added, full-suite status, and a performance snapshot (criteria/run, suite duration, anything that cost time without progress) — never invokes the reviewer itself. |
| `devkit-dep-audit` | `haiku` | `Read, Bash, Glob, Grep` | "audit dependencies", "check for vulnerable packages", "scan dependencies for CVEs", "dependency security check" | Report-only. Detects whichever package ecosystems are present (npm/yarn/pnpm, PyPI, NuGet, pub/Dart, Go, Cargo, Maven, ...) from marker files, then runs `osv-scanner --recursive` as the universal pass (covers most ecosystems in one command) plus ecosystem-native fallbacks (`dotnet list package --vulnerable`, `npm audit`, `pip-audit`) only where the universal pass can't reach (e.g. NuGet without a lock file) — all backed by the GitHub Advisory Database / osv.dev, which aggregate NVD/CVE entries alongside ecosystem-specific advisories. Reports coverage (what was and wasn't scanned, and why), a findings table, then:<br>**Verdict: ship** — everything present was scanned, no Critical/High findings.<br>**Verdict: needs-changes** — a Critical/High finding exists.<br>**Verdict: discuss** — an ecosystem present couldn't be scanned (tool missing, no lock file, unrecognised ecosystem) so coverage is incomplete.<br>This checks *known-vulnerable dependency versions* only — it's not a substitute for `claude-security` or any other code-level vulnerability scan; install that separately if you want both (see "Security tooling" below). |
| `devkit-reviewer` | `haiku` | `Read, Bash, Glob, Grep` | "review the diff", "review against the spec" | Report-only — never edits files. Maps every acceptance criterion in the matched spec to the diff (Met / Not Met / Partially Met / **Deferred**, with file/line evidence), lists correctness risks, out-of-scope changes, and convention violations, then ends with exactly one of:<br>**Verdict: ship** — criteria met, no material risks.<br>**Verdict: needs-changes** — unmet criteria or correctness risks found.<br>**Verdict: discuss** — ambiguity needing the owner's judgment.<br>Followed by one line: files reviewed (count) and diff size (lines added/removed). |

## Hooks

| Event | Matcher | Script | Trigger condition | Blocking behaviour |
|---|---|---|---|---|
| `SessionStart` | *(none supported)* | `scripts/session-welcome.js` | Fires when a genuine new session starts (`source: "startup"` — skips resume/clear/compact to avoid repetitive noise mid-project). | Never blocks — always exits 0. Prints contextual guidance: the bootstrap checklist if `PROGRESS.md` doesn't exist, an escalation notice if the next milestone's spec is `🔒 SENSITIVE:`-flagged, "let's spec this" if it has no spec, "implement it" if it does, or "nothing queued" if none are unstarted. Its exact on-screen behavior via the harness is unverified (see Troubleshooting) — `devkit-help` is the tested fallback. |
| `Stop` | *(none — Stop doesn't support matchers)* | `scripts/continue-loop.js` | Fires on every session stop. No-ops (exit 0) if: the harness reports `stop_hook_active` (already mid-continuation); the host project has its own `.claude/skills/spec-loop/SKILL.md` (deferred to entirely — see below); no `PROGRESS.md` exists; no not-started milestone is found; or the same milestone has already been nudged 8 times (runaway-loop guard, counter kept in `%TEMP%\rajesh-devkit-continue-loop`, keyed per project + milestone). | Otherwise **exit 2** — three possible instructions to stderr, checked in order: (1) if the milestone's spec is `🔒 SENSITIVE:`-flagged and hasn't been escalated yet this milestone, stop and ask the user whether to implement directly at higher reasoning instead of delegating — shown once per milestone, not on every repeat nudge (see "Sensitive-milestone escalation" below); (2) if no spec exists yet, draft one with `devkit-specify` first; (3) otherwise implement test-first (RED-GREEN) and invoke `devkit-reviewer` on the diff. Exit 2 on a Stop hook blocks the stop and feeds that stderr text back to Claude as the reason to keep going. |
| `PostToolUse` | `Edit\|Write` | `scripts/run-verify.js` | Fires after every Edit or Write tool call. | If no verify script (`.claude/verify.js`, `.sh` or `.ps1`) exists in the host project, exits 0 silently (no-op). If it exists, runs it and **exits with whatever code it returned** — no remapping. The verify script's own exit-code convention is what decides whether Claude sees the failure (see the contract below). |
| `PostToolUse` | `Edit\|Write` | `scripts/track-milestones.js` | Fires after every Edit or Write tool call, alongside `run-verify.js` (same matcher, both run). | Never blocks — always exits 0. Re-parses `PROGRESS.md`'s milestone statuses, diffs against a stored snapshot, and appends a `milestone_shipped` telemetry event for anything that just flipped to done. No-ops silently if there's no `PROGRESS.md` or no recognisable milestone lines. |

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
`review`, `ship`, `docs`, `pipeline`, `deliver`. Every one except `deliver` is
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

**What stage config does not fix: trigger-phrase collisions.** Stages control
what the loop *nudges toward*. Every installed component is still loaded by
the harness, so if a host project already has a skill triggered by "write a
spec", `devkit-specify` answers to that phrase too. Disabling the `specify`
stage doesn't change that — it's a separate problem with a separate fix.

### Tracked follow-ups — deferred work that can't vanish

A criterion someone decides *not* to implement is the one thing in this loop
that used to disappear without trace: it stayed unticked in the spec, the
implementer's report explaining why scrolled out of the session, and nothing
afterwards remembered it existed. The spec then sat there looking like an
unfinished job rather than a finished one with a recorded exception.

So a deliberate deferral now goes in the spec itself, in a
`## Tracked follow-ups` section `devkit-implementer` appends to:

```markdown
## Tracked follow-ups

- [ ] <the criterion, verbatim from ## Acceptance criteria>
  - Deferred: 2026-09-17, during M4 - Password reset
  - Why: depends on the notification service, which isn't built yet
  - Unblocks when: notifications ship (M7)
```

Three rules keep it honest:

- **The criterion stays unticked** in `## Acceptance criteria`. A deferred
  criterion is not a met one, and ticking it to tidy up is the exact silent
  loss this prevents.
- **Nothing moves.** The follow-up entry points at the criterion; it never
  relocates it out of the acceptance list.
- **It's for deliberate decisions only** — not work someone simply didn't get
  to, which is what an unfinished run's report is for.

`devkit-reviewer` reads the section and reports every deferred criterion by
name even when its verdict is still `ship`; it returns `needs-changes` for a
criterion that's ticked *and* deferred, or dropped with no entry at all.
`devkit-ship` blocks on any unchecked criterion with no follow-up entry. And
`devkit-specify` greps these sections before writing a new spec, so a feature
that's really an old follow-up coming due gets linked to the original instead
of silently restated as new work.

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
claude plugin eval . --scaffold --allow-tools Bash Write Edit --runs 1 --max-cost-usd 15
```

**On Windows, use `tests\run-evals.ps1` instead** — it runs the identical
case files. The official runner currently passes each scaffold path to
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
writers replace a matching entry rather than appending. Nothing else in the plugin writes
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
- **PowerShell execution policy errors.** No longer applicable to the hooks —
  they're Node now. It can still bite `scripts/token-report.js` (invoked by
  `devkit-stats`) and this repo's own `tests/run-*.ps1`. Related and worth
  knowing if you install Claude Code via npm: the `claude.ps1` shim npm
  creates is unsigned, so a default execution policy refuses it with *"cannot
  be loaded... not digitally signed"* — call `claude.cmd` directly rather than
  relaxing the policy machine-wide.
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
