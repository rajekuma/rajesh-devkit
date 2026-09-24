# Changelog

All notable changes to this plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
semver as `devkit-release` applies it (a removed or renamed component, stage
or verdict string is breaking; a new component or stage is a feature; a fix
to an existing one is a patch).

The plugin dogfoods its own loop: this file is the one `devkit-docs` writes
an entry into and `devkit-release` rolls into a version. Entries say what
changed and *why* - the failure it prevents - because the why is what a
reader six months from now cannot recover from the diff.

## [Unreleased]

### Removed

- **`profiles/devkit-env.ps1` and `profiles/devkit-env.sh`** (`Use-DevkitProfile`,
  `devkit_profile`). Replaced by `node profiles/devkit.js <profile>`, below.
  Breaking for anyone who scripted the old functions; the replacement is one
  command on every OS.

### Added

- **`sessionTier` in a profile, and `openrouter-hybrid`: 9/9 for about
  $0.07.** Measurement showed driving the loop and doing the work are
  different skills: `gpt-6-luna` did good implementer work but, as the session
  model, isolated the implementer in a worktree or a remote copy (2/9), while
  `qwen3-coder` orchestrates properly. A profile's `sessionTier` now names the
  tier the session itself runs on - the launcher and `run-evals --profile`
  both pass it as `--model` - so `openrouter-hybrid` runs the session on
  qwen3-coder (opus tier) and every agent asking for sonnet on Luna. On
  `implementer-red-green` it scored 9/9, matching Claude: one plain call to
  the implementer, all work in the real project, four RED-to-GREEN cycles
  reported with their failure messages. One run so far; the README calls it
  the front-runner, not settled.

- **The loop says how to run `devkit-implementer`, not only that it runs.**
  Its description and the Stop hook's implement step now say: in this
  working tree, never with worktree isolation, and let it finish - no
  stopping, relaunching or doing its work yourself. Measured candidly: it
  did not rescue the two models it was aimed at. `gpt-6-luna` switched from
  `isolation: "worktree"` to `"remote"`; `qwen3-coder-next` now waited for
  the implementer but isolated it anyway; both stayed 2/9 with good work in
  a copy the project never saw. Kept because it is right, and recorded in
  `docs/model-learnings.md`: those two models are unsuitable as the
  session model, whatever their coding quality.

- **`docs/model-learnings.md`, the running record of every model tried** -
  eval score, real cost, what went wrong and the lesson - seeded with every
  measurement so far, the $8.50 session, the free-tier dead ends and the
  unchecked advice from an AI search summary. The README points to it and
  asks for a row every time.

- **`node profiles/check.js --new`, and a weekly one-line notice.** Lists the
  tool-capable models the gateway added since this machine last looked,
  with fresh, cached and output prices (`profiles/catalogue.js`; state in
  `~/.devkit/`, outside every repository). Starting a gateway session prints
  one line at most once a week when there are new ones - never during the
  loop, where a model shortlist would interrupt a milestone. Short timeout,
  silent on failure; `DEVKIT_NO_MODEL_NOTICE=1` turns it off.

- **Two more candidate profiles, measured.** `openrouter-nemotron-free`
  scored 8/9 on `implementer-red-green` at $0, matching `qwen/qwen3-coder`.
  `openrouter-luna` (GPT-6 Luna, $0.10 / $0.01 cached / $0.50) scored 2/9
  for about $0.02 - misleadingly: its session ran `devkit-implementer` with
  `isolation: "worktree"`, and the implementer's good work (4/4 ticked,
  runner cached, a proper RED report) stayed in a throwaway worktree the
  project never saw.

- **`maxContextTokens` in a profile.** The launcher passes it to Claude Code
  as `CLAUDE_CODE_MAX_CONTEXT_TOKENS` unless the user already set one, so the
  conversation is compacted sooner and each late request costs less. Both
  shipped profiles set 100k. Measured on the same session: 192 requests
  re-sending the conversation carried 18.6 million input tokens for 14
  thousand output - about $8.50 at $0.30 per million - and emptied a $10
  balance into a `402`. The README now has "What a fallback session really
  costs": the ~45k-token floor every request carries, those numbers, keeping
  fallback sessions to one scoped step, doing open-ended exploration on the
  subscription, and that a 402 is the account balance (with worst-case
  reservations for in-flight requests), not the key's limit.

- **`profiles/openrouter-lean.json`, a cheaper candidate profile.** Same
  tiers, cheaper models with tool support: `qwen/qwen3-coder-next` for
  sonnet, `google/gemini-2.5-flash-lite` for haiku, `deepseek/deepseek-v4-pro`
  for opus/fable - roughly half to a fifth of the default profile's list
  prices. Shipped as something to measure, not a new default: cheaper is
  only cheaper if the model can hold a red-green loop.

- **A VS Code task for the fallback, documented.** VS Code's "New session
  with Claude / Copilot" picker is owned by extensions, so a plugin cannot
  add OpenRouter to it; a `.vscode/tasks.json` entry running
  `node profiles/devkit.js openrouter` is one click from Terminal > Run Task,
  and the README now gives it, with why `"type": "process"` and why the file
  should stay uncommitted.

