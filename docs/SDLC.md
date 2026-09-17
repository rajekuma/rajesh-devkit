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
      ┌──────────────────────────────▼──────────────────────────────┐
      │                      per milestone                          │
      │                                                             │
      │   specify ──► ux ──► implementer ──► reviewer ──► ship ──► docs
      │   (spec)     (ux     (code +        (verdict)    (gate)   (session
      │              spec)    tests)                               log)
      │                                                             │
      │   adr ◄── written whenever a real decision gets made        │
      └─────────────────────────────────────────────────────────────┘
```

| Stage | Component | Produces | Reads |
|---|---|---|---|
| Onboard | `devkit-onboard` | `PROGRESS.md`, test-runner cache | the existing repo |
| Specify | `devkit-specify` | `specs/<feature>.md` | code, ADRs, conventions |
| Design | `devkit-ux` | `specs/<feature>.ux.md` | the spec, component library |
| Build | `devkit-implementer` | code + tests, ticked criteria | the spec |
| Review | `devkit-reviewer` | a verdict | the spec + the diff |
| Gate | `devkit-ship` | a verdict | CI, coverage, advisories |
| Document | `devkit-docs` | changelog / session log | the spec + the diff |
| Decide | `devkit-adr` | `docs/adr/NNNN-*.md` | the decision, the code |

Two more run continuously rather than as a stage: `devkit-dep-audit`
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
onboard this project
```

`devkit-onboard` inventories what exists (nothing, yet), detects your stack,
**runs your test command once to confirm it actually works**, caches it, and
walks you through decomposing the vision into milestones small enough to spec
and ship in one sitting. It writes `PROGRESS.md` and stops — what it just set
up is yours to review before work starts against it.

### 3. Spec the first milestone

```
spec this feature: <name>
```

`devkit-specify` reads the code and any decision records first, then
interviews you one question at a time for anything it cannot confidently
infer. It writes `specs/<kebab-name>.md` and stops. It never scaffolds
implementation.

The important part: it marks any requirement touching an existing invariant,
a security/authorization boundary, a data-model change, an external
integration, or a backward-compatibility break with `SENSITIVE:`. That marker
is machine-checked — see [The three gates](#the-three-gates).

### 4. Design the interface (only if there is one)

```
ux spec
```

`devkit-ux` audits your existing components and design tokens *before*
designing, so it reuses rather than reinvents, then enumerates the states
that actually break interfaces — empty, loading, partial, error,
permission-denied, success, destructive-confirm. It appends accessibility
criteria to the feature spec's own acceptance list, which is what gives them
teeth: the implementer works from acceptance criteria, and the later gates
check them.

### 5. Build it

```
implement the spec
```

`devkit-implementer` works one acceptance criterion at a time under strict
RED-GREEN: write the test, watch it fail *for the right reason*, write the
minimum code, run the full suite. It never modifies a test to make it pass —
if a criterion is ambiguous it stops and reports rather than resolving the
ambiguity itself.

### 6. Review, gate, document

```
review the diff
```
```
ship check
```
```
update the docs
```

Three separate questions, deliberately: does the change match its spec
(`reviewer`), is everything *around* it shippable (`ship`), and what
documentation did it just make wrong (`docs`).

### 7. Record decisions as they happen

```
write an ADR: <decision>
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
onboard this project
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

## The three gates

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

### 3. The ship gate — before calling it done

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

**Nothing commits, pushes, tags, merges, or opens a PR.** Every component is
either read-only or writes only to the working tree. Everything that touches
a shared remote stays an explicit human action. This is a deliberate
property of the whole toolkit, not an unfinished feature — an agent that can
push is an agent that can break a shared branch unattended.

**Product intent is a conversation, not a skill.** See Path A, step 1.

**Deployment and incident response are out of scope.** This covers the build
loop, not the run loop. Saying so is more useful than implying coverage that
doesn't exist.

**Deferred work is recorded, not silently dropped.** A criterion nobody
implements gets a `## Tracked follow-ups` entry naming what was deferred, why,
and what would unblock it — and the criterion stays *unticked*. `devkit-ship`
blocks on an unchecked criterion with no follow-up entry, and `devkit-reviewer`
returns `needs-changes` for a criterion that is ticked *and* deferred.

---

## How this system is verified

A toolkit that runs unattended fails quietly, so it carries two suites.

**`tests/run-tests.ps1`** — 97 assertions against the PowerShell hooks. Mostly
behavioural rather than unit: the hooks run as real processes against
throwaway fixture projects, with exit codes and stderr asserted, because
`exit 2` plus the right message *is* the contract with the harness.

**`evals/`** — 12 cases, 67 graders, run with `claude plugin eval`. Each
scaffolds a throwaway project and runs one component in isolation. 60 of the
67 graders are deterministic — file contents, files created, tools actually
called — rather than an LLM's impression of a transcript.

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

## Adopting this into a project that already has its own loop

Some projects already have a working, tuned process. Dropping a second one
beside it is how you get two sources of truth.

**The `Stop` hook defers automatically.** If a project has its own
`.claude/skills/spec-loop/SKILL.md`, `continue-loop.js` exits silently and
never nudges — that project owns its stop conditions deliberately, and an
unconditional hook would fight them.

**Check trigger phrases, not just names.** The `devkit-` prefix prevents name
collisions; it does not prevent *trigger* collisions. If a project already
has a `specify` skill triggered by "write a spec", installing `devkit-specify`
makes that phrase ambiguous.

**Cherry-picking is a legitimate install.** Components are self-contained
prompts. Copying the two or three a project actually lacks into its own
`.claude/agents/` — with cross-references rewired to that project's component
names — is often better than installing the whole plugin beside a process
that already works. What you lose is shared updates; what you keep is one
coherent process per repository.
