---
name: devkit-onboard
description: Guided setup that gets any project onto this toolkit's loop, one question at a time — for an empty folder it offers git init, a product-vision interview (devkit-vision), starter files from the plugin's templates (CLAUDE.md, .claude/rules, ADRs, a spec template, PROGRESS.md) and a loop preset (full, api, ui, product, design); for an existing repo it inventories what is already there (code, CLAUDE.md/AGENTS.md, specs, trackers, ADRs), seeds the test-runner cache and proposes only what is missing. Never overwrites a file. Trigger phrases — "devkit onboard", "devkit onboard this project", "set up devkit here", "get this repo on the devkit loop".
model: inherit
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.js" *)
---

# Onboard a project onto the dev loop

The loop this toolkit automates needs three things to exist: a `PROGRESS.md`
with milestones, a `specs/` folder, and enough project context that
`devkit-specify` doesn't write specs that contradict how the codebase already
works. Your job is to get a project from wherever it is to that state.

**How to run it: one decision at a time, with `AskUserQuestion`.** Each
numbered step below that says *ask* is one question, with the recommended
answer first. Never batch five questions into one message and never decide
on the user's behalf — this is often the first thing a new user of the
plugin sees, and it should feel like a short guided conversation, not a
form. Say at the start roughly how many questions are coming (six to eight).

**Starter files come from the plugin, by script — never retyped.** The
templates live in `${CLAUDE_PLUGIN_ROOT}/templates/`, and
`node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.js"` copies the ones the user
chooses (`--list` shows them). It never overwrites an existing file and
prints exactly what it created and what it kept. Fill in their
`<placeholders>` afterwards, from what you learned and with the user's
confirmation.

**The rule that governs every step: inventory before you write.** A project
with history usually has some of this already, in its own shape, under its
own names. Creating a second convention alongside an existing one is worse
than doing nothing — it splits the source of truth, and from then on nobody
knows which file is real. Read first, propose second, write only what the
user confirms.

## Steps

