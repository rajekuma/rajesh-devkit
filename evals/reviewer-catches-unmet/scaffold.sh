#!/bin/bash
# Fixture: a spec with three criteria. The working-tree change implements
# two of them. The third is BOTH ticked in Acceptance criteria AND listed in
# Tracked follow-ups - counted as done and deferred at once, which the
# reviewer must call out as needs-changes.
set -e

mkdir -p src tests specs

cat > package.json <<'EOF'
{ "name": "tasklist", "version": "1.0.0", "private": true,
  "scripts": { "test": "node --test" } }
EOF

cat > CLAUDE.md <<'EOF'
# tasklist
Tiny task list library. Tests live in tests/ and use node:test. Every
behaviour change lands with a test first (RED), then the implementation (GREEN).
EOF

cat > src/tasks.js <<'EOF'
function createStore() { return { tasks: [] }; }
function add(store, title) {
  const task = { id: store.tasks.length + 1, title, done: false };
  store.tasks.push(task);
  return task;
}
function list(store) { return store.tasks.slice(); }
module.exports = { createStore, add, list };
EOF

cat > tests/tasks.test.js <<'EOF'
const { test } = require('node:test');
const assert = require('node:assert');
const { createStore, add, list } = require('../src/tasks');
test('add returns the task and list shows it', () => {
  const s = createStore();
  const t = add(s, 'buy milk');
  assert.equal(t.title, 'buy milk');
  assert.equal(list(s).length, 1);
});
EOF

git init -q
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -qm "baseline"

# The change under review: implements criteria 1 and 2. Criterion 3 (archive)
# is not implemented anywhere.
cat > specs/task-completion.md <<'EOF'
# Spec: Task completion

Milestone: 1 · Status: Approved · Related decisions: —

## Context

Users need to mark tasks done and see only what's left.

## Behaviour / requirements

1. Given a task id, the system marks that task done.
2. Listing supports a filter that returns only tasks not yet done.
3. A done task can be archived, removing it from every listing.

## Edge cases

Completing an unknown id throws.

## Out of scope

Undo.

## Acceptance criteria

- [x] complete(store, id) sets done = true on that task
- [x] list(store, { open: true }) returns only tasks with done = false
- [x] archive(store, id) removes a done task from list() results
EOF

# The follow-up lives in PROGRESS.md's table, not the spec - a follow-up has
# to stay visible after the spec ships, and a shipped spec is a document
# nobody re-opens. Milestone 1 is marked done so findNextMilestone returns
# nothing and the Stop hook stays quiet; this fixture is about the reviewer.
cat > PROGRESS.md <<'EOF'
# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Task completion | ✅ |

## Tracked follow-ups

| Item | Status | Source | Notes |
|---|---|---|---|
| archive(store, id) removes a done task from list() results | ⬜ | [specs/task-completion.md](specs/task-completion.md) | Deferred 2026-09-17 during M1 - Task completion. Why: archive storage format not decided yet. Unblocks when: ADR on persistence lands. |
EOF

cat > src/tasks.js <<'EOF'
function createStore() { return { tasks: [] }; }
function add(store, title) {
  const task = { id: store.tasks.length + 1, title, done: false };
  store.tasks.push(task);
  return task;
}
function complete(store, id) {
  const t = store.tasks.find(x => x.id === id);
  if (!t) throw new Error('unknown task ' + id);
  t.done = true;
  return t;
}
function list(store, opts) {
  const all = store.tasks.slice();
  if (opts && opts.open) return all.filter(t => !t.done);
  return all;
}
module.exports = { createStore, add, list, complete };
EOF

cat > tests/completion.test.js <<'EOF'
const { test } = require('node:test');
const assert = require('node:assert');
const { createStore, add, list, complete } = require('../src/tasks');
test('complete marks done', () => {
  const s = createStore(); const t = add(s, 'a');
  assert.equal(complete(s, t.id).done, true);
});
test('list open filters done tasks', () => {
  const s = createStore(); const t = add(s, 'a'); add(s, 'b');
  complete(s, t.id);
  assert.equal(list(s, { open: true }).length, 1);
});
EOF
