# An existing component library and token file. devkit-ux must find and reuse
# these rather than inventing new colours or components, and must specify the
# non-happy-path states.
mkdir -p src/components
cat > src/tokens.css <<'EOS'
:root {
  --color-primary: #2563eb;
  --color-danger: #dc2626;
  --color-text: #111827;
  --color-muted: #6b7280;
  --space-2: 8px;
  --space-4: 16px;
  --radius: 6px;
}
EOS
cat > src/components/Button.jsx <<'EOS'
export function Button({ variant = 'primary', children, ...rest }) {
  return <button className={'btn btn-' + variant} {...rest}>{children}</button>;
}
EOS
cat > src/components/EmptyState.jsx <<'EOS'
export function EmptyState({ title, action }) {
  return <div className="empty-state"><h2>{title}</h2>{action}</div>;
}
EOS
cat > specs/task-list-view.md <<'EOS'
# Spec: Task list view

Milestone: 3 · Status: Approved · Related decisions: —

## Context
The library has no UI. Users need a page that shows their tasks and lets them add one and mark one done.

## Behaviour / requirements
1. The page lists the user's tasks with title and done state.
2. A form at the top adds a task by title.
3. Each task has a control to mark it done.
4. 🔒 SENSITIVE: Only the signed-in user's tasks are shown; another user's tasks are never rendered.

## Edge cases
Empty title submit. Very long titles. Many tasks.

## Out of scope
Editing a task's title.

## Acceptance criteria

- [ ] Renders each task's title and done state
- [ ] Submitting the form with a title adds a task to the list
- [ ] Marking a task done updates its state in the list
- [ ] Tasks belonging to another user are never rendered
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm baseline
