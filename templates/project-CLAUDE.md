# CLAUDE.md

<!-- Loaded into every Claude Code session in this project. Keep it under ~200
lines: longer files are followed less, not just billed more. Put detail in
the files listed under "Where the detail lives"; keep only what applies to
every session here. HTML comments like this one are stripped before Claude
sees the file, so they cost no tokens. -->

<One or two sentences: what this project is and who it's for. The full
intent lives in docs/product_vision.md.>

## Common commands

```bash
# <install / restore dependencies>
# <run the app locally>
# <run the tests>          e.g. npm test | pytest | dotnet test | go test ./...
# <run the linter/formatter>
```

## Always-true rules

<!-- One line each. Add a rule the moment Claude gets something wrong that a
rule would have prevented; delete rules that stop being true. -->

- Write the failing test first; change behaviour only with a test that proved it was missing.
- Never commit secrets, keys or real personal data.
- Run one test process at a time unless the suite is proven safe to run in parallel.
- Record hard-to-reverse decisions as an ADR in docs/adr/ before building on them.

## Where the detail lives

| What | Where |
|---|---|
| Product intent — who, why, what it isn't | docs/product_vision.md |
| Milestones and what's in flight | PROGRESS.md |
| Feature specs | specs/ (format: specs/_template.md) |
| Architecture decisions | docs/adr/ |
| Testing, architecture, conventions, workflow rules | .claude/rules/ |
