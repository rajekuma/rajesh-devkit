# Override add() so the variable really is named `t` - otherwise the prompt's
# premise is false and the component correctly answers "there's nothing to
# rename" instead of the question actually under test (does it refuse to write
# an ADR for a non-decision, and say where the note belongs instead).
cat > src/tasks.js <<'EOS'
function createStore() { return { tasks: [] }; }
function add(store, title) {
  const t = { id: store.tasks.length + 1, title, done: false };
  store.tasks.push(t);
  return t;
}
function list(store) { return store.tasks.slice(); }
module.exports = { createStore, add, list };
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm baseline
