# Spec: user journeys, so "done" means someone can use it

Target: devkit 0.13.0 · Status: **Approved 2026-11-05** · Related: `docs/PRINCIPLES.md` §1, §3, §4, §5, §6

## Context

Devkit proves each milestone is built correctly. Nothing proves that the
milestones add up to something a person can use.

Evidence from dogfooding on MyHomeMaintenance, measured 2026-11-05 on its
`feat/phase5-expenses` branch:

- The tracker says "API-side" 29 times, and UI milestones M81-M86 are all
  unticked. M82 Expenses UI has not started, although the expense API (M28)
  dates from September.
- `mobile/` has a `web` folder but no `android` or `ios` folder.
- Every recorded gate verdict is a pass or `clear-with-unknowns`. The gates are
  doing their job, which is to judge one milestone's diff.
- Fixes reached the repo for faults between the parts: the register form against
  the API's password rules, CORS, and a sign-in popup header.
- Reordering work for a good reason, such as building the water milestones
  first, had no visible cost. Nothing showed how far that left the app from a
  usable state.

This would help any project: a library has "a consumer installs it and calls
it", and a CLI has "a new user runs it and gets the result". The evidence above
must not leak into the plugin as an assumption about APIs, mobile apps or
expenses (§1).

## Terms

A **journey** is one outcome a named person can achieve, end to end. It has a
**check**, a command that exercises the real thing and can fail. A **proof** is
the recorded result of the plugin running that command.

## Behaviour / requirements

### The journey file

1. Journeys live in `JOURNEYS.md` at the project root. The file is the opt-in:
   with no file, every hook, message and receipt behaves exactly as in 0.12.
2. `"journeys": false` in `.claude/devkit.json` turns the feature off even when
   the file exists.
3. Each journey is one section with line-based fields, so a person can read and
   edit it and a hook can parse it without a dependency:

   ```markdown
   ## J1 Treasurer records an expense
   For: treasurer
   Outcome: The expense, with its receipt, appears on a resident's statement.
   Needs: M28, M29, M82, M51
   Check: npm run e2e -- expense-to-statement
   Timeout: 300
   ```

   `For`, `Outcome` and `Check` are required. `Needs` and `Timeout` are optional.
   `Check: manual` declares a journey no command can prove (see requirement 11).

### Running a check

4. `node <plugin>/scripts/journeys.js run <id>` runs one check, `run --needs M<n>`
   runs the checks whose `Needs` name that milestone, and `run --all` runs all
   except those still `blocked`, which could only fail for want of unbuilt work. The check runs from the project root with stdin closed, output streamed
   to the caller, and its exit code decides the result.
5. **The plugin records the result, never the model.** There is no command that
   stamps a pass, unlike `record-gate.js`, because a journey's value is that a
   model cannot talk its way past it.
6. 🔒 SENSITIVE: **No hook ever runs a check.** A check is an arbitrary command
   from a project file and can take minutes. Hooks only read recorded results.
   Checks run only when the user or a session runs `journeys.js` (§4, §5).
7. The proof stores the result, exit code, duration, time, tree fingerprint and a
   hash of the `Check` line. It never stores check output, which can contain
   secrets. Proofs live in `.claude/rajesh-devkit/journeys.json`, per working
   tree, because a proof describes one tree.
8. The fingerprint is `gates.treeFingerprint` with an `exclude` option that leaves
   out `PROGRESS.md`, `JOURNEYS.md` and the metrics directory. Without this,
   ticking the milestone's row would make its own proof stale at once. Excluded
   paths are also removed from the throwaway index, so staging them does not
   change the result.

### States

9. Every journey reports exactly one state, decided in this order:

   | State | Meaning | Counts as proven |
   |---|---|---|
   | `proven` | Last run exited 0 on this tree with this check | Yes |
   | `accepted` | A manual journey the user confirmed on this tree | Yes, shown separately |
   | `failing` | Last run on this tree exited non-zero | No |
   | `unknown` | The check could not run: timeout, command not found, signal | No |
   | `stale` | Last result was on another tree or a changed check, or the tree cannot be fingerprinted | No |
   | `ready` | All `Needs` are done and there is no result yet | No |
   | `blocked` | Some `Needs` are unfinished and there is no result yet | No |

10. A recorded result outranks the tracker. If a check passes while a `Needs` row
    is unfinished, the journey is `proven` and the report says the row looks out
    of date. A `Needs` entry missing from the tracker is reported by name.
11. 🔒 SENSITIVE: A manual journey is accepted only by the user's own words:
    `devkit journey J3 passed` at the start of a prompt, read by the
    `UserPromptSubmit` hook, as `devkit continue` is. No script or model path
    records an acceptance.

### What the user sees