- **`node profiles/devkit.js <profile> [claude args...]` - one provider
  launcher for Windows, macOS and Linux.** Setting up the OpenRouter profile
  on a real Windows 11 work machine failed at every step, none of it this
  plugin's logic: a `LocalMachine` execution policy of `AllSigned` refused the
  unsigned `devkit-env.ps1`; `sudo` then tried to open it as an application;
  `claude` itself resolved to npm's unsigned `claude.ps1` shim and was refused
  the same way; and hand-typed `$env:` lines in what turned out to be a
  `cmd.exe` window all failed, after which `claude -p` answered `pong` from
  the Claude subscription while looking like a successful gateway test. The
  shell-function design needed the user to know which shell they were in,
  how to dot-source, and how to get past a policy - and it needed two copies
  kept in step.

  The launcher sets the provider variables on the `claude` it starts and
  nowhere else, since that is the only process that reads them: no script
  policy applies to `node`, nothing is left in the shell, and there is no
  "switch back" step. On Windows it starts the native `claude.exe` behind
  npm's three shims directly, so the `.ps1` shim never runs. The key comes
  from `OPENROUTER_API_KEY` or, failing that, a one-line file at
  `~/.devkit/openrouter_api_key.txt`, outside every repository - never an
  argument, never printed in full. A gateway session names the `sonnet` tier
  unless told otherwise, because without an explicit `--model` Claude Code
  sent `qwen/qwen3.8-27b:free[1m]` and OpenRouter rejected the id.
  `--dry-run` shows everything it would do. Profiles gain an optional
  `keyEnv` field.

- **The hooks can now tell whether another session is already live in the
  same working tree.** Every piece of state this plugin kept answered *where
  did the work get to* - `PROGRESS.md`'s `## In flight` block, the spec's
  ticked criteria, `resume.json`, `git status` - and none of them answered
  *is somebody holding it right now*. The hooks read the first as an answer
  to the second.

  What that cost, on 2026-09-22 at 21:37: `session-welcome.js` greeted a new
  session with "picking up M28 - Expense Categories, mid-flight ... resume at
  criterion 4" while another session, started nine minutes earlier in the
  same tree, was already implementing M28. That session wrote
  `ExpenseCategoryService.cs`, `ExpenseCategoryEndpoints.cs` and a 44-test
  suite in the window, and added `app.MapExpenseCategoryEndpoints();` plus
  its DI registration - the exact two lines the newly-greeted session had
  independently diagnosed as missing and was about to write itself. Nothing
  caught it. The second session happened to re-list a directory for an
  unrelated reason and noticed a 25KB file that had not been there minutes
  earlier; its `dotnet test` baseline was already stale when it read it.
  `continue-loop.js` had the same blind spot and would have driven the loop
  forward into the same collision.

  Each session now publishes its presence to
  `.claude/rajesh-devkit/session-lease.json`, beside `resume.json` and
  gitignored by the same rule. `SessionStart` claims it, `PostToolUse` renews
  on every edit, `Stop` renews at every pause. It holds a list rather than
  one slot, because two sessions working *different* milestones in one tree
  is legitimate and a single slot would make each evict the other.

  Keyed on the harness's `session_id` rather than a pid - verified against a
  live harness on `SessionStart`, `Stop` and `PostToolUse` rather than
  assumed from documentation. A pid identifies the hook's own short-lived
  child process, not the session, and pids are reused. `Get-Process claude`
  was considered and rejected: Windows-only, which defeats the reason these
  hooks are Node at all, and it cannot tell which repository a process
  belongs to.

  Liveness uses two independent signals, and a lease survives if either is
  fresh: `renewedAt`, written by these hooks, and the mtime of the session's
  transcript, which the harness appends to every turn. The second is the one
  that mattered - `PostToolUse` only fires on an edit, so a session reading,
  testing and diagnosing stops renewing, which is exactly what the session
  that was *not* greeted had been doing.

- **`sessionLeaseTtlMinutes` in `.claude/devkit.json`.** How long another
  session's claim stays believable without a sign of life; 15 by default,
  clamped to 1-240. A session killed by a usage limit gets no turn and so
  never releases anything, and without expiry the fix would be worse than the
  bug - a crashed session would lock the next one out of its own milestone
  permanently. The clamp exists because `0` would switch detection off
  silently and a huge value would recreate exactly that lockout.

- **A gate verdict is stamped with the tree it saw, and a stale one is never
  a pass.** In M28 `devkit-reviewer` returned `ship`, `devkit-security`
  `clear`, `devkit-quality` `clean`; the orchestrator then applied two of
  quality's findings - an edit to `ExpenseCategoryService.ListAsync` and a
  docstring - and carried on toward ship with all three verdicts treated as
  current. They described a diff that no longer existed. `devkit-ship` caught
  it only because it happened to re-run the suite after the edits; the same
  fix applied after ship would have been marked done over code nothing
  verified.

  `scripts/record-gate.js <gate> <verdict>` stamps a verdict with a content
  hash of the working tree (committed, staged, unstaged and untracked, minus
  `.gitignore`), computed through a throwaway git index so the user's own
  staging is never touched; `record-gate.js check` re-hashes and marks each
  stamp FRESH or STALE. Stored in `.claude/rajesh-devkit/gates.json`,
  gitignored with the rest. Computed on demand rather than maintained by the
  `PostToolUse` hook, because that hook fires only on `Edit`/`Write` and an
  edit made through Bash would slip past it.

  Fails safe by construction: FRESH only when the stamp provably matches.
  A changed tree, another milestone's verdict, no git, and - the case that
  matters - a verdict with no stamp at all are all STALE. A gate re-run
  unnecessarily costs minutes; a stale pass costs shipping unverified code.
  `devkit-datamodel` is deliberately not stamped: its plan predates the
  code, so its stamp would always read stale and teach everyone to ignore
  the word.

