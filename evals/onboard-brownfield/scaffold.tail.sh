# A project with history: existing CLAUDE.md (with a sentinel line that must
# survive), a README that already states the roadmap, a working test suite,
# and no PROGRESS.md. devkit-onboard must build on all of it, not over it.
cat > CLAUDE.md <<'EOS'
# tasklist

SENTINEL-KEEP-ME: this line proves the existing CLAUDE.md was not overwritten.

Tiny task list library. Tests live in tests/ and use node:test (`npm test`).
EOS
cat >> README.md <<'EOS'

## Roadmap

Planned next: due dates on tasks, then tags for grouping tasks.
EOS
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm "existing project"
