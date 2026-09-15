---
name: devkit-specify
description: Drafts a feature spec for this repo by reading the relevant code and docs/adr/ first, then interviewing the user for anything that can't be confidently inferred, and writes the result to specs/<kebab-feature>.md for review before any implementation. Trigger phrases — "write a spec", "spec this feature", "specify <feature>", "draft a spec for <feature>", "let's spec <feature>".
argument-hint: <feature>
model: fable
effort: high
---

# Specify a feature

Draft a spec for: $ARGUMENTS

If no feature was given as an argument, ask the user what to spec before doing
anything else — do not guess a feature to work on.

This skill assumes nothing about prior conversation. Do the steps below in order,
using only the repo's own files and the user's answers.

## Steps

1. **Read reality first.** Search the codebase (`api/`, `mobile/`) for whatever the
   feature touches — related endpoints, domain entities, services, and existing
   tests. Read every file in `docs/adr/` (and skim `docs/decision_log.md` for older,
   pre-`docs/adr/` decisions) that's relevant to this feature, so the spec reflects
   what the code actually does today and doesn't contradict a decision already made.
   Don't skip this step because the feature sounds simple — a spec written from
   assumption instead of the real code is worse than no spec at all.

2. **Open the template.** Read `specs/_template.md`. If it doesn't exist, create it
   first with exactly this content (five sections, one page, no more):

   ```markdown
   # Spec: <short feature name>

   Milestone: M__ (PROGRESS.md) · Status: Draft | Approved | Implemented · Related ADRs: —

   ## Context

   Why this now — the problem, who hits it, and any constraint that shapes the approach
   (an existing invariant to preserve, a decision already made elsewhere). Link, don't
   repeat: point at the ADR or doc that already explains something instead of restating it.

   ## Behaviour / requirements

   What the system must do, in concrete terms — not an implementation plan. Prefer
   numbered "given X, the system does Y" statements over prose. Call out explicitly if
   this touches:
   - Money/decimal handling, multi-tenancy, or an existing invariant (see
     `.claude/rules/architecture.md`).
   - Which roles can do what (Secretary/Treasurer/Committee/Owner/Tenant/Staff).

   ## Edge cases

   The inputs/states that aren't the happy path: empty/zero/negative values, boundary
   dates, concurrent edits, already-processed items, missing/expired tokens, cross-tenant
   access attempts. If it's not listed here, assume it wasn't considered.

   ## Out of scope

   What this deliberately does not cover, and why (deferred to a later milestone, already
   handled elsewhere, etc.). Keeps reviewers from scope-creeping the implementation.

   ## Acceptance criteria

   Concrete, testable statements — each should map to a test name someone could write
   today. Cover the happy path *and* at least one denial/negative case per role boundary
   touched (matches the integration-test convention in `docs/coding_standards.md`).

   - [ ] ...
   - [ ] ...
   ```

3. **Interview, one question at a time.** For every section, fill in what you can
   confidently infer from the code and ADRs you just read, and say what you're basing
   each inference on. For anything you can't confidently infer — the actual desired
   behaviour, edge-case decisions, what's deliberately out of scope, concrete
   acceptance criteria — ask the user **one question at a time** and wait for the
   answer before asking the next. Do not guess and do not silently fill gaps yourself.
   If keeping the interview moving requires making a reasonable default instead of
   asking about every last detail, that's fine — but flag it clearly inline in the
   draft (e.g. "🚩 assumption, not confirmed") rather than presenting a guess as
   settled fact.

4. **Write the file.** Once every section has real content — no section left as a
   placeholder or a bare "TBD" — write the result to `specs/<kebab-case-feature>.md`,
   following the template's structure and section order exactly.

5. **Stop.** Show the user the finished spec and stop there. Do not write, edit, or
   scaffold any implementation code, migration, or test — this skill's job ends at the
   spec. Implementation only happens later, as a separate step the user explicitly
   asks for (see `.claude/rules/workflow.md`).