- **`devkit-ship` has a `STALE` result and a `stale` verdict, and a Review
  row.** STALE is kept apart from UNKNOWN - "ran, but on something else"
  versus "never ran" - because the fix differs. The verdict ranks below
  `blocked` and above `clear-with-unknowns`, and is never promoted to
  `clear` on the grounds that the change since was "only" a small fix: that
  is precisely the change nobody checked. The reviewer's verdict now gets a
  row like every other gate, since it is the one most likely to be issued
  first and acted around afterwards. The UNKNOWN discipline is untouched: an
  unrun gate is still UNKNOWN, never PASS.

- **`"exclusive": true` in a `test-runners.json` entry.** Marks a suite that
  must never run concurrently with itself, with a one-line
  `"exclusiveReason"`. In M28 overlapping runs against one shared PostgreSQL
  database produced 19 phantom failures, then 5, in tests the milestone never
  touched (`MyUnitsTests`, `OccupancyTests`), plus a wrong test count from a
  half-rebuilt assembly, and a stray `testhost.exe` stalled `dotnet build` on
  file locks twice. None reproduced alone; hours went into a regression that
  did not exist. `devkit-implementer` writes the flag once it learns this;
  `devkit-onboard` seeds it when the project's own docs say so.

### Changed

- **`devkit-implementer` must show the RED it saw, not just claim it.** Its
  report now carries one line per criterion: the test's name and the failure
  it actually printed, then that it passed - or, for a criterion an earlier
  one already covered, that it passed on first run and why. Prompted by a
  measured `qwen/qwen3-coder` run whose trace showed genuine fail-then-pass on
  every criterion while its report said only "implemented, tests pass":
  nobody reading that can tell test-first from tests-after. Claude kept 9/9
  with the rule and produced exactly the table; qwen3-coder stayed 8/9, doing
  the work right again but ignoring the reporting rules (and creating a
  `PROGRESS.md` the project did not have), so the README now says to check
  the code and the ticks on the fallback, not the prose.

- **`node tests/run-evals.js --profile <name>` runs the evals on a provider
  profile.** A `pong` proves the wiring and nothing about a red-green loop,
  so choosing a cheaper model needed the real cases run under it. The
  environment comes from the launcher's own `profileEnv()`, so an eval tests
  exactly what a fallback session gets; the judge that grades the run stays
  on the Claude login, because grading a model with itself measures nothing.
  `-JudgeModel` in the Windows bridge was declared and never passed to
  `claude`; it is now.

  Results on `implementer-red-green`: Claude login 9/9; `openrouter`
  (`qwen/qwen3-coder`) 8/9 for about $0.21 - it did RED before GREEN for
  every criterion but didn't say so in its report; `openrouter-lean`
  (`qwen/qwen3-coder-next`) 3/9 for about $0.07. The lean session model did
  invoke `devkit-implementer`, but would not wait for a background subagent:
  it stopped it mid-work three times, then did the milestone itself, so no
  criteria were ticked and no runner cached. (An earlier version of this
  entry said it "never invoked devkit-implementer" and used generic agents -
  that came from reading a truncated trace, and was wrong.) The eval
  summary's own cost figures overstate gateway runs: Claude Code prices a
  model it does not know as if it were Claude. OpenRouter's key usage is the
  real number.

- **`node profiles/check.js [profile]` checks any profile, and fails a model
  without tool calling.** Prompted by model advice from an AI search summary
  that, checked against the live catalogue, included
  `qwen/qwen-2.5-coder-32b-instruct` for the implementer - listed with no
  tool support, so Claude Code could not run on it at all - alongside a
  "completely free" model that is paid and a $10 / $50 per million model
  recommended "within a $10 credit". Existence alone was never the bar;
  tool calling is the minimum, and the check now says so. The README warns
  about the pattern, and `openrouter.json`'s comment no longer claims the
  opus tier serves `devkit-specify` - skills run on the session's model.

- **Data modelling runs only for a milestone that changes stored data.** In
  real use, a project whose database had long been built was asked for a
  data-model plan - backfill, rollback, restore script - on milestones that
  touched no stored data at all. The Stop hook's chain read "invoke
  devkit-datamodel" as a standing order for every milestone, and the agent
  itself had no "not applicable" exit. The chain now says to invoke it only
  if the milestone adds or alters a table, column, constraint, index, entity
  or seed, and to skip it otherwise; the agent's first step is to decide that
  and, when nothing changes, say so and write nothing. An existing schema is
  the baseline, never re-planned. And both `devkit-datamodel` and
  `devkit-ship` now follow a project's own written rollback policy - a
  forward-only rule in `CLAUDE.md`, `.claude/rules/` or an ADR satisfies the
  rollback section, instead of a restore script the project decided not to
  have.

- **The README says how to customize the plugin, near the top.** A new
  "Customize it for your project" section lists all six places - stages in
  `.claude/devkit.json`, a personal `devkit.local.json`, the project's own
  `CLAUDE.md` / `.claude/rules/` / ADRs (the most powerful and previously
  never presented as customization), a verify script, the test-runner cache
  and the fallback's model mapping - each with an example. Until now the
  config keys were documented around line 1000, under "Hooks". The OpenRouter
  section gains a per-component model table (which tier each agent asks for,
  and what that becomes on the subscription and in the fallback), and
  "Starting and stopping the loop" says any session can `devkit continue`,
  each starts idle, repeating it is harmless, and an old window should be
  paused or exited first.

