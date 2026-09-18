# One criterion is unticked with no Tracked follow-ups row anywhere: not implemented,
# not deliberately deferred, just missing. devkit-ship must block.
cat > specs/task-completion.md <<'EOS'
# Spec: Task completion

Milestone: 1 · Status: Implemented · Related decisions: —

## Context
Users need to mark tasks done.

## Behaviour / requirements
1. Given a task id, the system marks that task done.
2. A done task can be archived.

## Edge cases
Completing an unknown id throws.

## Out of scope
Undo.

## Acceptance criteria

- [x] complete(store, id) sets done = true on that task
- [ ] archive(store, id) removes a done task from list() results
EOS
cat > src/tasks.js <<'EOS'
function createStore() { return { tasks: [] }; }
function add(store, title) {
  const task = { id: store.tasks.length + 1, title, done: false };
  store.tasks.push(task); return task;
}
function complete(store, id) {
  const t = store.tasks.find(x => x.id === id);
  if (!t) throw new Error('unknown task ' + id);
  t.done = true; return t;
}
function list(store) { return store.tasks.slice(); }
module.exports = { createStore, add, list, complete };
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm "M1"
