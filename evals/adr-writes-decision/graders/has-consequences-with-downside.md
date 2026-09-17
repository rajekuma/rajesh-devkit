---
type: regex
pattern: '## Consequences[\s\S]*(lost|ephemeral)'
flags: i
target: { source: file, path: 'docs/adr/*.md' }
---
