---
type: regex
target: { source: file, path: '.git/logs/HEAD' }
pattern: '\tcommit: '
match: not_contains
---
