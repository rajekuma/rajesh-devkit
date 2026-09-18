# Running a product through this loop

This document is the end-to-end walkthrough: how to take a product from
nothing (or from an existing codebase) to shipped features, one milestone at
a time, using this toolkit. The [README](../README.md) is the reference —
what each component does, how the hooks behave, what gets written where. This
is the narrative.

---

## The problem this exists to solve

An AI coding agent is extremely good at writing code and structurally bad at
three things:

1. **Knowing what it doesn't know.** Given an underspecified feature, it will
   produce a plausible implementation of something nobody asked for, and the
   result looks correct.
2. **Stopping.** It will keep going past the point where a human should have
   been consulted, because nothing tells it that this particular change is
   different from the last one.
3. **Remembering.** A decision made in one session — a deferral, a trade-off,
   a reason — is gone by the next one unless it was written to a file.

Every component here exists to close one of those three. The loop is not
about making the agent faster; it's about making the output *reviewable* and
the process *resumable*.

The organising principle: **each stage produces an artifact the next stage
reads, and every artifact is a file in the repository.** Nothing important
lives in a conversation.

---

## The loop at a glance

```
                    ┌─────────────────────────────────────────┐
                    │  onboard   (once, per project)          │
                    │  PROGRESS.md + conventions + cache      │
                    └────────────────┬────────────────────────┘
                                     │
   ┌─────────────────────────────────▼─────────────────────────────────────┐
   │                           per milestone                               │
   │                                                                       │
   │  specify ─► ux ─► datamodel ─► implementer ─► ui-verify ─► reviewer   │
   │  (spec)    (ux    (data       (code +        (screens    (verdict)    │
   │            spec)   spec)       tests)         verdict)                 │
   │                                                     │                 │
   │            ┌────────────────────────────────────────┘                 │
   │            ▼                                                          │
   │  quality ─► security ─► ship ─► docs ─► release ─► [pipeline] ─► [deliver]
   │  (verdict)  (verdict)   (gate)  (changelog) (Phase    (CI audit)  (branch,
   │                                             boundary:             commit, PR -
   │                                             version,              OFF unless
   │                                             notes)                enabled)   │
   │                                                                       │
   │  adr ◄── written whenever a real decision gets made                   │
   └───────────────────────────────────────────────────────────────────────┘
```

