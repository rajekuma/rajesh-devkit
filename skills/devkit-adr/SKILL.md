---
name: devkit-adr
description: Writes an architecture decision record for a decision that's actually being made — detects the project's existing ADR convention and numbering, interviews for the alternatives and consequences that can't be inferred, and writes docs/adr/<NNNN>-<kebab-title>.md. Closes the gap where devkit-specify reads decision records but nothing ever writes one. Trigger phrases — "write an ADR", "record this decision", "adr for <decision>", "document why we chose".
argument-hint: <decision>
model: fable
effort: high
---

# Record an architecture decision

Record the decision: $ARGUMENTS

If no decision was given as an argument, ask what decision to record before
doing anything else. Do not scan the codebase hunting for something that
looks decision-shaped — an ADR nobody asked for documents a choice nobody
made.

## First, check this is actually an ADR

An ADR records a decision that is **consequential and hard to reverse**, and
whose *reasoning* would otherwise be lost — the thing a future reader needs
when they're about to undo it without knowing why it's there.

Write one for: a datastore or framework choice, an auth mechanism, a
public-API or schema contract, a deliberate consistency/performance
trade-off, a significant dependency, a boundary between services or modules,
a convention every future feature must follow.

Don't write one for: something already obvious from the code, a decision with
no real alternative, a reversible implementation detail, or a preference with
no consequences. If what you've been handed is one of those, say so in one
line and suggest where it does belong (a code comment, `CLAUDE.md`, the
spec's own Context section). A folder of ADRs recording non-decisions is
worse than an empty one — it teaches people the folder isn't worth reading.

Superseding an earlier ADR is always worth recording, even when the new
decision looks obvious in hindsight.

## Steps

1. **Learn the project's existing convention before writing anything.** Look
   for the decision-record folder rather than assuming one: `docs/adr/`,
   `docs/decisions/`, `docs/architecture/decisions/`, `doc/adr/`, or a single
   `docs/decision_log.md`. If one exists, **read the two or three most recent
   records in full** and match what you find — numbering scheme (`0001-`,
   `001-`, `ADR-001-`, dates), section headings, whether a status line is
   used, tone and typical length. An ADR that doesn't look like its
   neighbours is friction for every future reader.

   Only if no convention exists at all: create `docs/adr/`, number from
   `0001`, and use the template below. Mention that you're establishing the
   convention, so it's a visible choice rather than an accident.

2. **Read the reality the decision applies to.** Find the code, config, or
   dependency the decision concerns. Read the relevant feature spec in
   `specs/` if one exists, and any ADR this one might supersede or contradict.
   An ADR written without reading what's already there will confidently
   contradict a decision made six months ago.

3. **Interview for what you cannot infer, one question at a time.** These are
   the parts that carry the entire value of the record, and they are almost
   never inferable from the code:
   - **The alternatives actually considered, and why each was rejected.** An
     ADR listing one option isn't a decision record, it's an announcement.
     If the user hasn't mentioned alternatives, ask — there were always
     some, even if one was "keep doing what we do now."
   - **The forces in tension** — the constraint, deadline, team-skill, cost
     or compliance pressure that made this a real trade-off.
   - **The consequences accepted**, including the negative ones. An ADR with
     only upside is a sales pitch. What gets harder because of this?
   - **What would make us revisit this** — the condition under which the
     decision stops being right.

   Ask one question at a time and wait for the answer. Don't fill these in
   with plausible-sounding reasoning of your own: an invented rationale is
   worse than a blank, because it will be believed and quoted back years
   later by someone who assumes a human wrote it.

4. **Write the record** to `docs/adr/<NNNN>-<kebab-case-title>.md`, matching
   the project's convention from step 1, or this fallback if there is none:

   ```markdown
   # <NNNN>. <Short decision title, stated as the decision itself>

   Date: <YYYY-MM-DD> · Status: Accepted
   <if applicable: Supersedes / Superseded by: <NNNN>>

   ## Context

   The forces at play: the problem, the constraints, what's already true in
   this codebase that shapes the answer. Written so someone with no memory of
   this conversation can follow it. State facts and pressures here, not the
   decision.

   ## Decision

   What was decided, in the active voice — "We will use X for Y." One
   paragraph. This is the part people quote.

   ## Alternatives considered

   Each real option, and the specific reason it lost. Not strawmen: if an
   alternative was genuinely close, say so, because that's exactly what a
   future reader revisiting this needs to know.

   ## Consequences

   What becomes easier, what becomes harder, and what the team is now
   committed to. Include the costs — a record with no downsides listed reads
   as unexamined.

   ## Revisit when

   The concrete condition that would make this decision worth reopening.
   ```

5. **Link it in both directions.** If this decision came out of a feature
   spec, add it to that spec's `Related decisions:` header field. If it
   supersedes an earlier ADR, edit that ADR's status line to point here —
   a superseded record left looking current is actively misleading, and
   `devkit-specify` reads these before writing new specs.

6. **Stop there.** Do not implement the decision, refactor toward it, or
   scaffold anything. Recording a decision and acting on it are separate
   steps, and the record should be reviewable before any code moves.
