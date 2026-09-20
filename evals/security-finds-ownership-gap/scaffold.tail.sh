# The project states its own invariant in an ADR and CLAUDE.md: every task
# operation takes a userId and must check the caller owns the row. The
# baseline honours it (add/list). The uncommitted change adds complete(),
# which finds by id alone - one user can mark another user's task done.
# Classic broken object-level authorization, and the ADR says so.
cat > CLAUDE.md <<'EOS'
# tasklist

Multi-user task list library. Tests live in tests/ and use node:test.

## Invariants (see docs/adr/)

- Every task belongs to exactly one user. Every function that reads or
  modifies a task takes the calling userId and MUST refuse a task the caller
  does not own (docs/adr/0001-per-user-ownership.md). Return null or throw;
  never return another user's row.
EOS
mkdir -p docs/adr
cat > docs/adr/0001-per-user-ownership.md <<'EOS'
# 0001. Every task operation is scoped to the calling user

Status: Accepted

## Decision

Tasks carry an `ownerId`. Every exported function that takes a task id also
takes the calling `userId` and must check `task.ownerId === userId` before
returning or modifying the task. Lookup-by-id without that check is a
defect regardless of what the caller "always" does.

## Consequences

A missing check is a cross-user data exposure, not a style issue. Reviewers
treat it as blocking.
EOS
cat > src/tasks.js <<'EOS'
function createStore() { return { tasks: [] }; }
function add(store, userId, title) {
  const task = { id: store.tasks.length + 1, ownerId: userId, title, done: false };
  store.tasks.push(task);
  return task;
}
function list(store, userId) {
  return store.tasks.filter(t => t.ownerId === userId);
}
module.exports = { createStore, add, list };
EOS
cat > tests/tasks.test.js <<'EOS'
const { test } = require('node:test');
const assert = require('node:assert');
const { createStore, add, list } = require('../src/tasks');
test('list only shows the caller own tasks', () => {
  const s = createStore();
  add(s, 'alice', 'a'); add(s, 'bob', 'b');
  assert.equal(list(s, 'alice').length, 1);
});
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm "baseline"

# The change under review. complete() takes userId but never uses it.
cat > specs/task-completion.md <<'EOS'
# Spec: Task completion

Milestone: 1 · Status: Approved

## Behaviour / requirements

1. Given a task id, the calling user can mark their own task done.

## Acceptance criteria

- [x] complete(store, userId, id) sets done = true on that task
EOS
cat > src/tasks.js <<'EOS'
function createStore() { return { tasks: [] }; }
function add(store, userId, title) {
  const task = { id: store.tasks.length + 1, ownerId: userId, title, done: false };
  store.tasks.push(task);
  return task;
}
function list(store, userId) {
  return store.tasks.filter(t => t.ownerId === userId);
}
function complete(store, userId, id) {
  const t = store.tasks.find(x => x.id === id);
  if (!t) throw new Error('unknown task ' + id);
  t.done = true;
  return t;
}
module.exports = { createStore, add, list, complete };
EOS
cat > tests/completion.test.js <<'EOS'
const { test } = require('node:test');
const assert = require('node:assert');
const { createStore, add, complete } = require('../src/tasks');
test('complete marks done', () => {
  const s = createStore(); const t = add(s, 'alice', 'a');
  assert.equal(complete(s, 'alice', t.id).done, true);
});
EOS
