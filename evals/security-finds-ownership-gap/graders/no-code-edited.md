---
type: regex
target: { source: file, path: 'src/tasks.js' }
pattern: 'function complete[\s\S]*ownerId'
match: not_contains
---
