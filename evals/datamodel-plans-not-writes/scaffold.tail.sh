# A project with a real migration convention - numbered SQL files under
# db/migrations applied in order by src/db.js - and a spec that adds a
# nullable column to a table that already has rows in production. The plan
# has to say how existing rows get their value and how to back out.
mkdir -p db/migrations
cat > db/migrations/0001_create_tasks.sql <<'EOS'
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT NULL
);
EOS
cat > src/db.js <<'EOS'
// Applies db/migrations/*.sql in filename order. Production runs this on
// deploy; the test suite builds its schema by calling the same function
// against an in-memory table list, so a missing migration file is a
// production-only failure.
const fs = require('fs');
const path = require('path');
function migrations() {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
}
module.exports = { migrations };
EOS
cat >> CLAUDE.md <<'EOS'

## Schema

Schema changes are numbered SQL files in db/migrations/, applied in order by
src/db.js on deploy. Never edit an applied migration; add a new one. The
tasks table has ~2M rows in production.
EOS
cat > specs/task-archiving.md <<'EOS'
# Spec: Task archiving

Milestone: 1 · Status: Approved · Related decisions: —

## Context

Done tasks clutter every list forever. Users want them out of the way
without deleting them.

## Behaviour / requirements

1. A task gains an `archived_at` timestamp, null until archived.
2. Every task that was completed more than 30 days before this ships is
   archived automatically on release, so existing users see the benefit
   immediately.
3. Listing excludes archived tasks by default.

## Out of scope

Un-archiving.

## Acceptance criteria

- [ ] archive(store, id) sets archived_at on a done task
- [ ] list(store) excludes archived tasks
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm "M0"
