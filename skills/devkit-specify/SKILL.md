---
name: devkit-specify
description: Drafts a feature spec for the current repo, acting as product owner — reads the relevant code and any decision-record docs first, then interviews the user for anything that can't be confidently inferred, and writes the result to specs/<kebab-feature>.md for review before any implementation. Stack-agnostic — infers the repo's own layout and conventions instead of assuming one. Trigger phrases — "write a spec", "spec this feature", "specify <feature>", "draft a spec for <feature>", "let's spec <feature>".
argument-hint: <feature>
model: fable
effort: high
---

# Specify a feature

Draft a spec for: $ARGUMENTS

If no feature was given as an argument, ask the user what to spec before doing
anything else — do not guess a feature to work on.

This skill assumes nothing about prior conversation, and nothing about the
project's language or stack. Do the steps below in order, using only the
repo's own files and the user's answers.

## Steps

1. **Learn this repo's own shape first.** Read `CLAUDE.md` (or `README.md` if
   that's absent) and skim the top-level directory layout to work out where
   application code, tests, and docs actually live — don't assume `src/`,
   `api/`, `app/`, or any other convention until you've actually seen it.
   Check for a decision-record folder (`docs/adr/`, `docs/decisions/`,
   `docs/decision_log.md`, or similar — name varies by project) and read
   anything in it relevant to this feature, so the spec doesn't contradict a
   decision already made. Check whether `.claude/rules/*.md` or an equivalent
   conventions folder exists, and if so, read whichever files apply to what
   this feature touches — this is where a project states its own testing
   discipline, layering rules, or approval gates, and the spec should respect
   them without restating them.

2. **Read reality.** Search the codebase for whatever the feature actually
   touches — related endpoints/routes, data models, services, and existing
   tests — using the layout you just learned. Don't skip this because the
   feature sounds simple: a spec written from assumption instead of the real
   code is worse than no spec at all.

3. **Open the template.** Check `specs/` for what this project already uses,
   in this order, before falling back to anything of your own:
   - A dedicated template file — `_template.md`, `TEMPLATE.md`, or similarly
     named — if one exists, use it as-is.
   - Otherwise, if `specs/` already has other spec files, treat the most
     recently written one's structure as this project's de facto template —
     don't impose a different shape on a project that already has one, even
     an informal one.
   - Only if `specs/` is empty, or has nothing that reveals a shape, create
     `specs/_template.md` with exactly this fallback content (five sections,
     one page, no more):

   ```markdown
   # Spec: <short feature name>

   Milestone: <see project's own tracker, if any — e.g. PROGRESS.md> · Status: Draft | Approved | Implemented · Related decisions: —

   ## Context

   Why this now — the problem, who hits it, and any constraint that shapes the approach
   (an existing invariant to preserve, a decision already made elsewhere). Link, don't
   repeat: point at the doc that already explains something instead of restating it.

   ## Behaviour / requirements

   What the system must do, in concrete terms — not an implementation plan. Prefer
   numbered "given X, the system does Y" statements over prose. If a requirement touches
   an existing invariant, a security or authorization boundary, a data-model change, an
   external integration, or backward compatibility with something already shipped,
   prefix that requirement with "🔒 SENSITIVE:" exactly — this is a machine-checked
   marker other parts of this toolkit key off of (the Stop hook's escalation gate), not
   just a stylistic flag, so use it only for these five categories and use it every time
   one applies, even if it feels obvious in context.

   ## Edge cases

   The inputs/states that aren't the happy path: empty/zero/negative values, boundary
   dates, concurrent edits, already-processed items, missing/expired credentials,
   unauthorized-access attempts. If it's not listed here, assume it wasn't considered.

   ## Out of scope

   What this deliberately does not cover, and why (deferred, already handled elsewhere,
   etc.). Keeps reviewers from scope-creeping the implementation.

   ## Acceptance criteria

   Concrete, testable statements — each should map to a test name someone could write
   today. Cover the happy path *and* at least one denial/negative case per boundary
   touched.

   - [ ] ...
   - [ ] ...
   ```

4. **While writing Behaviour/requirements, actively check each requirement
   against the five sensitive categories** (existing invariant, security/auth
   boundary, data-model change, external integration, backward-compatibility
   break) — don't wait for one to jump out at you; go through the list
   deliberately for every requirement. Mark every match with `🔒 SENSITIVE:`
   per the template. This is the one thing in this spec that a later
   automated step (not a human) checks for, so a missed one doesn't just
   cost a review comment — it means a milestone that should have paused for
   a human decision gets automated straight through instead.

5. **Interview, one question at a time.** For every section, fill in what you
   can confidently infer from the code and docs you just read, and say what
   you're basing each inference on. For anything you can't confidently infer —
   the actual desired behaviour, edge-case decisions, what's deliberately out
   of scope, concrete acceptance criteria — ask the user **one question at a
   time** and wait for the answer before asking the next. Do not guess and do
   not silently fill gaps yourself.

   The one exception, so a one-line function doesn't turn into a five-question
   interrogation: a **narrow, low-stakes** gap — the answer doesn't change the
   feature's shape, doesn't touch security/auth/data-model/money, and a wrong
   guess costs one correction on review rather than a rebuild — can take a
   reasonable default instead of a question, flagged inline as "🚩 assumption,
   not confirmed" rather than presented as settled fact. Default to asking
   whenever you're unsure which side of that line something falls on. If you
   find yourself about to flag more than two or three assumptions in the same
   section, that's a sign the section itself is under-specified — ask one
   consolidated question about the section's actual intent instead of
   individually defaulting every gap inside it.

6. **Write the file.** Once every section has real content — no section left
   as a placeholder or a bare "TBD" — write the result to
   `specs/<kebab-case-feature>.md`, following the template's structure and
   section order exactly.

7. **Stop, and lead with the sensitive flags if there are any.** If step 4
   marked one or more requirements `🔒 SENSITIVE:`, say so plainly as the
   first thing in your report — not buried after the spec content — and
   name which requirements and why: this milestone may warrant implementing
   directly at higher reasoning instead of delegating to the standard
   implementer, and that's the user's call to make before implementation
   starts, not something to decide implicitly by just proceeding. This
   matters even though the Stop hook has its own automated check for the
   same marker (see this plugin's README) — that check only fires if a
   session actually stops in between; saying it here too covers the case
   where implementation is requested in the very same turn. Then show the
   finished spec and stop there. Do not write,
   edit, or scaffold any implementation code, migration, or test — this
   skill's job ends at the spec. Implementation only happens later, as a
   separate step the user explicitly asks for (respect a project's own
   spec-before-code rule if `.claude/rules/` or `CLAUDE.md` states one; if the
   project states no such rule, still default to stopping here rather than
   assuming permission to continue).
