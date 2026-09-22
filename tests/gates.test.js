'use strict';

// Gate verdicts go stale when the tree changes under them. In the M28 run
// three gates passed, two of quality's findings were applied, and all three
// verdicts were still treated as current on the way to ship. These run
// record-gate.js and continue-loop.js as real processes against real git
// repositories, because the fingerprint IS git's view of the tree and a
// mocked one would prove nothing about it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, SAMPLE_PROGRESS, newFixture, removeFixture, runHook, read } = require('./helpers');

const RECORD = path.join(PLUGIN_ROOT, 'scripts', 'record-gate.js');

const READY_SPEC =
  '# Spec: User login\n\nMilestone: 1\n\n## Acceptance criteria\n\n- [x] It works\n';

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function withRepo(opts, fn) {
  const dir = newFixture({
    progress: SAMPLE_PROGRESS,
    specs: { 'user-login.md': READY_SPEC, 'user-login.ux.md': '# UX\n' },
    ...opts,
    files: { 'src/app.js': 'module.exports = 1;\n', ...(opts.files ?? {}) },
  });
  try {
    if (opts.git !== false) {
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'test@example.com');
      git(dir, 'config', 'user.name', 'test');
      git(dir, 'config', 'core.autocrlf', 'false');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'init');
    }
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

function gate(dir, ...args) {
  const r = spawnSync(process.execPath, [RECORD, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function checkJson(dir) {
  const r = gate(dir, 'check', '--json');
  return { exitCode: r.exitCode, ...JSON.parse(r.stdout) };
}

function stateOf(result, name) {
  const row = result.results.find((r) => r.gate === name);
  return row ? row.state : null;
}

test('a verdict recorded against the current tree reads as fresh', () => {
  withRepo({}, (dir) => {
    assert.strictEqual(gate(dir, 'review', 'ship').exitCode, 0);
    const c = checkJson(dir);
    assert.strictEqual(stateOf(c, 'review'), 'fresh');
    assert.strictEqual(c.exitCode, 0);
  });
});

test('applying a fix after the gate makes its verdict stale', () => {
  // The M28 shape exactly: gates pass, a finding is applied, the verdicts
  // must stop vouching for the code.
  withRepo({}, (dir) => {
    gate(dir, 'review', 'ship');
    gate(dir, 'quality', 'clean');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n', 'utf8');
    const c = checkJson(dir);
    assert.strictEqual(stateOf(c, 'review'), 'stale');
    assert.strictEqual(stateOf(c, 'quality'), 'stale');
    assert.notStrictEqual(c.exitCode, 0, 'a stale verdict must not read as success');
  });
});

test('a new untracked file counts as a change, not just edits to tracked ones', () => {
  withRepo({}, (dir) => {
    gate(dir, 'security', 'clear');
    fs.writeFileSync(path.join(dir, 'src', 'extra.js'), 'module.exports = 3;\n', 'utf8');
    assert.strictEqual(stateOf(checkJson(dir), 'security'), 'stale');
  });
});

test('a verdict re-recorded after the fix is fresh again', () => {
  withRepo({}, (dir) => {
    gate(dir, 'review', 'ship');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n', 'utf8');
    gate(dir, 'review', 'ship');
    assert.strictEqual(stateOf(checkJson(dir), 'review'), 'fresh');
  });
});

test('outside a git repository no verdict can ever read as fresh', () => {
  // Fail-safe is the whole constraint: unknown provenance is stale, never a
  // pass. A mechanism that assumed freshness here would manufacture exactly
  // the confidence it exists to remove.
  withRepo({ git: false }, (dir) => {
    const r = gate(dir, 'review', 'ship');
    assert.strictEqual(r.exitCode, 0, 'recording should still succeed');
    assert.match(r.stdout, /STALE/, 'should warn the stamp is unprovable');
    const c = checkJson(dir);
    assert.strictEqual(stateOf(c, 'review'), 'stale');
    assert.notStrictEqual(c.exitCode, 0);
  });
});

test('a verdict recorded for another milestone does not carry over', () => {
  withRepo({}, (dir) => {
    gate(dir, 'review', 'ship');
    const file = path.join(dir, '.claude', 'rajesh-devkit', 'gates.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.gates.review.milestone = 'M0 - Something earlier';
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
    assert.strictEqual(stateOf(checkJson(dir), 'review'), 'stale');
  });
});

test('nothing recorded is not a success', () => {
  withRepo({}, (dir) => {
    const c = checkJson(dir);
    assert.deepStrictEqual(c.results, []);
    assert.notStrictEqual(c.exitCode, 0);
  });
});

test('the first record does not make itself stale by writing the gitignore line', () => {
  // Recording creates .gitignore's state-directory line on a project's first
  // use. Fingerprinting before that write would stamp a tree the act of
  // recording immediately changed.
  withRepo({}, (dir) => {
    assert.strictEqual(read(dir, '.gitignore'), null, 'fixture should start without one');
    gate(dir, 'review', 'ship');
    assert.strictEqual(stateOf(checkJson(dir), 'review'), 'fresh');
  });
});

test('fingerprinting never disturbs what the user has staged', () => {
  withRepo({}, (dir) => {
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src', 'other.js'), 'x\n', 'utf8');
    git(dir, 'add', 'src/app.js');
    // The staged set, not `git status`: the first record legitimately adds
    // .gitignore's state-directory line, which is an untracked change.
    const before = git(dir, 'diff', '--cached', '--name-only');
    gate(dir, 'review', 'ship');
    gate(dir, 'check');
    assert.strictEqual(git(dir, 'diff', '--cached', '--name-only'), before);
    assert.strictEqual(before, 'src/app.js');
  });
});

test('a corrupt gate record reads as nothing recorded, not a crash', () => {
  withRepo({}, (dir) => {
    const stateDir = path.join(dir, '.claude', 'rajesh-devkit');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'gates.json'), '{ nope', 'utf8');
    const c = checkJson(dir);
    assert.deepStrictEqual(c.results, []);
  });
});

test('an unknown gate is refused, and the agent name is accepted as an alias', () => {
  withRepo({}, (dir) => {
    assert.strictEqual(gate(dir, 'vibes', 'good').exitCode, 1);
    assert.strictEqual(gate(dir, 'devkit-reviewer', 'ship').exitCode, 0);
    assert.strictEqual(stateOf(checkJson(dir), 'review'), 'fresh');
  });
});

// ---------------------------------------------------------------------------
// The Stop hook: the half that needs nobody to remember anything.
// ---------------------------------------------------------------------------

test('the Stop hook names a recorded verdict that went stale', () => {
  withRepo({}, (dir) => {
    gate(dir, 'quality', 'clean');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'module.exports = 2;\n', 'utf8');
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /STALE/);
    assert.match(r.stderr, /quality \(clean\)/);
  });
});

