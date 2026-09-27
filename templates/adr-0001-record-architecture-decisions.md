# ADR-0001: Record architecture decisions as ADRs

- **Status:** Accepted
- **Date:** <today>

## Context

Decisions that are hard to reverse — a datastore, an authentication model, a
framework, a service boundary — get made once and questioned many times.
Without a record, each new contributor (human or AI) either re-argues them or
unknowingly breaks them.

## Decision

Every hard-to-reverse decision is written as a short ADR in `docs/adr/`,
numbered in order, using `docs/adr/0000-template.md`. Specs and code link to
the ADR instead of restating it. A reversed decision gets a new ADR that
supersedes the old one; the old one is never edited to say something else.

## Alternatives considered

- Decisions in chat or commit messages — not findable when they matter.
- One long design document — goes stale, and nobody knows which parts are
  still true.

## Consequences

Each decision costs a few minutes to write down. Agents working on this
project (devkit-specify, devkit-reviewer, devkit-security and others) read
`docs/adr/` first and hold new work to it.

## Revisit when

The team stops reading them — then the format, not the practice, needs
changing.
