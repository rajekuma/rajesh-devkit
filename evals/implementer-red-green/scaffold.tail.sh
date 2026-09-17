cat > specs/task-priority.md <<'EOS'
# Spec: Task priority

Milestone: 2 · Status: Approved · Related decisions: —

## Context
Users want to flag some tasks as more important than others.

## Behaviour / requirements
1. Given a title and a priority of "low", "normal" or "high", add() stores that priority on the task; omitted means "normal".
2. list(store, { priority: "high" }) returns only tasks with that priority.

## Edge cases
An unknown priority string throws.

## Out of scope
Sorting by priority.

## Acceptance criteria

- [ ] add(store, title, "high") returns a task whose priority is "high"
- [ ] add(store, title) defaults priority to "normal"
- [ ] add(store, title, "urgent") throws
- [ ] list(store, { priority: "high" }) returns only high-priority tasks
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm baseline
