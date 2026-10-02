# Plan: does the plugin help? Same milestone, with and without it

Status: **planned, not run.** Write the results into
`docs/model-learnings.md` and summarize them in the README, good or bad
(PRINCIPLES §8).

## Question

On the same approved spec, with the same model, does the devkit loop produce
a more complete, better-tested, less defective result than the model working
on its own in a well-set-up repository? What does it cost in tokens and in
the developer's attention?

The DevKit receipt shows what the plugin *did*. Only a comparison shows
whether that mattered.

## Choosing the milestone

Pick a milestone with an **Approved** spec, ideally one with a `SENSITIVE:`
requirement, since that is where gates should matter most. The plan was
written against MyHomeMaintenance, where two options exist (2026-10-02):

| Option | Base commit | Reference | Cost to you |
|---|---|---|---|
| **Replay M47b** (meter accuracy tests) | `6887705` (data plan done, before the code) | The real devkit run is recorded: $68.54 at API prices, 3.22 active h, 23 criteria. A third data point. | Two fresh arms, both thrown away afterwards (≈ $120–140 of quota at API-equivalent prices). |
| **Next milestone forward** (e.g. M48, once M47c has landed) | The commit M48 starts from | None | Two arms; the better one is kept as the real work, so only one is spent. |

Recommended: **the next milestone forward**, because half the spend becomes
real work. Replay M47b instead if you want the result sooner, or want the
third reference point.

## Arms

Both arms start from the same commit, each in its own git worktree, one
after the other.

| | A: with devkit | B: without devkit |
|---|---|---|
| Plugin | installed in the worktree (`--scope project`) | not installed. Project installs are tied to the folder path, so a new worktree has none. |
| Project's own loop skill | present (devkit drives because of `"loop": "devkit"`) | deleted in the worktree only (`git rm -r -q .claude/skills/spec-loop`, never committed). Otherwise B runs a different loop, not no loop. |
| Opening prompt | `devkit continue M<n>` | "Implement M\<n\> from PROGRESS.md. Its spec is specs/\<file\>.md. Work test-first, and tell me when it is done." |
| Sensitive-milestone question (A only) | answer "implement it myself", so both arms build the same way and only the process differs | (not asked) |

**Kept the same in both:**
- Model and effort (Opus 5.5, the session default).
- A fresh session in each arm.
- The repo's own `CLAUDE.md`, rules and ADRs.
- The same human answers. Write answers to likely questions in advance, and
  give both arms the same ones. Anything unforeseen gets the same short
  answer in both.

**Run one arm at a time, never in parallel,** and never while another session
in the main checkout is running tests. MyHomeMaintenance's shared test
template database races when two runs overlap.

## Setup

From the main checkout (any shell; these are git and claude commands only):

```bash
git worktree add ../mhm-ab-with -b ab/with <base-commit>
```
```bash
git worktree add ../mhm-ab-without -b ab/without <base-commit>
```

Copy the gitignored local settings the app and its tests need (connection
strings, `.env`, and so on) into both worktrees. A worktree starts without
them.

In `../mhm-ab-with`:
```bash
claude plugin install rajesh-devkit@rajesh-devkit --scope project
```

In `../mhm-ab-without`:
```bash
git rm -r -q .claude/skills/spec-loop
```
```bash
claude plugin list
```
The second command should list no `rajesh-devkit` entry for this folder.

Note each arm's start and end time: the opening prompt, and the moment it
says it is done.

## Measures

| # | Measure | How |
|---|---|---|
| 1 | Acceptance criteria met **and tested** | A fresh grader session gets the spec and both final diffs, labelled X and Y in random order (prompt below). For each criterion it marks: met with a test, met without a test, or not met. |
| 2 | Defects shipped | After both runs, a fresh devkit session runs `devkit-reviewer`, `devkit-security` and `devkit-quality` on **each** arm's final diff (install the plugin in B's worktree for this, after B is recorded). Findings in B are what the plugin would have caught. A's receipt also shows what its gates caught along the way. |
| 3 | Build, full suite, coverage | The project's own build, test and coverage commands, in each worktree. |
| 4 | Developer attention | Your messages after the opening prompt, counted from each transcript. |
| 5 | Cost and active time | In each worktree: `node <plugin>/scripts/milestone-metrics.js record M<n> --start <iso> --end <iso> --note "A/B arm A"` (or `arm B`). It finds the worktree's own transcripts. |
| 6 | Bookkeeping | PROGRESS row, spec `Status:`, session log, docs touched. Yes or no for each. |

### Grader prompt (measure 1)

> You are grading two implementations, X and Y, of the same spec. You do not
> know how either was produced. For every acceptance criterion in the spec,
> say for X and for Y whether it is: (a) met and proven by a test that would
> fail without the code, (b) met but not proven by a test, or (c) not met.
> Quote the test name or the line of code for each (a) and (b). Then list
> any behaviour either diff adds that the spec does not ask for. Do not
> guess: if you cannot find it, it is (c).

## Win criteria (fixed before running)

**The plugin helps** if A beats B on measure 1 or measure 2, and A costs no
more than **1.5×** B (measure 5). Measure 1 counts criteria at (a); measure 2
counts defects rated high or medium.

**The plugin is overhead** if A and B tie on measures 1 and 2 and A costs
more than **1.2×** B.

**Inconclusive** covers everything else: report it as inconclusive.

Developer attention (measure 4) and bookkeeping (measure 6) are reported,
not scored. Lower attention for A is a finding in itself.

## Afterwards

1. Keep the better arm's work, if the milestone was a forward one. Merge its
   branch into the real branch the usual way, then remove both worktrees with
   `git worktree remove`.
2. Write the result into `docs/model-learnings.md`: the table of measures,
   the receipts, the costs, and what surprised you.
3. Add a short "Does the plugin help? Measured" section to the README that
   links to it.

## Limits to state with the result

- **One milestone is an anecdote.** Repeat on two or three milestones of
  different kinds before calling it a finding.
- **B is not "no discipline".** The repository's own rules and ADRs help B,
  so a small gap is an honest outcome, not a failed experiment.
- **B's `CLAUDE.md` may mention devkit commands** that don't exist without
  the plugin. Note whether B tried to use them.
- **The same model graded and built.** For an independent check, the grader
  can run on a different model tier.