- **The loop starts when you say `devkit continue`, and `devkit pause`
  stops it.** Breaking: until now the `Stop` hook drove every session in a
  project with an unfinished milestone, and every session claimed that
  milestone in `session-lease.json` just by existing - `SessionStart`
  claimed it, every edit and every stop renewed it. Found in real use: after
  a milestone ended, a new session opened for unrelated work was told at
  every stop that another session held the next milestone and asked which
  owned it. The user answered "neither"; the hook, which cannot hear an
  answer, asked again at the next stop, and the session's own advice was to
  switch the plugin's hook off.

  A new `UserPromptSubmit` hook, `scripts/loop-command.js`, reads the two
  keywords at the start of a prompt and records them per session in
  `.claude/rajesh-devkit/loop-arm.json` (`scripts/lib/arm.js`). The `Stop`
  hook drives only an armed session, and checks that before the collision
  check - an idle session is not working the milestone, so it cannot
  collide over it. Only a driving session claims a lease, in all three hooks
  that used to claim unconditionally, so an idle session also stops being
  reported to anyone else as "the other session". `devkit pause` releases
  the claim. `devkit continue` hands the session the Stop hook's current
  instruction as its first step, rather than a second copy of the chain.

  An arm covers one milestone: when it ships the loop stops and waits, which
  is the point a person looks at what shipped. `devkit continue all` covers
  the whole queue for an unattended run, and `"loopStart": "always"` in
  `.claude/devkit.json` restores the pre-0.7 behaviour for a project that
  wants every session driven. The start-up banner now says what is next and
  how to start it, instead of "Read that spec and continue from criterion
  N", which a session opened for other work would act on.

