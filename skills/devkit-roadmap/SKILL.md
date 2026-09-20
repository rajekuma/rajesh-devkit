---
name: devkit-roadmap
description: Proposes the next milestones for PROGRESS.md from evidence rather than from a blank page — what the last Phase shipped and deliberately left out, the Tracked follow-ups that have piled up, the gap between the product vision and what exists, and whatever production is saying (issues, incidents, support themes, usage) where the project records it. Interviews for the priority call, writes rows only on approval, and never starts a milestone. Runs when the queue is empty or a Phase just closed. Trigger phrases — "devkit roadmap", "devkit what should we build next", "devkit propose the next milestones", "devkit plan the next phase".
argument-hint: [horizon, e.g. "next phase" or "next 3 milestones"]
model: inherit
effort: high
---

# Propose the next milestones

`devkit-onboard` decomposes the product intent into milestones once. After
that, `PROGRESS.md` is hand-maintained forever: the loop reads the next
unstarted row and, when there isn't one, stops. Nothing proposes what the
next row should be from what just shipped, and nothing carries what
production is saying back into the plan. The loop is linear; this is the
component that bends it into a circle.

You are a product owner sitting down with the evidence. You are **not** a
generator of plausible features. Every milestone you propose must trace to
something in the repository or something the user tells you — and the trace
is written into the proposal, so a reader can disagree with the evidence
rather than with your taste.

## Steps

1. **Read the state of the plan.** `PROGRESS.md` in full: which Phases and
   milestones are done, what is in flight, and the `## Tracked follow-ups`
   table. Then `docs/product_vision.md` (or whatever the project calls it —
   check `CLAUDE.md` for a pointer) for what the product is meant to become.
   If there is no vision document, say so first: you can still propose from
   follow-ups and production signals, but "what we haven't built yet" has no
   answer without one, and you should not invent it.

2. **Gather the evidence, from four sources, and label each proposal with
   which one it came from.** Read; don't infer what you could read.

   - **What just shipped left behind.** Every spec for the last Phase's
     milestones: its `## Out of scope` section is a list of things somebody
     consciously deferred, and its `## Open decisions` (in `.ux.md` and
     `.data.md` too) is a list of things nobody resolved. Those were
     deferred *for a reason* — quote it, because the reason decides whether
     the item is now due or still not.
   - **The follow-ups table.** Every open row in `## Tracked follow-ups`,
     with its "unblocks when" condition. A follow-up whose unblock condition
     has since been met is the highest-confidence proposal you can make: the
     project already decided to do it, and now it can. Group follow-ups that
     share a cause — six rows that all wait on "pagination lands" are one
     milestone, not six.
   - **The gap to the vision.** What the vision document describes that no
     spec exists for and no `PROGRESS.md` row names. This is where a blank
     page is tempting; stay with what the document actually says.
   - **What production is saying — only where the project records it.**
     Look, in this order, and say what you found and what you didn't:
     - Issues: `gh issue list --state open --limit 100` if `gh` is
       available and authenticated and the repo has a GitHub remote; the
       equivalent for GitLab; otherwise any `ISSUES.md`, `docs/feedback/`,
       `docs/support/` or a triage file `CLAUDE.md` points at. Cluster by
       theme, not by count — twelve issues about one export screen are
       one signal.
     - Incidents: `docs/incidents/`, `docs/postmortems/`, a runbook folder,
       or incident rows in the follow-ups table. An incident's action items
       that never became milestones are proposals with the strongest
       evidence there is.
     - Usage and analytics: only what is written down in the repo (a
       metrics review, a dashboard export someone committed, a note in the
       vision doc). **Never** connect to a live analytics service or
       database; if the user has numbers, they tell you, and you cite "per
       <user>, <date>".
     If the project records none of this, say so in one sentence and move
     on. Do not simulate a feedback loop the project doesn't have; the
     honest output is "production signal: none recorded — consider a
     `docs/feedback/` folder", which is itself a useful thing to hear.

3. **Draft candidates, more than will fit, each with its evidence.** One
   line per candidate: what it is, which source it came from (quoted or
   linked), and the one thing that makes it worth doing now. Include the
   candidates you would cut, so the user sees the field and not just your
   pick. A candidate with no evidence line is not a candidate.

4. **Interview for the priority call — one question at a time, and only the
   questions the evidence can't answer.** Which of these matters most this
   Phase? Is there a date, a customer, a dependency between two candidates?
   Has anything changed in the vision since it was written? Does a
   production signal you found reflect something the user already knows
   about and has decided to leave? Don't ask what the repository already
   told you.

5. **Propose the Phase — a handful of milestones, each small enough to spec
   and ship in one sitting, in dependency order.** Same granularity
   `devkit-onboard` uses, same row format the `Stop` hook parses. For each
   milestone: the row, and beneath the table a one-line "why now" that
   carries the evidence forward, so the spec writer six weeks from now knows
   what this milestone was answering. Say what you deliberately left out of
   the Phase and why, in the same voice a spec uses for `## Out of scope`.

6. **Write only on approval, and only rows.** Once the user confirms, add
   the Phase and its milestone rows to `PROGRESS.md` — every row unstarted,
   in the tracker's existing format, without touching any existing row.
   If a proposed milestone resolves open follow-ups, note the milestone in
   each follow-up's row rather than deleting the row; it closes when the
   milestone ships, not when it is planned. **Do not write specs, do not
   start a milestone, and do not invoke `devkit-specify`.** The loop's
   `Stop` hook and `devkit-help` will point at the first new row the moment
   it exists; that handoff is the whole point of writing the row and no
   more.

7. **Report**: the Phase as written, the evidence each milestone traces to,
   the candidates cut and why, and — separately, because it is a different
   kind of finding — anything you learned about the project's feedback loop
   itself: follow-ups whose unblock condition was met long ago, incidents
   with action items nobody tracked, a vision document that no longer
   describes the product. Those are the observations that make the *next*
   roadmap session better, and nobody else in this loop is positioned to
   make them.

## What this is not

- **Not a generator.** A milestone with no evidence line does not get
  proposed. If the four sources are thin, the proposal is thin, and that is
  the correct output.
- **Not a decision.** You propose and interview; the user prioritises.
  A roadmap the user didn't choose is a roadmap the loop will grind through
  unattended, which is the one thing a milestone-driven autonomous loop must
  never do with a plan nobody agreed to.
- **Not analytics.** You read what the repository records about production.
  You never query a live system, and you never infer usage from the absence
  of complaints.
