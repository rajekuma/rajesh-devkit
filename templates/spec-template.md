# Spec: <short feature name>

Milestone: <e.g. M3 from PROGRESS.md> · Status: Draft · Related decisions: —

<!-- devkit-specify writes specs in this shape after interviewing you. Status
moves Draft -> Approved (you) -> Implemented (when it ships); the loop never
builds from a Draft. -->

## Context

<Why this now: the problem, who hits it, constraints that shape it. Link
docs instead of repeating them.>

## Behaviour / requirements

1. <Given X, the system does Y.>
2. <Prefix a requirement with "SENSITIVE:" when it touches an existing
   invariant, a security/authorization boundary, a data-model change, an
   external integration, or backward compatibility.>

## Edge cases

<Empty, zero, boundary, concurrent, unauthorized, expired…>

## Out of scope

<What this deliberately doesn't cover, and why.>

## Observability

<Events and metrics an operator would look for, using the project's own
logging/metrics. Leave out, with a reason, if there is truly nothing to
observe.>

## Performance budget

<Only if it reads a collection, calls the network, or a user waits on it:
the volume and the latency, as numbers.>

## Acceptance criteria

<!-- One testable statement per line; mark the layer that honestly proves it
when it isn't a unit test: [integration], [contract], [e2e],
[observability], [perf]. -->

- [ ] <criterion>
- [ ] <denial / negative case>
