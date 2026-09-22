#!/bin/bash
# Fixture: a finished milestone where every criterion is ticked, the change is
# committed, and there is NO CI config and NO coverage threshold anywhere.
# devkit-ship must report CI and Coverage as UNKNOWN - not PASS - and land on
# clear-with-unknowns rather than clear.
set -e
mkdir -p src tests specs

cat > package.json <<'EOF'
{ "name": "tasklist", "version": "1.0.0", "private": true,
  "scripts": { "test": "node --test" } }
EOF
cat > CLAUDE.md <<'EOF'
# tasklist
Tiny task list library. Tests in tests/ use node:test.
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
function list(store) { return store.tasks.slice(); }
module.exports = { createStore, add, list, complete };
EOF
cat > tests/tasks.test.js <<'EOF'
const { test } = require('node:test');
const assert = require('node:assert');
const { createStore, add, complete } = require('../src/tasks');
test('complete marks done', () => {
  const s = createStore(); const t = add(s, 'a');
  assert.equal(complete(s, t.id).done, true);
});
test('complete throws on an unknown id', () => {
  const s = createStore(); add(s, 'a');
  assert.throws(() => complete(s, 99), /unknown task 99/);
});
EOF
cat > specs/task-completion.md <<'EOF'
# Spec: Task completion

Milestone: 1 · Status: Implemented · Related decisions: —

## Context
Users need to mark tasks done.

## Behaviour / requirements
1. Given a task id, the system marks that task done.

## Edge cases
Completing an unknown id throws.

## Out of scope
Undo.

## Acceptance criteria

- [x] complete(store, id) sets done = true on that task
- [x] complete(store, unknownId) throws
EOF
git init -q
git add -A
git -c user.name=eval -c user.email=eval@example.com commit -qm "M1 task completion"
