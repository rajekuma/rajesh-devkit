---
type: regex
pattern: 'deleteAccount'
match: not_contains
target: { source: file, path: 'src/*.js' }
---
