---
type: regex
pattern: '## Acceptance criteria[\s\S]*- \[ \]'
target: { source: file, path: 'specs/*verif*.md' }
---
