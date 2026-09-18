---
name: devkit-onboard
description: Gets a project onto this toolkit's loop — inventories what already exists (CLAUDE.md, specs/, docs/adr/, milestone trackers, other .claude assets), detects the stack and seeds the test-runner cache, then proposes a PROGRESS.md and any load-bearing ADRs to backfill. Handles both a brand-new project and one with existing code and history, without clobbering anything already there. Trigger phrases — "devkit onboard this project", "set up devkit here", "get this repo on the devkit loop".
model: inherit
---

# Onboard a project onto the dev loop

The loop this toolkit automates needs three things to exist: a `PROGRESS.md`
with milestones, a `specs/` folder, and enough project context that
`devkit-specify` doesn't write specs that contradict how the codebase already
works. Your job is to get a project from wherever it is to that state.

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
     `specs/`, `docs/adr/` or another decision-record folder, `CLAUDE.md`.
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
     below — count source files, check `git log` for history.

   Report all of it as a short list. This is the 30-second check that avoids
   every collision risk below, and it is never skipped.

2. **Detect the stack and seed the test-runner cache.** Work out what this
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
   - **Brand-new project:** there's nothing to read, so this is a
     conversation. Ask what's being built, who for, and what "done" looks
     like for a first release — one question at a time. Don't generate a
     vision document from a one-line description; a fabricated vision is the
     one artifact here that will quietly misdirect every spec that follows.

4. **`CLAUDE.md`.** If one exists, read it and refine — never overwrite
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
   plan, so decompose the product intent from step 3 into a handful of
   milestones each small enough to spec and ship in one sitting, and get them
   confirmed.

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

   Ask once, offering these as starting points rather than a fixed menu (use
   `AskUserQuestion`; people can combine them):

   | Role | Stages |
   |---|---|
   | Product owner — write specs, document what shipped | `specify`, `docs` |
   | UX / design — turn specs into screens and states | `ux` |
   | Backend engineer — schema, API, tests | `specify`, `datamodel`, `implement`, `review` |
   | DevSecOps — pipelines, scanning, release gating | `pipeline`, `ship` |
   | Everything (solo, or one person wearing all hats) | all of them |
   | This project already has its own loop | only the stages it lacks |

   Write the answer to `.claude/devkit.json`, **committed**, so the project's
   declared process is visible and reviewable rather than living in one
   person's head:

   ```json
   { "role": "product-owner", "stages": ["specify", "docs"] }
   ```

   Valid stages: `specify`, `ux`, `datamodel`, `implement`, `ui-verify`,
   `review`, `ship`, `docs`, `pipeline`, `deliver`. **`deliver` is off unless
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
   milestone and the exact thing to say to start it
   (`"devkit spec this feature: <name>"`). Don't end on a summary of what you did —
   end on what happens next.

   **Do not start that milestone.** Onboarding ends at the handoff: do not
   invoke `devkit-specify`, draft a spec, or begin implementing, even though
   you now know exactly what the first milestone is and it would feel
   helpful. Everything you just set up — the tracker, the conventions, the
   backfilled decisions — is the user's to look over before work starts
   against it, and rolling straight into the first feature takes that review
   away. Wait to be asked.
