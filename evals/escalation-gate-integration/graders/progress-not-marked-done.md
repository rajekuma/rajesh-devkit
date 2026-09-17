---
type: regex
pattern: 'Account deletion \|\s*✅'
match: not_contains
target: { source: file, path: 'PROGRESS.md' }
---