- **The README has an "On Windows" section**, covering the three traps
  above - execution policy, the `claude.ps1` shim (`claude.cmd` works), and
  PowerShell versus Command Prompt syntax - and states that nothing in the
  plugin needs a `.ps1` run by hand, `sudo`, or an admin window. It also
  explains free OpenRouter models (50 requests a day, provider 429s,
  backends that reject Claude Code's tool schemas), that a key's credit
  limit is not credit, and what a single request through Claude Code
  actually costs. The eval instructions now say `node tests/run-evals.js`
  on every OS, and never to start `tests/run-evals.ps1` directly; a stale
  pointer to a `tests/run-tests.ps1` that no longer exists is gone, as is a
  troubleshooting claim that execution policy could affect
  `token-report.js` (a Node script, which it cannot).

  And a short "When you hit the usage limit" checklist now sits right after
  Install, including the VS Code terminal, because the same steps were
  buried two-thirds of the way down, and the question at the moment of a
  limit was simply "does it switch by itself?" (No - and why it doesn't need
  to.)

- **The chain says what happens after a gate's findings are applied.**
  `continue-loop.js`'s `downstream()` read as one-way - gate, gate, gate,
  ship - and that implication was the actual bug. It now says to stamp each
  verdict, that any edit after a verdict makes it stale, and that the loop
  runs gates, fixes, gates again until a round passes with no edits after
  it; it hands `devkit-ship` the `check` output, and asks for one last
  `check` before the milestone is closed out, which is what catches a fix
  applied after ship. The command is named by absolute path, because the
  session has no `${CLAUDE_PLUGIN_ROOT}` of its own.

  And the Stop hook re-judges every stamp recorded for the current milestone
  at each stop, naming any that went stale - the half that needs nobody to
  remember anything. It hashes the tree only when the milestone has stamps,
  so a project that never records pays nothing. `devkit-deliver` refuses a
  `stale` preflight.

- **`devkit-implementer` knows what to do with a test against a type that
  does not exist yet.** A project rule that a compile error is not a valid
  RED - common, and the host project's own - collides with every greenfield
  entity, because the first test cannot compile. The resolution M28 used, now
  taught: a skeleton that compiles and implements none of the rules, so the
  failures are behavioural (10 failed, 4 passed there), then implement.
  Without it an agent either fakes the RED or abandons the discipline.

- **Batching RED-GREEN is allowed, under stated conditions, and always
  disclosed.** M28's implementer wrote a 31-test endpoint surface, confirmed
  a genuine RED (all 404), implemented the service in one pass, and said so
  unprompted; the reviewer judged the coverage per-criterion. The outcome was
  fine, but the prompt never said whether that was allowed, so the next run
  might batch where it is wrong. Now: one named grain, a genuine RED for the
  whole batch before any implementation, and every criterion ending with a
  test that fails on its own regression - never across domain rules whose
  tests each say something new. The disclosure is now required rather than
  left to luck.

- **Neither `devkit-implementer` nor `devkit-ship` runs two test processes
  at once, and neither believes a red run that overlapped another.** A
  surprising red is re-run alone before it is called a regression; ship
  reports a suite it cannot get a clean solo run of as UNKNOWN, not BLOCKED.

- **`devkit-reviewer` reviews the working tree, and re-checks each finding
  before reporting it.** In M28 its only concrete finding was a stale `"32
  leaves"` comment in `ExpenseCategorySeed.cs` that had been corrected in
  the working tree before the review began - it had read a committed copy.
  Being the only specific finding, it was the one a reader skimming the
  verdict would have acted on, and it was not real. The change under review
  is now stated as the committed diff plus the uncommitted working tree, and
  every specific finding is re-read against current contents first.

- **The README says Claude Code must be started *in* the project.** The whole
  dogfooding session ran from `C:\Dev` against a plugin installed
  `--scope project` in `C:\Dev\MyHomeMaintenance`: none of its agents,
  skills or hooks loaded, `claude plugin list` said **enabled** throughout,
  and hand-running the hook scripts with `CLAUDE_PROJECT_DIR` set masked it
  for hours, until delegating to `devkit-implementer` failed with "Agent type
  not found". Install now says so plainly, says that `plugin list` is not
  evidence and the session's available-agents list is, and says when
  `--scope user` is the better choice. The most expensive thing to get wrong
  when onboarding a second machine or another person, and nothing said it.

- **The `ship-unknown-not-pass` eval no longer tells ship that review
  already passed.** Under the new rule an unstamped claim like that is
  STALE, which would have turned an eval about UNKNOWN into one about STALE.
  With the claim gone the review row is UNKNOWN (never ran) and the expected
  verdict is still `clear-with-unknowns`. Not re-run since the change.

- **A detected collision surfaces evidence and asks; it never arbitrates.**
  `session-welcome.js` withholds the "resume at criterion N" instruction and
  prints the other session's id, branch, and how long ago it was last seen by
  which signal. `continue-loop.js` exits 2 with the same evidence instead of
  nudging the chain forward, and because a collision is not a nudge it burns
  none of the eight and logs no `milestone_started`. Both end by asking the
  owner which session owns the milestone.

  Deliberately not a lock and not a verdict. Two sessions in one tree is
  sometimes exactly what was intended - a second window reading while the
  first builds - and from inside a hook that is indistinguishable from a
  collision. A mechanism that guessed would be wrong in the legitimate case,
  which is the more common one. Only one shape is treated as a conflict:
  same worktree, same milestone, a different session, still alive. Same
  session re-entering (a `/clear`, a `--resume`, a second `SessionStart`) is
  not one; nor is a different git worktree, which `git rev-parse
  --show-toplevel` makes true by construction rather than by luck; nor is a
  different milestone in the same tree.

### Fixed

- **No profile routes the opus tier to an expensive model any more.** The
  default `openrouter` profile mapped opus/fable to
  `anthropic/claude-sonnet-4.5` ($3 / $15) on the assumption that only
  `--model opus` reached it. Claude Code's own built-in `Explore` and `Plan`
  agents ask for that tier: in the real $8.50 session, three `Explore`
  agents on it cost about $3.50 - more than the whole qwen3-coder main
  session - and no code was written at all (the session put itself in plan
  mode and hit the 402 with only a 974-byte plan). opus/fable now map to
  qwen3-coder in `openrouter`, to Luna in `openrouter-luna` (was GPT-6 Sol)
  and to qwen3-coder-next in `openrouter-lean` (was DeepSeek V4 Pro). A test
  requires every profile's opus and fable to reuse a model the profile
  already uses for its session or agents.

- **`devkit continue` no longer starts on a milestone another live session
  holds, and a collision is never asked about twice.** Found on a real
  fallback session: `devkit continue` armed it for M29 while a Claude session
  was already working M29, so every stop raised the collision question. The
  user answered "other work"; the hook, which cannot hear answers, asked
  again at the next stop, each time forcing another turn with the whole
  conversation attached - on OpenRouter, 80-100k tokens a time. Now
  `devkit continue` checks for a live owner first and, finding one, starts
  nothing and says who holds it. A collision that turns up later is reported
  once at a stop, which then pauses the loop in that session and releases
  its claim, so it cannot recur and the other session keeps the milestone.
  Under `"loopStart": "always"` there is no loop to pause, and it still
  repeats there.

- **A profile started from inside a Claude session used that session's
  login.** Running an eval under `openrouter-lean` from the desktop app's
  shell failed every request with `authentication_failed`, while the same
  `pong` from a plain terminal worked. The app hands child processes its own
  session variables (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
  `CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH`, `USE_LOCAL_OAUTH`, ...), so the
  `claude` it started believed it was the app's child and sent the app's
  login to OpenRouter. `profileEnv()` now strips a host session's variables,
  keeping a few `CLAUDE_CODE_*` settings that are the user's own intent;
  verified live from the desktop app's shell.

- **`appendTelemetry` no longer takes the Stop hook down with it.** Found by
  writing the "state directory is unwritable" test for the lease work, in
  code that predates it: the unguarded `fs.mkdirSync` threw straight out of
  `continue-loop.js` when a file sat where `.claude/rajesh-devkit/` belongs,
  so the hook exited 1 with a Node stack trace instead of 2 with its nudge -
  silently costing the project its entire Stop loop over a state-directory
  problem. A dropped telemetry line costs `devkit-stats` one data point; it
  now fails open like every other write this plugin makes to its own state.

- **A hand-run of `write-resume.js` no longer leaves a stale checkpoint
  looking current.** Without `CLAUDE_PROJECT_DIR` it exited 0 silently, so a
  manual run wrote nothing and the existing `resume.json` still read as
  fresh; `updatedAt` was the only clue, and it nearly produced a reading of
  "4/36" for a milestone that was 36/36. It now says on stderr that nothing
  was written and, if there is a `resume.json` in the current directory,
  which moment it actually describes. Still exits 0. The harness always sets
  the variable, so this can only ever print on a manual run - no noise in
  the loop.


## [0.4.0] - 2026-09-22

Everything here came out of one exercise: installing this plugin into the
project it was extracted from and trying to run a real milestone with it.
Half of these are bugs only a real repository could have exposed, two of them
found by deliberately killing a session mid-milestone and restarting it
somewhere else. The fixture in `tests/helpers.js` was too tidy to catch any
of them.

### Fixed

- **Milestone rows with an annotated status cell are no longer invisible.**
  `milestoneRowPattern` required the status cell to contain the glyph and
  nothing else, so a tracker that writes `| 28 | Expense Categories |
  (glyph) spec Approved 2026-09-18 (...) |` had half its rows silently
  unparsed. Measured on a real `PROGRESS.md`: 43 of 87 rows seen, and the
  loop confidently nudged toward M42 while M28 was the actual next
  milestone. Nothing failed loudly - it just worked on the wrong thing. The
  annotation is now captured rather than merely tolerated, because a project
  writes decisions in there.

- **The escalation gate no longer re-fires on work already underway.** Its
  "shown once per milestone" memory lives in OS temp, keyed by project path -
  which does not survive either of the two cases this release exists to
  support: picking the work up on another machine, or in a fresh session
  after a usage limit. Found in the resume drill, on real data: a session
  resuming M28 with 7 of its 36 criteria green was told `WRITE NO CODE YET`
  and to go ask a human how to approach the milestone - about work a human
  had already approved and seven passing tests already proved. Worse, it is
  the one instruction guaranteed to stall a resumed run. A ticked criterion
  is now taken as proof the gate's moment has passed, and unlike the temp
  file the ticks travel with the work. An untouched sensitive milestone
  still gates exactly as before.
- **The session banner no longer announces a provider switch in every
  ordinary session.** "Is this the default provider" was implemented as "is
  `ANTHROPIC_BASE_URL` unset", and the Claude Code desktop app sets it to
  `https://api.anthropic.com` itself - so the line printed always, which is
  how a line earns being ignored and how a real switch goes unnoticed when
  it happens. It now keys on what someone actually changed: a non-Anthropic
  host, a gateway credential, or a remapped tier.

- **An untouched milestone is no longer greeted as mid-flight.** 0 of 36
  criteria ticked has a perfectly good "next criterion" - the first one -
  so the resume banner announced "picking up M28, mid-flight" for a
  milestone nobody had started. False, and the wrong instruction: it says
  carry on, when the session should be running the gates that come before
  the first line of code.

- **The loop now says who closes a milestone out.** The closing step was
  "then treat the milestone as done", which named nobody - every other step
  hands work to a component that owns it, but this one assumed the
  orchestrator would update the tracker on its own. When it does not,
  nothing fails visibly: the row stays unfinished, so the Stop hook keeps
  nudging work that is already complete, and `track-milestones` never logs
  the "shipped" half of the telemetry pair, so `devkit-stats` can never
  report that milestone at all. It now names the four files that make "done"
  true, and - when `deliver` is off, which is the default - says plainly that
  the loop does not commit, rather than leaving a session to decide that for
  itself.
- **`checkpointCommit` with `deliver` off is now named as the mismatch it
  is.** The per-criterion `wip:` commits are squashed by `devkit-deliver` at
  ship; with deliver off nothing squashes them and they accumulate on the
  branch. Still legitimate - someone may squash by hand - so the banner names
  it rather than refusing it, the same way it names gate stages a loop
  switched off.

- **A hook run outside the harness no longer hangs forever.** Every script here drains
  stdin because the harness pipes a JSON payload and closes it - correct there, wrong on
  the other path these scripts are used on. `devkit-help` runs `session-welcome.js`
  directly, and if the invoking shell leaves stdin open the read waits for an EOF that
  never arrives. Found by running devkit-help's own documented command while dogfooding:
  it sat for a full two minutes and was killed. The skill said at the time that stdin was
  "not required" and that running it with nothing piped in "is fine", which was simply
  false. A terminal is now answered immediately, and the skill passes `< /dev/null` with
  an explanation of why that redirect is load-bearing.

### Added

- **`"loop": "devkit"` in `.claude/devkit.json`**, to take the stop
  conditions back from a project's own `spec-loop` skill. Detecting that
  skill and standing down was right, but it was a one-way door: the project
  this toolkit grew out of still has that skill, so installing the plugin
  there did nothing at all, and the only way to try it was to delete the
  fallback first. Both can now sit on disk with one of them driving.
  `"loop": "project"` is the opposite switch. Absent, detection decides
  exactly as before.
- **The spec `Status:` header is now a gate, not decoration.** A project
  whose workflow says "propose a spec and STOP for my approval" records that
  approval in the spec's own header, and the loop walked straight past it -
  a `Status: Draft` spec got the same implement-it nudge as an approved one.
  Draft now produces a review-and-approve nudge and never an implementation
  one; `Status: Implemented` under an unfinished tracker row reports a stale
  row instead of rebuilding shipped work. A spec with no such header behaves
  exactly as it always did. The Draft gate deliberately outranks the
  sensitive-escalation gate, and does not consume it - there is no point
  asking how to build something nobody has approved building.
- **Parked rows.** A tracker that doubles as an idea list has rows that are
  genuinely unstarted and genuinely not next: `| 29a | Expense Drafting
  Assistant | (glyph) not spec'd - see product_vision.md |`. The loop stalled
  on the first one forever, nudging for a spec the owner had deliberately
  parked. They are now skipped by the loop and reported by `devkit-help` -
  parked is not hidden, because a row skipped silently forever becomes
  invisible debt. `parkedPattern` configures it.
- **`sensitivePatterns`**, extra regexes ORed into the escalation gate. The
  gate keyed on the literal `SENSITIVE:` marker `devkit-specify` writes,
  which meant it never once fired in a project whose spec template predates
  this plugin and flags the same five categories in prose ("Money is
  `decimal`", "multi-tenancy", "an existing invariant"). Every money and
  tenancy milestone there would have been auto-delegated. Configured
  patterns can only make a fail-open gate fire more often, which is the safe
  direction; a malformed one disables itself rather than taking the hook
  down.
- **`scripts/write-resume.js`, a machine-written resume checkpoint** on
  `PostToolUse`, and the `SessionStart` banner that reads it back.

  This is the one that matters for velocity. A hard usage-limit block gives
  the session no turn at all: no `Stop` hook, no tidy-up, no summary. Until
  now the only record of position was `PROGRESS.md`'s `## In flight` block,
  which the *model* writes because it was told to - so its freshness assumed
  nothing had gone wrong, which is exactly what a hard stop breaks. In
  practice resumption also leaned on the session's own context surviving,
  and that disappears the moment the work continues somewhere else: another
  machine, or another provider after a limit.

  `PostToolUse` is the one event that has already fired by then. Every field
  in `resume.json` - milestone, spec, spec status, criteria ticked, next
  criterion, branch, dirty tree, provider - is derived from the repo, so it
  needs no cooperation from the model and can never be more than one edit
  stale. A cold session now opens with "picking up M28, mid-flight, resume at
  criterion 8" instead of a rediscovery pass.
- **`profiles/`, for running the loop on another provider.** No component
  here ever named a model - every subagent asks for a tier - so the four
  alias variables plus `ANTHROPIC_BASE_URL` re-target the entire chain
  without editing a single file in `agents/` or `skills/`. The profiles set
  those variables; `profiles/check.js` verifies every configured model ID
  still exists and prints today's price, because a stale ID does not fail at
  launch, it fails at the first request halfway through a milestone.

  Deliberately *not* added: a `model_mapping` block in config, or hooks that
  try to switch models. A hook cannot change the provider - it is a child of
  a process whose credentials were resolved before it existed - and a `Stop`
  hook writing `/model X` to stderr does nothing, because that stderr is text
  handed back to Claude, not a command the harness runs. Switching providers
  is always: set the environment, start a new session. The resume checkpoint
  above is what makes that cheap.
- **`prices` in `.claude/devkit.json`**, so `devkit-stats` can cost a
  milestone that ran on a gateway model. Without it every such token landed
  in `unknownModelTokens` and the report read `$0.00` - a cost report that
  says a run was free is worse than one that admits it does not know.
- **`checkpointCommit`**, optional `wip(M<N>)` commits per green criterion,
  squashed by `devkit-deliver` at ship. Off by default: per-criterion commits
  are history noise. Worth it for a stop that outlasts the machine staying on
  - a five-hour window, a laptop going home - because an uncommitted working
  tree is a fine checkpoint right up until the machine holding it isn't
  there.

### Removed

- `devkit-migration-guide.md`, a chat export that had been sitting in the
  repo root. Its central advice was wrong in ways that would have cost a day
  each: it proposed a Google AI Studio OpenAI-compatible endpoint (Claude
  Code speaks the Anthropic Messages API and only that), a base URL ending in
  `/v1` (which yields `/v1/v1/messages` and a 404 that reads like an auth
  failure), a `model_mapping` config block duplicating a remapping mechanism
  that already exists, and a `Stop` hook that switches models by writing
  `/model` to stderr, which does nothing. The parts that were right are now
  in the README, verified against the docs and against a live model
  catalogue.


## [0.3.0] - 2026-09-21

### Added

- `devkit-roadmap`, the component that bends the loop into a circle. Both
  boundaries were open: `devkit-onboard` decomposed milestones once and
  `PROGRESS.md` was hand-maintained forever, and nothing after release
  informed what to build next. The skill proposes the next Phase from four
  evidence sources - the shipped specs' `## Out of scope`, follow-ups whose
  unblock condition has been met, the gap to the vision document, and the
  production signal the repo records (issues, incidents, feedback files;
  never a live system) - with every candidate carrying its evidence. It
  interviews for the priority call, writes rows only on approval, and never
  starts a milestone. The empty-queue banner now points at it instead of
  saying "add a row when you have one".

- A licence pass in `devkit-dep-audit`. It found CVEs and nothing else, so
  a GPL dependency in a proprietary product passed clean. It now establishes
  the project's own posture first - its licence, whether it ships as a
  library or an application or a hosted service, any stated policy - then
  lists dependency licences with the ecosystem's own tooling (installing
  nothing, generating nothing) and flags Conflict, Needs a decision, and
  Unknown against that posture. A Conflict is a `needs-changes` verdict and
  a BLOCKED row in `devkit-ship`.

- Localisation in `devkit-ux`. It specified literal copy strings, which in a
  project whose rules say every user-visible string goes through `intl`
  meant the design stage was actively working against the project's own
  convention. It now detects the i18n mechanism the project actually has,
  specifies copy as key plus default text in that mechanism's plural and
  argument form, and appends localisation criteria the implementer,
  reviewer and ui-verify each check. A project with no mechanism gets plain
  copy and an open decision, never an i18n stack it didn't choose.

- `## Observability` and `## Performance budget` sections in the spec
  template, and `[observability]` / `[perf]` criterion markers that make them
  gated rather than read once. Nothing in the loop put a log line, a metric
  or a latency target into what shipped; a feature could pass every
  criterion and be undebuggable at 3am. `devkit-specify` asks the on-call
  question and the volume question explicitly, `devkit-implementer` emits
  through the project's existing mechanism and stops if there is none (that
  is an ADR, not a `console.log`), `devkit-reviewer` checks the named fields
  and the stated volume, and `devkit-quality` reviews against the budget
  instead of a number it invented.

