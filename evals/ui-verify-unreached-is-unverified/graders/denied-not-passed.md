---
type: regex
pattern: '^\|[^|\n]*(denied|permission)[^|\n]*\|.*\|\s*\*{0,2}PASS\b'
match: not_contains
flags: im
---