1. **Inventory everything, and report it before touching a single file.**

   - **This toolkit's own prerequisites:** `PROGRESS.md` (or `ROADMAP.md`,
     `TODO.md`, `MILESTONES.md` — the tracker may exist under another name),
     `specs/`, `docs/adr/` or another decision-record folder, `CLAUDE.md`,
     `AGENTS.md` (anywhere in the tree) and `.github/copilot-instructions.md`
     - a project shared with other agent runtimes keeps its instructions
     there, and Claude Code reads `AGENTS.md` too.
   - **Other `.claude` assets**, in the project *and* in
     `%USERPROFILE%\.claude`: existing skills, subagents, commands, hooks,
     and `.claude/rules/`. Two collisions specifically matter:
     - A `.claude/skills/spec-loop/SKILL.md`-shaped skill → this plugin's
       `Stop` hook **defers to it entirely and never fires**. That's by
       design, not a bug, but it means the automatic nudge won't happen here
       and the user should know that now rather than wonder later.
     - An already-installed `devkit-`prefixed skill or agent from a previous
       install of this plugin.
   - **Git reality:** is this a repo, does it have a remote, is there CI
     config (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`), is there
     a `.gitignore`.
   - **Does real code exist yet?** This is the branch point for everything
     below — count source files, check `git log` for history. An empty
     folder (nothing but `.git`, `.claude` or editor settings) is a
     **greenfield** start; everything else is an **existing project**.

   Report all of it as a short list. This is the 30-second check that avoids
   every collision risk below, and it is never skipped.

   **Greenfield and not a git repository yet → ask** "Initialise git here?"
   (recommended: yes). On yes, run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.js" . --git-init --items gitattributes`
   — git plus LF line endings, so the project is identical on every OS.

2. **Detect the stack and seed the test-runner cache.** *(Existing projects,
   or a greenfield project once its stack is chosen — skip it for an empty
   folder and say you will come back to it.)* Work out what this
   project is built with and how its tests actually run — `package.json`,
   `pyproject.toml`/`pytest.ini`, `*.csproj`/`*.sln`, `go.mod`,
   `Cargo.toml`, `pubspec.yaml`, and any of these more than once in a
   monorepo.

   **Run the test command once to confirm it actually works** before
   recording it — a command copied out of a README that errors on this
   machine is worse than no cache entry. Then write the confirmed command to
   `.claude\rajesh-devkit\test-runners.json` as an array of
   `{"area", "command", "workingDirectory", "detectedFrom"}` entries, one per
   stack. That's `devkit-implementer`'s own cache format, and seeding it here
   means the first milestone doesn't spend its opening moves rediscovering
   this. Create the folder if needed; it's gitignored per-machine data.
   If what you read says the suite cannot run concurrently with itself — a
   single shared test database, fixed ports, a "run tests serially" note in
   `CLAUDE.md` or the CI config — add `"exclusive": true` and a one-line
   `"exclusiveReason"` to that entry. Overlapping runs of such a suite
   produce phantom failures that look exactly like regressions.

   **`area` is derived, never invented** — it is the stack's own directory
   relative to the repo root, with the literal string `root` when the stack
   lives at the repo root, using forward slashes: `root`, `frontend`,
   `services/api`. This rule is stated identically in `devkit-implementer`
   and the two must stay in agreement. Seeding the cache under a name you
   chose ("the API", the package's name) rather than the derived one is
   worse than not seeding at all: the implementer derives its own key, misses
   your entry, and appends a duplicate for a stack that was already cached —
   so the first milestone re-derives the runner anyway and the file now has
   two answers for one directory.

   If the command fails for an environmental reason (missing dependencies,
   no runtime installed), say so and don't cache it — that's a real setup
   problem the user needs to see now, not a fact to record.

3. **Establish product intent — from what exists, if anything does.**

   - **Existing project:** intent is almost always already written down
     somewhere — `README.md`, a `docs/` folder, a wiki, even just commit
     history and issue titles. Read it, then **summarize your understanding
     back to the user for correction** rather than starting from a blank
     page. Save the confirmed version wherever this project already keeps
     that kind of document; only fall back to `docs/product_vision.md` if
     there's no existing home for it.
   - **Brand-new project → ask** "Shall we write the product vision now?"
     (recommended: yes). On yes, hand over to the **`devkit-vision`** skill
     — it interviews the user one question at a time and writes
     `docs/product_vision.md` from their answers only. Say first that this
     is the step worth a strong model: if the session isn't on Opus or Fable,
     suggest switching (`/model opus`) for the interview. Don't generate a
     vision document from a one-line description; a fabricated vision is the
     one artifact here that will quietly misdirect every spec that follows.

4. **Starter files → ask**, as one multi-select question, which of these the
   project should get — recommend all of them for a greenfield project, and
   only the missing ones for an existing project:
   `claude-md`, `rules`, `adr`, `spec-template`, `progress`,
   `vision` (skip if step 3 already wrote it), `gitattributes`.
   Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.js" . --items <chosen,comma,separated>`
   and show its output as-is. Then fill the placeholders you can — the
   commands in `CLAUDE.md`, the test layers in `.claude/rules/testing.md`
   — from what you actually detected, and leave the rest as visible
   `<placeholders>` with a one-line note on who fills them.

   **`CLAUDE.md` (and `AGENTS.md`).** If the project already keeps its
   instructions in `AGENTS.md` for other agents, don't fork them into a
   second, drifting copy: a `CLAUDE.md` that imports it (`@AGENTS.md`) and adds
   only what is Claude-specific keeps one source of truth. Keep `CLAUDE.md`
   short — Claude Code's own guidance is under 200 lines, because a longer
   file is followed less, not just billed more. If one exists, read it and refine — never overwrite
   blind; if `claude init` is used, skim the diff afterward rather than
   trusting it. If there's none but real code exists, this is exactly what
   `claude init` is for: it has an actual codebase to learn from. For a truly
   empty project, note that `claude init` will produce something thin, and
   it's better revisited once there's code.

5. **`PROGRESS.md` — the real judgment call, and the user's to make.** If a
   tracker already exists under any name, adapt to it rather than replacing
   it; check whether its format is one the `Stop` hook can parse (a milestone
   table with status glyphs, or `- [ ]` task lines) and say plainly if it
   isn't.

   If there's no tracker, present both options honestly and ask — don't pick:
   - **Lightweight:** only upcoming milestones as rows, plus a one-line note
     that existing functionality predates the tracker and isn't itemized.
     The loop only reads unstarted rows, so this is enough to start today.
   - **Thorough:** a retroactive row per already-shipped feature, marked done
     from day one, optionally with a retroactive spec written from the actual
     code. Genuinely more upfront work, and genuinely more useful later.

   For a brand-new project neither applies — the milestones are just the
   plan. Decompose `docs/product_vision.md` into **phases** (`## Phase 1 —
   <name>` headings: the loop, and parallel lanes, work by phase) of a
   handful of milestones each, every milestone small enough to spec and ship
   in one sitting. Propose them as a table, **ask** the user to confirm or
   edit, then write them into the scaffolded `PROGRESS.md`. The first phase
   is usually repository and stack setup — whose decisions become the first
   ADRs in step 6.

6. **Backfill only load-bearing ADRs.** From the code and the user's
   answers, identify decisions that still constrain how new work must be
   written — the datastore, the auth mechanism, a layering rule, a
   deliberate trade-off visible in the architecture. **Propose the list
   first** and let the user cut it; then write the survivors with
   `devkit-adr`, which handles the convention detection and the interview.

   Skip anything that no longer constrains a future decision. The goal is
   that `devkit-specify` won't contradict something load-bearing — not a
   complete written history.

7. **Ask which stages this project's loop should actually run, and write it
   down.** Not everyone wants the whole chain, and a loop that nudges toward
   stages its owner never wanted is noise they'll learn to ignore — which
   costs you the nudges that did matter.

   **Ask once**, offering the presets (recommended first for the project as
   you now understand it):

   | Preset | For | Stages |
   |---|---|---|
   | `full` | a solo developer doing everything | every stage except `deliver` |
   | `api` | backend / API work | `specify`, `datamodel`, `implement`, `review`, `quality`, `security`, `ship`, `docs` |
   | `ui` | screens on top of APIs that already exist | `specify`, `ux`, `implement`, `ui-verify`, `review`, `quality`, `ship`, `docs` |
   | `product` | a product owner: specs and release notes | `specify`, `docs` |
   | `design` | a UX designer | `ux` |
   | custom | anything else, or a project with its own loop | only the stages it lacks |

   Write the answer to `.claude/devkit.json`, **committed**, so the project's
   declared process is visible and reviewable rather than living in one
   person's head — `scaffold.js . --preset <name>` does it when the file
   doesn't exist yet; otherwise edit it:

   ```json
   { "preset": "api" }
   ```

   An explicit `"stages": [...]` list wins over `preset`, for a custom
   choice. Tell the user the preset is only the project's default: any one
   session can pick its own — `devkit continue phase 3 as ui` runs that
   session as a UI lane without changing the file for anyone else. (The
   implementer stays in the `ui` preset on purpose: it implements whatever
   the spec describes, in the project's own stack — in a UI lane, the
   screens and their tests.)

   Valid stages: `specify`, `ux`, `datamodel`, `implement`, `ui-verify`,
   `review`, `quality`, `security`, `ship`, `docs`, `release`,
   `pipeline`, `deliver`. **`deliver` is off unless
   asked for** - it is the only component that commits and pushes, so never
   enable it without the user explicitly choosing it. `role` is a label for humans; only `stages` changes
   behaviour. **No file means every stage is enabled** — so a project that
   never answers this question behaves exactly as it did before the setting
   existed.

   If someone wants a narrower loop than the repo's default just for
   themselves, that goes in `.claude/rajesh-devkit/devkit.local.json` (same
   shape, gitignored, wins over the committed one). Mention it only if they
   ask; most projects want one answer.

8. **Verify the loop can actually see what you built.** Before declaring
   this done, confirm the machinery works rather than assuming it:
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/session-welcome.js"` (the same
     check `devkit-help` runs) and confirm it identifies the next milestone
     correctly. If it reports
     nothing queued while `PROGRESS.md` plainly has unstarted rows, the
     tracker's format isn't parseable — fix that now, because every hook in
     this plugin depends on it.
   - Confirm `.claude/rajesh-devkit/` is gitignored.

9. **Hand off with one concrete next step, then stop.** Name the actual first
   milestone and the exact thing to say to start the loop on it:
   **`devkit continue`** — it begins with `devkit-specify` when the
   milestone has no spec yet. Mention the two variants once:
   `devkit continue all` (the whole queue, unattended) and
   `devkit continue phase N as <preset>` (one phase as a lane, for parallel
   sessions). Don't end on a summary of what you did — end on what happens
   next.

   **Do not start that milestone.** Onboarding ends at the handoff: do not
   invoke `devkit-specify`, draft a spec, or begin implementing, even though
   you now know exactly what the first milestone is and it would feel
   helpful. Everything you just set up — the tracker, the conventions, the
   backfilled decisions — is the user's to look over before work starts
   against it, and rolling straight into the first feature takes that review
   away. Wait to be asked.