- `devkit-release`, the `release` stage. `devkit-deliver` stopped at the
  PR and `devkit-docs` wrote one changelog entry per milestone; nothing
  decided a semver bump, rolled the entries into a version or wrote release
  notes. It runs at a Phase boundary, decides the bump with the evidence
  visible (a `SENSITIVE:` compatibility break in any shipped spec is a
  major whether the changelog said so or not), updates the version in every
  file that declares it, and ends with the `git tag` command without
  running it - tagging is the one git operation that stays human in every
  configuration, and a static test now fails if any component instructs it.

- `devkit-quality`, a report-only agent for the review the spec cannot ask
  for: design and performance. `devkit-reviewer` checks the change against
  its spec and `devkit-security` checks it for vulnerabilities; nothing
  checked whether it was built well enough to stay changeable or would hold
  at the volume the spec describes. It reads the project's own architecture
  rules and performance budgets first so a finding cites a rule the project
  wrote, works layering drift, duplication of logic, a class becoming the
  place everything goes, N+1 and unbounded reads, and marks matters of
  taste advisory so they never change the verdict. Wired as the `quality`
  stage (after `review`, before `security`) and as a `devkit-ship` row.

- Two more test-layer markers, `[contract]` and `[e2e]`, beside
  `[integration]`. The spec vocabulary had one marker, so a criterion that
  is really an agreement with a separately deployed client - the mobile app
  parsing this response - got marked `[integration]` and satisfied by a
  database-backed test that never left the process and never saw the client
  that will break. `devkit-specify` marks, `devkit-implementer` proves at
  that layer or stops (a project with no contract mechanism gets a finding,
  not a unit test dressed as one), `devkit-reviewer` checks what the test
  actually runs against.

