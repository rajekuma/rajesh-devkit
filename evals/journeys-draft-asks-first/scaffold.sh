#!/bin/bash
# Fixture: a vision and a tracker, and no end-to-end command to reach for.
set -e
mkdir -p docs src
cat > docs/product_vision.md <<'VISION'
# Vision
A shared shopping list a household can edit from any phone.
VISION
cat > PROGRESS.md <<'TRACKER'
# Progress

| # | Milestone | Status |
|---|-----------|--------|
| 1 | List API | ✅ |
| 2 | Invite a household member | ⬜ |
| 3 | List screen | ⬜ |
TRACKER
echo '{ "name": "lists", "version": "1.0.0", "private": true }' > package.json
echo 'module.exports = {};' > src/lists.js
