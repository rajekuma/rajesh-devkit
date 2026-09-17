---
type: regex
pattern: 'serve --port'
match: not_contains
target: { source: file, path: 'README.md' }
---