- Behavioral evals for the five components that had none: `devkit-security`,
  `devkit-datamodel`, `devkit-ui-verify`, `devkit-pipeline` and
  `devkit-deliver`. `devkit-eval` is the drift check, and the five newest
  components were the five it couldn't see. Each case locks in the
  component's load-bearing rule with deterministic graders: security cites
  the project's own ADR and edits nothing; datamodel plans and writes no
  migration; ui-verify reports an unreachable state as UNVERIFIED rather
  than reading the template and calling it fine; pipeline names the missing
  gates without writing a workflow; deliver refuses when the stage is off.

- The `SessionStart` banner names the gate stages (`review`, `security`,
  `ship`) a configured loop has switched off while `implement` is on. A
  narrow loop is legitimate, but the config file made "deliberately gates in
  the PR" and "forgot" look identical, and because the UNKNOWN-never-PASS
  rule lives inside `devkit-ship`, switching ship off removed the one place
  an unrun check would have been reported. One sentence, once per session,
  never blocking; `skippedGates()` in `scripts/lib/devkit.js` is the rule.

### Fixed

- The observability rule stopped the implementer whenever a signal had no
  mechanism, which on a project that has structured logging today and
  OpenTelemetry deliberately scheduled for a later Phase would have blocked
  every milestone until then. A signal with a *recorded* plan is now
  specified in mechanism-neutral terms and deferred through
  `Tracked follow-ups` with that milestone as the unblock condition; the
  stop is reserved for no mechanism *and* no plan. The spec template and
  README now say plainly that no particular stack is required.