12. `devkit journeys` lists every journey with its state, its unfinished `Needs`
    and a closest-journey line. It uses the same no-model-turn path as
    `devkit sessions`. It computes real freshness.
13. The start-up banner adds one line with real freshness: proven count, stale
    count, and the closest journey.
14. The end-of-turn status line adds `journeys 2/8 passed at last run`. It does not
    compute a fingerprint, which measured about 1.6 s on an 824-file repository.
    That is why the wording says "at last run" and never "proven".
15. **Closest journey** is the unproven journey with the fewest unfinished `Needs`,
    with ties going to file order. A journey with no `Needs` and no result counts
    as zero unfinished.
16. When `devkit continue` takes a milestone in no journey's `Needs` while an
    unproven journey exists, the user is shown what that milestone moves and which
    milestone the closest journey needs. The loop still takes the milestone the
    user asked for. It never reorders work (§4).

### At close-out

17. The loop's close-out instructions add one step, only when `JOURNEYS.md` exists:
    run `journeys.js run --needs M<n>`. A journey with unfinished `Needs` is
    skipped and reported as `blocked` without running.
18. A `failing` or `unknown` linked journey is reported and sent back through the
    loop, with the journey, exit code and scope "fix this failure". This is a
    return of one unit, not a re-run of every gate. After three failed attempts on
    one milestone, the session stops and asks the user, because the plan may be
    wrong rather than the code. The loop then allows the stop and stays quiet until
    the user says `devkit continue`, so a nudge cannot push past that question.
19. A failing journey does **not** block ticking the row by default. It shows on
    the receipt. `"journeyGate": "block"` tells the loop not to close the milestone
    until its linked journeys pass.
20. If a milestone finishes and no journey names it, the session asks once whether
    it belongs to a journey or is deliberately enabling work. Either answer is
    fine. An answer that it belongs is an edit to `JOURNEYS.md`.
21. The receipt gains a `Journeys` line: what this milestone moved, or `moved none`.
    The summary page gains the same column, and old records show it blank rather
    than `none`.
22. `devkit-ship` receives `journeys.js status` as evidence. A linked journey that
    is not proven is a row in its report, `UNKNOWN` if it could not run.
23. Running `--all` is suggested at a phase's end alongside the push reminder, since
    a milestone's close-out only re-proves its own journeys and others go stale.

### Creating journeys

24. A new skill, `devkit-journeys` ("devkit journeys draft"), reads the vision,
    tracker and code, proposes 5-10 journeys with their `Needs`, and writes the file
    only after approval. It names missing checks but does not write them: a check is
    ordinary work, added as a tracker row through the normal loop.
25. `devkit-onboard` offers this as an optional step, `devkit-roadmap` reads the file
    and prefers rows that complete a journey, and `devkit-specify` names the journey
    a spec serves. A project that says no is never asked again by these skills.

## Edge cases

- `JOURNEYS.md` is malformed: the good sections work, and bad ones are named as
  `invalid` with the missing field. A hook never fails on it.
- `journeys.json` is missing or corrupt: reads as no results, so nothing is claimed.
- A duplicate id: both are `invalid`, since a proof cannot say which it belongs to.
- A check prints success and exits 0 without testing anything: the plugin cannot
  detect this. `devkit-reviewer` reads the check when its diff changes one.
- A check is edited: its hash changes, so the journey goes `stale`.
- A check times out: its process tree is killed, on Windows with `taskkill /T`, and
  the state is `unknown`.
- A check needs a running server: starting it is the check's job. The plugin does
  not manage services. If it can't reach one, its failure is reported normally.
- Two runs at once: writes are atomic and the last one wins. The next report is at
  worst stale, never a false `proven`, since each entry carries its own fingerprint.
- A project outside git: every proof is `stale` because a tree can't be proved, and
  the report says why (§3).
- A session on a phase lane: reports use that worktree's tracker and proofs.
- Under `loopStart: always`: same behaviour, because nothing here depends on arming.

## Out of scope

- Writing, generating or hosting checks, and any test framework choice.
- Starting servers, devices or emulators.
- Parallel execution of checks, or a work graph. `Needs` is a list, not a scheduler.
- Reordering the tracker, or starting a journey's milestones automatically.
- A Goldfish spec review and the follow-up learning edge. They are separate work.
- Migrating existing tracker text such as "API-side".

## Observability

Telemetry goes to the existing `telemetry.jsonl`: `journey_run` (id, state, exit
code, duration), `journey_unlinked` (milestone) and `journey_accepted` (id). No
check output and no command text. Failures of the plugin's own state files stay
silent in hooks (§5) and are visible as `unknown` in `journeys.js status`.

## Performance budget

- Hooks with no `JOURNEYS.md`: one failed file stat, no measurable change.
- End-of-turn line: parse two small files, no git, under 50 ms.
- Banner and `devkit journeys`: one fingerprint, measured at about 1.6 s on the
  824-file MyHomeMaintenance repository on Windows.
