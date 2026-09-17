# A CLI whose --port flag was just renamed to --listen in code. README still
# documents --port; CHANGELOG has an empty [Unreleased]. devkit-docs must
# record the change AND fix the README it falsified.
cat > src/cli.js <<'EOS'
#!/usr/bin/env node
// tasklist CLI. Usage: node src/cli.js serve --port 3000
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 3000;
console.log('serving on port ' + port);
EOS
cat >> README.md <<'EOS'

## CLI

Start the local server:

```bash
node src/cli.js serve --port 3000
```

The `--port` flag sets the listening port (default 3000).
EOS
cat > CHANGELOG.md <<'EOS'
# Changelog

All notable changes to this project will be documented in this file.
The format is based on Keep a Changelog.

## [Unreleased]

## [1.0.0] - 2026-09-01

### Added
- Initial in-memory task store with add and list.
EOS
cat > specs/rename-port-flag.md <<'EOS'
# Spec: Rename --port to --listen

Milestone: 4 · Status: Implemented · Related decisions: —

## Context
`--port` is misleading now that the flag will soon accept host:port.

## Behaviour / requirements
1. 🔒 SENSITIVE: The CLI accepts `--listen <port>`; `--port` is removed (backward-compatibility break).

## Edge cases
Missing value.

## Out of scope
host:port parsing (next milestone).

## Acceptance criteria

- [x] `node src/cli.js serve --listen 4000` serves on 4000
- [x] `--port` is no longer recognised
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm baseline

# The shipped change, left uncommitted: the rename in code only.
cat > src/cli.js <<'EOS'
#!/usr/bin/env node
// tasklist CLI. Usage: node src/cli.js serve --listen 3000
const args = process.argv.slice(2);
const idx = args.indexOf('--listen');
const port = idx >= 0 ? Number(args[idx + 1]) : 3000;
console.log('serving on port ' + port);
EOS
