# One workflow, tests only. A real dependency in package.json so "no
# dependency scan" is a gap with consequences rather than a theoretical one.
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOS'
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
EOS
node -e "
const p = require('./package.json');
p.dependencies = { 'lodash': '4.17.20' };
require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));
"
git init -q && git add -A && git -c user.name=eval -c user.email=eval@example.com commit -qm "M1"