- README's "What this plugin is" list was missing six components and the
  model table eight, while the presence test passed because every name
  appeared in the layout tree. A stricter static test checks those two
  sections separately.

- `devkit-ui-verify` could satisfy "get the app running" by writing its own
  backend. Its eval caught a run that stood up a stub API to reach the
  empty, success and permission-denied states, reported them PASS, and
  returned `mismatches` over a leak in the 403 body its own stub produced.
  The rule now states the line: you may take a dependency away to induce a
  failure; you may never supply one. Reached through a stand-in is not
  reached, and "confirmed in markup" is a prediction, not an observation. A
  deterministic grader backs the llm judge, which had passed the run.

- `devkit-dep-audit` still described itself as complementing
  `claude-security` for code-level review; that role has been
  `devkit-security`'s since it was added.

- `devkit-deliver` stated it was off unless the `deliver` stage was enabled
  but had no step that read `.claude/devkit.json` - only the Stop hook
  honoured the config, so a person invoking it by name got commits
  regardless. Found while writing its eval. Precondition 0 now reads the
  config with the hooks' precedence, treats a missing or malformed file as
  off, and stops before any git write.

- `devkit-ship` now has a gate row for every report-only stage that runs
  before it. `devkit-datamodel`, `devkit-ui-verify` and `devkit-security`
  each produced a result, and only security's reached ship's table - the
  other two were reports somebody had to remember to read. The **Data model**
  row checks the plan against the diff: the migration the plan names must be
  in the change (the exact shape of the M13 failure, where an entity changed
  and no migration ever existed) and `## Rollback` must say something. The
  **UI states** row routes on `devkit-ui-verify`'s verdict strings. Both
  follow the existing rule - a stage that hasn't run is `UNKNOWN`, a stage
  that doesn't apply is `PASS (not applicable)` with the reason stated.
  `devkit-ui-verify` and `devkit-datamodel` now say what consumes their
  output, and the Stop hook's ship nudge says ship reads the other verdicts.

- `docs/SDLC.md` described a six-stage loop and stated that nothing in the
  plugin commits, pushes or tags, a full day after `devkit-deliver`,
  `devkit-datamodel`, `devkit-security`, `devkit-ui-verify` and
  `devkit-pipeline` all existed. The diagram, the stage table and the
  walkthrough steps now cover all eleven stages, the "not automated" section
  states the `deliver` exception precisely, and the test/eval counts that
  went stale twice are gone in favour of pointing at where the real numbers
  live. A new static test fails when any agent, skill or stage name is
  missing from either the README or the walkthrough, so the drift is
  mechanical from here on. `devkit-eval`'s drift checklist names SDLC.md
  alongside the README and lists the full handoff chain.

## [0.2.0] - 2026-09-18

The state of the plugin at the start of this changelog: eleven agents, six
skills, four hooks, a configurable stage list, and the end-to-end walkthrough
in `docs/SDLC.md`. Earlier history is in `git log`, whose messages carry the
reasoning this file continues.