test('the Stop hook says nothing about a verdict that is still fresh', () => {
  withRepo({}, (dir) => {
    gate(dir, 'quality', 'clean');
    const r = runHook('continue-loop.js', dir);
    assert.doesNotMatch(r.stderr, /verdicts recorded for this milestone/);
  });
});

test('the chain says what happens after a gate finding is applied', () => {
  // downstream() implied gate -> gate -> ship, one way. That implication WAS
  // the bug. The instruction has to say that acting on a finding sends the
  // loop back through the gates, and it has to name a command that exists.
  withRepo({}, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.match(r.stderr, /re-run those gates/);
    const cmd = r.stderr.match(/node "([^"]+record-gate\.js)"/);
    assert.ok(cmd, `no runnable record-gate command in: ${r.stderr}`);
    assert.ok(fs.existsSync(cmd[1]), `named a record-gate path that does not exist: ${cmd[1]}`);
  });
});

test('a loop with no gate stages is never told to stamp verdicts', () => {
  const dir = newFixture({
    progress: SAMPLE_PROGRESS,
    specs: { 'user-login.md': READY_SPEC },
    files: { '.claude/devkit.json': JSON.stringify({ stages: ['specify', 'implement', 'docs'] }) },
  });
  try {
    const r = runHook('continue-loop.js', dir);
    assert.doesNotMatch(r.stderr, /record-gate/);
  } finally {
    removeFixture(dir);
  }
});