Every stage in the per-milestone box is a name in `.claude/devkit.json`'s
`stages` list — a project runs the ones it enables and the loop stops when
those are done. No file means every stage except `deliver` is on. See
[Choosing which stages run](#choosing-which-stages-run).

| Stage | Component | Produces | Reads |
|---|---|---|---|
| Onboard | `devkit-onboard` | `PROGRESS.md`, test-runner cache | the existing repo |
| `specify` | `devkit-specify` | `specs/<feature>.md` | code, ADRs, conventions |
| `ux` | `devkit-ux` | `specs/<feature>.ux.md` | the spec, component library |
| `datamodel` | `devkit-datamodel` | `specs/<feature>.data.md` | the spec, the ORM and migration tooling |
| `implement` | `devkit-implementer` | code + tests, ticked criteria | the spec and both companion specs |
| `ui-verify` | `devkit-ui-verify` | a verdict per UI state | the `.ux.md` spec, the running app |
| `review` | `devkit-reviewer` | a verdict | the spec + the diff |
| `quality` | `devkit-quality` | findings + verdict | the diff, the project's own architecture rules and budgets |
| `security` | `devkit-security` | findings + verdict | the diff, the project's own invariants |
| `ship` | `devkit-ship` | a verdict | criteria, CI, coverage, advisories, secrets, the other verdicts |
| `docs` | `devkit-docs` | changelog entry, fixed docs | the spec + the diff |
| `release` | `devkit-release` | version bump, changelog section, release notes, the tag command | Unreleased entries, shipped specs, git tags |
| `pipeline` | `devkit-pipeline` | a CI audit or a proposed workflow | the repo's CI config |
| `deliver` | `devkit-deliver` | a branch, commits, a PR | `PROGRESS.md`'s In flight block |
| Decide | `devkit-adr` | `docs/adr/NNNN-*.md` | the decision, the code |

Two more run on demand rather than as a stage: `devkit-dep-audit`
(dependency advisories) and `devkit-stats` (how long each milestone took and
what it cost).

---

## Install

Run both from inside the project you want the loop in — the repository is its
own marketplace, so there's nothing to clone:

```bash
claude plugin marketplace add rajekuma/rajesh-devkit
claude plugin install rajesh-devkit@rajesh-devkit --scope project
```

`--scope project` keeps the install scoped to the repo you're in rather than
your user profile, which matters if you work on several projects with
different conventions. See the [README](../README.md#install) for local-checkout
and single-session alternatives, and for the Windows requirement on the hooks.

Verify it loaded:

```bash
claude plugin list
```

Then ask `devkit-help` ("how do I use this plugin") at any point — it runs the
same state check the `SessionStart` banner runs and tells you what to do next
in *this* repository.

### A note on models before you start

Skills inherit your session's model; subagents do not. Spec and ADR work is
where a weak model does the most damage, so **run `devkit-specify` and
`devkit-adr` in a session set to a strong model**. See
[Which model each component runs on](../README.md#which-model-each-component-runs-on-and-why)
for why, and what to do when one rate-limits.

---

## Path A — a greenfield product

### 1. Decide what you're building (no tooling)

Deliberately manual. Talk it through and write it down — `docs/product_vision.md`
or wherever suits. A vision document generated from a one-line description is
the single artifact that will quietly misdirect every spec that follows, so
this is a conversation, not a generation step.

### 2. Onboard

```
devkit onboard this project
```

`devkit-onboard` inventories what exists (nothing, yet), detects your stack,
**runs your test command once to confirm it actually works**, caches it, and
walks you through decomposing the vision into milestones small enough to spec
and ship in one sitting. It writes `PROGRESS.md` and stops — what it just set
up is yours to review before work starts against it.

### 3. Spec the first milestone

```
devkit spec this feature: <name>
```

`devkit-specify` reads the code and any decision records first, then
interviews you one question at a time for anything it cannot confidently
infer. It writes `specs/<kebab-name>.md` and stops. It never scaffolds
implementation.

The important part: it marks any requirement touching an existing invariant,
a security/authorization boundary, a data-model change, an external
integration, or a backward-compatibility break with `SENSITIVE:`. That marker
is machine-checked — see [The four gates](#the-four-gates).

It also asks two questions that are almost never volunteered: what the
person on call sees when this fails, and how many of these there will be.
The answers become `## Observability` and `## Performance budget`, and
from those, `[observability]` and `[perf]` acceptance criteria that the
implementer must prove through the project's own logging and metrics, the
reviewer checks field by field, and `devkit-quality` uses as the bar for
its performance pass. A project with no logging or metrics mechanism gets a
stop and an ADR question, not an ad-hoc print statement.

### 4. Design the interface (only if there is one)

```
devkit ux spec
```

`devkit-ux` audits your existing components and design tokens *before*
designing, so it reuses rather than reinvents, then enumerates the states
that actually break interfaces — empty, loading, partial, error,
permission-denied, success, destructive-confirm. Where the project has an
i18n mechanism, every string it specifies is a key plus its default text in
that mechanism's form, plurals included. It appends accessibility criteria
— and localisation criteria, where they apply — to the feature spec's own
acceptance list, which is what gives them teeth: the implementer works from
acceptance criteria, and the later gates check them.

### 5. Plan the data (only if stored data changes)

```
devkit datamodel
```

`devkit-datamodel` is the data-side counterpart of `devkit-ux`: it turns the
spec's data requirements into `specs/<name>.data.md` — entities and
constraints, the migration, a backfill strategy for rows that already exist,
a rollback path, and what happens to in-flight writes during deploy. It
writes no migration and no entity class. A data-model change is the one kind
of change a follow-up commit cannot fix, which is why it gets planned in a
file someone reviews before it is in the schema.

### 6. Build it

```
devkit implement the spec
```

`devkit-implementer` works one acceptance criterion at a time under strict
RED-GREEN: write the test, watch it fail *for the right reason*, write the
minimum code, run the full suite. It reads both companion specs (`.ux.md`,
`.data.md`) and follows their plans rather than generating its own. It never
modifies a test to make it pass — if a criterion is ambiguous it stops and
reports rather than resolving the ambiguity itself.

A criterion the spec marked `[integration]`, `[contract]` or `[e2e]` has to
be proven at that layer. A unit test with a substitute standing in for the
real dependency does not tick it, and the implementer stops rather than
quietly downgrading what the spec asked for.

### 7. Check the screens (only if there is a UI)

```
devkit ui verify
```

Every other gate reads code: the reviewer maps criteria to a diff, ship reads
CI and coverage, the suite asserts through an API. None of them can tell you
the empty state renders a blank screen. `devkit-ui-verify` runs the app the
project's own way and drives it through every state the UX spec named. A
state it could not reach is `UNVERIFIED`, never "fine".

### 8. Review, secure, gate, document

```
devkit review the diff
```
```
devkit quality review
```
```
devkit security review
```
```
devkit ship check
```
```
devkit docs
```

Five separate questions, deliberately: does the change match its spec
(`reviewer`), is it built well and will it hold at the spec's volume
(`quality`), is the code you wrote safe (`security`), is everything
*around* it shippable (`ship`), and what documentation did it just make
wrong (`docs`). `ship` is where the other verdicts converge: a `security`,
`quality`, `ui-verify` or `datamodel` result it hasn't seen is an
`UNKNOWN` row in its table, not a pass.

`quality` is the one the spec cannot ask for. Spec compliance is
per-milestone; design decay is cumulative, and no acceptance criterion says
"the service class must not gain its fifteenth dependency". It reads the
project's own architecture rules and any stated performance budget first,
so a finding cites something the project decided rather than a principle it
didn't. Findings that are matters of taste are marked advisory and never
change its verdict.

### 9. Cut a release (at a Phase boundary)

```
devkit release
```

`devkit-docs` wrote one changelog entry per milestone; nothing turned the
pile into a version. `devkit-release` does, once per Phase: it decides the
bump from what shipped and says why (a `SENSITIVE:` compatibility break in
any shipped spec is a major whether the changelog entry said so or not),
rolls `[Unreleased]` into a versioned section, updates the version in every
file that declares it, and drafts release notes for someone deciding whether
to upgrade. It ends with the exact `git tag` command and does not run it.

### 10. Audit the pipeline, then deliver (both optional)

```
devkit pipeline
```
```
devkit deliver this milestone
```

`devkit-pipeline` audits what actually gates a merge — build, tests,
dependency and secret scanning — against whatever CI the repo already uses,
and proposes one for a repo with none. It never enables a branch protection
or commits a workflow on its own.

`devkit-deliver` is the single exception to "nothing here touches git", and
it is **off unless the `deliver` stage is enabled**. Even then it is
permission for the recoverable flow only: branch, commit, push a feature
branch, open a PR at a Phase boundary. Never force-push, never a default
branch, never a merge, never a deleted branch or rewritten history.

### 11. Record decisions as they happen

```
devkit write an ADR: <decision>
```

Not a phase — whenever a consequential, hard-to-reverse decision gets made.
`devkit-adr` refuses to record non-decisions, and interviews for the parts
that are never inferable from code: the alternatives actually rejected and
the consequences accepted, including the bad ones.

---

## Path B — an existing codebase

The difference is entirely in the first two steps. Everything from "spec the
next milestone" onward is identical.

### 1. Inventory before writing anything

```
devkit onboard this project
```

On a repo with history, `devkit-onboard`'s governing rule is **inventory
before you write**. A project with history usually has some of this already,
in its own shape, under its own names, and creating a second convention
beside an existing one is worse than doing nothing — it splits the source of
truth and nobody knows which file is real.

It checks for: an existing tracker under any name (`ROADMAP.md`, `TODO.md`,
GitHub Projects), `CLAUDE.md`, `specs/`, a decision-record folder, other
`.claude` assets that might collide, CI configuration, and whether the repo
has a remote.

### 2. Choose how much history to reconstruct

It will offer you two honest options rather than picking:

- **Lightweight** — only upcoming milestones as rows, plus a one-line note
  that existing functionality predates the tracker. The loop only reads
  unstarted rows, so this is enough to start today.
- **Thorough** — a retroactive row per already-shipped feature, optionally
  with a retroactive spec written from the actual code. Genuinely more
  upfront work, and genuinely more useful later.

### 3. Backfill only load-bearing ADRs

Decisions that still *constrain how new work must be written* — the
datastore, the auth mechanism, a layering rule. Skip anything that no longer
constrains a future decision. The goal is that `devkit-specify` won't
contradict something load-bearing, not a complete written history.

### 4. Verify the loop can see what you built

`devkit-onboard` finishes by running the real `session-welcome.js` check and
confirming it identifies your next milestone. If it reports nothing queued
while `PROGRESS.md` plainly has unstarted rows, the tracker format isn't
parseable — and every hook depends on it, so that gets fixed before anything
else.

---

## The four gates

Gates are where this stops being a convenience and starts being a process.

### 1. The escalation gate — before implementation

Not every milestone deserves the same automated trust. A schema migration and
a copy tweak should not be treated identically.

When `devkit-specify` marks a requirement `SENSITIVE:`, the `Stop` hook
detects it and **stops to ask you** whether to implement this milestone
yourself at higher reasoning rather than delegating it. Once per milestone,
not on every nudge.

Two design notes worth understanding, because they generalise:

- **The marker is matched on its ASCII keyword, not its emoji.** The gate
  fails *open* — an unrecognised marker means a milestone that should have
  paused gets auto-delegated silently. Since the marker is written by a
  probabilistic model and read by an exact matcher, the matcher is the side
  that has to be forgiving.
- **Over-matching is the safe direction.** A false positive costs one extra
  question; a false negative costs the entire gate.

### 2. The review gate — after implementation

`devkit-reviewer` maps every acceptance criterion to the diff as Met / Not
Met / Partially Met / Deferred, with file-and-line evidence, and ends with
one of three verdicts: `ship`, `needs-changes`, `discuss`. It never edits
files.

### 3. The security gate — before it reaches anyone

`devkit-security` reviews the code you wrote for the classes that actually
cause breaches: broken object-level authorization, tenant isolation, auth and
session handling, injection, data exposure. Distinct from `devkit-dep-audit`,
which covers vulnerable dependencies - a project can have a spotless
dependency tree and still hand one tenant data to another.

What makes it more than a checklist: it reads the project own stated
invariants first - ADRs, convention files, how sibling endpoints already do
it - so a vague "check multi-tenancy" becomes a precise question. A violated
invariant the project wrote down itself needs no convincing.

Every finding names a file, a line, and a reachable exploitation path.
"Potential risk" with no path is noise, and noise is how a security review
gets ignored.

### 4. The ship gate — before calling it done

`devkit-ship` asks the question review doesn't: the diff matches its spec,
but is everything *around* it shippable? CI status, coverage against whatever
threshold the project itself declares, dependency advisories, secrets in the
diff, and any unaccounted acceptance criteria.

Its central rule is the one worth stealing for any process:

> **A gate that could not be run reports UNKNOWN, never PASS.**

An unrun check reported as green buys false confidence at exactly the moment
someone decides to ship. `clear-with-unknowns` is a real verdict, and it is
never quietly promoted to `clear`.

---

## What is deliberately not automated

Judgment about what to leave out matters more than coverage.

**Nothing commits, pushes, tags, merges, or opens a PR — with one opt-in
exception.** Every component is read-only or writes only to the working
tree, except `devkit-deliver`, which runs only when a project enables the
`deliver` stage in `.claude/devkit.json`. Installing the plugin is never
enough to grant it. Even enabled, it is permission for the recoverable flow
(branch, commit, push a feature branch, open a PR) and never for
force-pushing, pushing to a default branch, merging, deleting branches or
rewriting history. Tagging a release stays a human action in every
configuration: `devkit-release` prepares the release and prints the tag
command; nothing runs it. The reasoning is unchanged: an agent that can rewrite a
shared branch is an agent that can break it unattended, so the irreversible
operations are not a confirmation question — they are simply not available.

**Product intent is a conversation, not a skill.** See Path A, step 1.

**Deployment and incident response are out of scope.** This covers the build
loop, not the run loop. Saying so is more useful than implying coverage that
doesn't exist.

**Deferred work is recorded, not silently dropped.** A criterion nobody
implements gets a row in `PROGRESS.md`'s `## Tracked follow-ups` table naming
what was deferred, why, and what would unblock it — and the criterion stays
*unticked*. `devkit-ship` blocks on an unchecked criterion with no row, and
`devkit-reviewer` returns `needs-changes` for a criterion that is ticked *and*
deferred.

It lives in the tracker rather than the spec for a reason worth stealing: a
follow-up exists because someone returns to it *later*, but a spec's active
life ends when it ships. In the spec, it's archived the moment it's written.
Measured on a real project — 36 open follow-ups, 11 of the 15 specs they
point at already marked `Implemented`.

---

## How this system is verified

A toolkit that runs unattended fails quietly, so it carries two suites, and
a skill — `devkit-eval` — that runs both and then reads the prompt
components for the drift neither suite can catch (a report-only agent that
stopped saying so, a verdict string that got reworded, a doc that describes
last week's behaviour).

**`node --test`** — the hook suite, plus static checks on the plugin's own
files. Mostly behavioural rather than unit: the hooks run as real processes
against throwaway fixture projects, with exit codes and stderr asserted,
because `exit 2` plus the right message *is* the contract with the harness.
One static check exists specifically for this document: every agent, skill
and stage name must appear here and in the README, so a component can no
longer be added without the walkthrough knowing about it.

**`evals/`** — one or more cases per prompt-based component, run with
`claude plugin eval`. Each scaffolds a throwaway project and runs one
component in isolation. Nearly all graders are deterministic — file
contents, files created, tools actually called — rather than an LLM's
impression of a transcript. The current case list, with the invariant each
one locks in, is the table in [evals/README.md](../evals/README.md); exact
counts live there and in `node --test`'s own summary line rather than here,
where they went stale twice.

Both suites have earned their keep by finding real defects, including two
worth generalising:

- A **fail-open escalation gate**: four realistic renderings of the sensitive
  marker silently bypassed it. Caught by a case that enumerated the ways a
  model might write the same thing.
- A **vacuous test**: a BOM check written as
  `String.StartsWith([char]0xFEFF)` passed against every possible input,
  because .NET's default culture-sensitive comparison treats U+FEFF as
  ignorable. A test asserting the wrong thing is its own bug, and from a
  summary line it looks identical to a real failure.

The rule that follows: **a failing check is a question, not an instruction.**
Diagnose whether the component regressed or the test is wrong before
"fixing" anything.

---

## Choosing which stages run

The people using this are not interchangeable. A product owner wants to
write specs and document what shipped; a UX designer wants the design stage
and nothing downstream; a backend engineer wants schema, implementation and
review; a DevSecOps engineer wants pipelines and release gating. A loop that
nudges toward stages its owner never wanted is noise they learn to ignore —
and that costs the nudges that did matter.

`.claude/devkit.json`, committed, lists the stages a project runs:

```json
{ "role": "backend", "stages": ["specify", "datamodel", "implement", "review", "security", "ship"] }
```

`.claude/rajesh-devkit/devkit.local.json` (gitignored) lets one person run a
narrower loop than the repo's default. No file means every stage except
`deliver` is on, so a project that never answers behaves exactly as before.
A malformed file is treated as absent — a hook that dies on a typo is worse
than one that does what it always did.

Two behaviours make a narrow loop a real loop rather than a crippled one:

- **It stops.** When every enabled stage for a milestone is done, the `Stop`
  hook allows the stop instead of pushing toward stages nobody enabled.
- **It stays quiet about work it doesn't own.** A `ux`-only loop facing a
  milestone with no spec says nothing rather than telling someone to go
  write one.

One consequence is worth stating plainly, because the config makes it easy
to do by accident: a loop with `implement` on and `review`, `security` or
`ship` off ships code no gate has looked at. The `SessionStart` banner says
so, once, whenever that combination is configured — it doesn't stop you, but
it makes sure the omission was a choice rather than an oversight.

---

## Adopting this into a project that already has its own loop

Some projects already have a working, tuned process. Dropping a second one
beside it is how you get two sources of truth.

**The `Stop` hook defers automatically.** If a project has its own
`.claude/skills/spec-loop/SKILL.md`, `continue-loop.js` exits silently and
never nudges — that project owns its stop conditions deliberately, and an
unconditional hook would fight them.

**Trigger phrases are namespaced, not just names.** A `devkit-` prefix on the
`name:` prevents a load collision and nothing else — the harness decides what
to invoke from the *trigger phrases*. Every phrase in this plugin therefore
contains "devkit", so a project's own `specify` skill keeps "write a spec"
and this plugin answers to "devkit spec this feature". Without that, both
would match and the choice would be made silently.

**Cherry-picking is a legitimate install.** Components are self-contained
prompts. Copying the two or three a project actually lacks into its own
`.claude/agents/` — with cross-references rewired to that project's component
names — is often better than installing the whole plugin beside a process
that already works. What you lose is shared updates; what you keep is one
coherent process per repository.