- Model tokens: hooks and reports spend none. Tokens are spent drafting the file,
  writing checks as normal milestones, and each returned failure. This is unmeasured
  and gets measured in the dogfood run below.

## Acceptance criteria

Parsing and states:

- [ ] A project with no `JOURNEYS.md` gets byte-identical hook output to 0.12.
- [ ] `"journeys": false` matches having no file, with the file present.
- [ ] A section missing `For`, `Outcome` or `Check` is `invalid` and others still work.
- [ ] A duplicate id makes both sections `invalid`.
- [ ] Each state in the table is reached by a test, and the order is honoured.
- [ ] [integration] Exit 0 is `proven`, non-zero is `failing`, a missing command and a
      timeout are `unknown`.
- [ ] [integration] Changing a source file makes a proof `stale`.
- [ ] [integration] Changing or staging `PROGRESS.md` or `JOURNEYS.md` only does not.
- [ ] [integration] Changing the `Check` line makes a proof `stale`.
- [ ] Outside a git repository a passing run reads `stale`, never `proven`.

Trust:

- [ ] No command-line path records a pass or an acceptance without a real run.
- [ ] [integration] A hook run with a passing and a failing check present spawns
      neither. Tested with a check that writes a marker file.
- [ ] `devkit journey J3 passed` accepts only at the start of a prompt, only for a
      manual journey, and a sentence that mentions it accepts nothing.
- [ ] A secret printed by a check appears nowhere in `.claude/rajesh-devkit/`.
- [ ] [integration] A timed-out check leaves no child process behind, on the platform
      the suite runs on.

Surfaces:

- [ ] `devkit journeys` is a blocked prompt and costs no model turn.
- [ ] The status line says "passed at last run" and computes no fingerprint.
- [ ] Closest journey follows the rule, including ties.
- [ ] `devkit continue` on an unlinked milestone says so and still arms that milestone.
- [ ] Close-out text names the `run --needs` step only when `JOURNEYS.md` exists.
- [ ] Failing linked journey under the default still lets the row be ticked, and the
      receipt shows it.
- [ ] Under `"journeyGate": "block"` the same case tells the loop not to close.
- [ ] Three failed attempts produce a stop-and-ask, and the next stop does not repeat it.
- [ ] An unlinked finished milestone logs `journey_unlinked` and is asked about once.
- [ ] A record from before 0.13 renders a blank journey cell, not `none`.

Prompts, measured with `node tests/run-evals.js` (§3):

- [ ] New eval: `devkit-ship` reports an unproven linked journey and never passes it.
- [ ] New eval: `devkit-journeys` writes nothing before approval and invents no check.

Generic use (§1):

- [ ] A test project with no UI, a library with one consumer journey, works end to end.
- [ ] No file in `agents/`, `skills/` or `scripts/` names MyHomeMaintenance, or assumes a
      mobile app, an API or a browser.

Release (§2, §9):

- [ ] README, CHANGELOG, `devkit-help`, the banner and `docs/SDLC.md` are updated, and the
      version is 0.13.0.

## Build order

Each step is usable and testable on its own:

1. `lib/journeys.js`, `scripts/journeys.js`, and the `exclude` option on the fingerprint.
2. `devkit journeys`, the banner, the status line and the acceptance keyword.
3. Close-out step, receipt line, return path and `journeyGate`.
4. Prompt changes and evals: `devkit-journeys`, ship, onboard, roadmap, specify.
5. Dogfood on MyHomeMaintenance and record results.

## Dogfood and how we judge it

Draft 5-8 journeys for MyHomeMaintenance, from the owner's choice of what a pilot needs.
Likely first candidate: a treasurer records an expense and a resident sees it. Then
record in this file, good or bad (§8):

- Days from adoption until the first journey is `proven`, and how many tracker rows were
  reordered as a result.
- Faults a journey check caught that gates had passed, and faults still found by hand.
- Model cost of writing checks and returned failures, against the $307 recorded across
  four milestones.
- Time spent on flaky checks. Frequent false failures would be a reason to rethink this.

**Keep it if** a journey catches a real fault that the gates passed, or if it changes
what gets built next. **Otherwise cut it back to the report.**

## Decisions for the owner

1. **A failing journey reports by default rather than blocks.** Recommended, since flaky
   checks are a real risk and there is no evidence yet that blocking is worth it
   (requirement 19).
2. **`JOURNEYS.md` at the root rather than in `docs/`.** Recommended, since it sits
   beside `PROGRESS.md` and is meant to be seen.
3. **Manual acceptance is in scope.** Recommended, since device checks such as a camera
   flow may never be fully automated (requirement 11).
