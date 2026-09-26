# Principles — read before changing this plugin

This is the charter for every change to rajesh-devkit. `CLAUDE.md` imports it,
so every Claude Code session working on this repository has it in context. If
a change conflicts with a principle here, the change needs a very good reason
— write that reason into the change itself and into `CHANGELOG.md` — or the
change is wrong.

## 1. Generic first: never shaped around one project

This plugin is for **anyone's** project. It was extracted from one real
product and is still dogfooded on it, and that product is where much of its
evidence comes from — but evidence is not a requirement.

- **Detect, don't impose.** Read the host project's own conventions —
  `CLAUDE.md`, `AGENTS.md`, `.claude/rules/`, ADRs, its test runner, its
  coverage gate, its tracker — and follow them. Never assume a stack, a
  folder layout, a database, an OS or a team size.
- **Variation lives in the host's configuration, not in this code.** When one
  project needs something different, add a generic, documented knob
  (`.claude/devkit.json`, a profile field, a stage) with a default that
  preserves today's behaviour. Never a special case for one project's names,
  paths or domain.
- **A real incident may be cited as evidence** ("found in M28: …"), and
  should be — it's what makes a rule believable. It must never become an
  assumption: if the rule only makes sense for that project, it doesn't
  belong here.
- **Test before merging:** "would this help a stranger's project that looks
  nothing like the one that prompted it?" If the answer is no, it belongs in
  that project's own rules, not in the plugin.

## 2. Easy to start, easy to keep running

- A new user gets to a running loop with the README's install step,
  `devkit onboard this project` and `devkit continue`. Nothing else should
  be required; everything else is optional and has a working default.
- **One command per action, identical on Windows, macOS and Linux.** Tooling
  is Node, because Claude Code guarantees Node. No step may require a shell
  script, admin rights, a relaxed execution policy or a particular shell.
- The loop must be resumable from disk at any moment — after a crash, a
  usage limit, a machine change or a provider change — without the old
  session's context.
- Any user-facing change updates, in the same change, the README, the
  CHANGELOG, and `devkit-help` / the start-up banner where the user would
  look for it.

## 3. Verification over trust — and it fails safe

- Tests are seen failing before code is written; reports show that evidence
  rather than claiming it.
- A check that could not run is `UNKNOWN`, never `PASS`. A verdict issued on
  code that has since changed is `STALE`. When provenance is unknown, the
  answer is the cautious one.
- The plugin applies this to itself: every behavioural change gets a test
  (`node --test tests/*.test.js`) that asserts what the behaviour *means*,
  not how a message is worded; prompt changes are measured with the evals
  (`node tests/run-evals.js`).

## 4. Humans decide; the plugin never arbitrates

- Hooks surface evidence and ask. They never guess which of two sessions,
  specs or verdicts is right.
- Nothing commits, pushes, tags, merges or opens a PR unless the project has
  explicitly enabled the `deliver` stage — and even then never anything
  irreversible (force-push, default-branch push, merge, history rewrite).
- A session is driven only after the user says so (`devkit continue`), and
  stops when told (`devkit pause`). A session doing other work is never
  dragged into the loop, nagged, or reported to others as a collision.

## 5. Hooks fail open and never crash

A hook that dies on malformed config, an unwritable state directory, a bad
regex or a missing network does more damage than one that does what it
always did. Every read of the plugin's own state tolerates absence and
corruption; every write is atomic and best-effort; network calls have short
timeouts and fail silently.

## 6. Cost-aware and provider-neutral

- **Tokens are money.** The user pays for every session. Prefer designs
  that spend fewer tokens (short scoped sessions, context ceilings, cheap
  models for cheap work), say what things really cost, and never make
  parallelism or a more expensive tier the default.
- **Ask for tiers, never model IDs.** Components request `sonnet`, `haiku`,
  etc.; profiles map tiers to models. No file in `agents/` or `skills/`
  names a provider or a model ID.
- **Every tier is used by something.** Claude Code's own built-in agents use
  the opus tier; a profile must never map any tier to an expensive model by
  accident.
- **Respect the host's instruction files, whoever they were written for.**
  `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` — a project
  shared with other agent runtimes shouldn't have to fork its rules for us.

## 7. Parallel-safe, but sequential by default

- Sessions claim the milestone they're driving; two sessions never drive the
  same milestone in the same working tree.
- Parallel work runs in **lanes**: one phase per session (`devkit continue
  phase N`), one git worktree per lane, and a lane's test resources kept
  separate. Put the parallel lane on a gateway profile when the Claude usage
  limit is the constraint.
- Sequential remains the default and the recommendation for a solo
  developer on a usage limit: parallelism saves time, not tokens, and the
  reviewer's attention is the real bottleneck.

## 8. Measure, record, correct in public

- Claims about models, costs and behaviour are measured before they're
  written down, and the measurements go in `docs/model-learnings.md` — real
  cost, score, what happened, and the lesson.
- Wrong conclusions are corrected where they were published, saying what was
  wrong and why. Never quietly rewritten.

## 9. House style

- Comments explain **why** — the failure the code prevents, with the
  evidence — not what the code does.
- Script sources are pure ASCII (escape anything else); every file is
  checked out with LF endings (`.gitattributes`).
- CHANGELOG entries say what changed and the failure it prevents. The
  version in `.claude-plugin/plugin.json` moves with every behavioural
  change, because installed copies only update when it does.

## Checklist for every change

- [ ] Does it assume anything about one particular project? (§1)
- [ ] Does a new user still get from install to a running loop without it? (§2)
- [ ] Is every new default the safe one, and every unknown reported as unknown? (§3)
- [ ] Does anything new happen without the user asking? (§4)
- [ ] Can it crash a hook? (§5)
- [ ] What does it cost in tokens, and on which tier? (§6)
- [ ] Is it safe with two sessions — and does it stay out of the way with one? (§7)
- [ ] Test added; README, CHANGELOG, help/banner and version updated. (§2, §3, §9)
