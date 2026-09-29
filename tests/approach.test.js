'use strict';

// Whoever writes a milestone's code - devkit-implementer, or the session
// itself because the user chose that at the sensitive-milestone gate - the
// gates after it are the same, and the user's choice is followed, not
// overridden, on every later nudge. Found in real use (M35a/M35b): the
// escalation message named only the reviewer, and the ordinary nudge that
// followed told a session the user had asked to implement directly to "not do
// the implementer's work yourself".
//
// And the telemetry that makes a milestone's cost reportable is written in a
// project that hands the loop to the plugin while keeping its old loop skill.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, GLYPH, SAMPLE_PROGRESS, newFixture, removeFixture, runHook, read } = require('./helpers');

const SENSITIVE = `# Spec: User login\n\nMilestone: 1\n\n## Behaviour / requirements\n\n1. ${GLYPH.lock} SENSITIVE: touches auth\n`;
const DONE_PROGRESS = SAMPLE_PROGRESS.replace(`| 1 | User login | ${GLYPH.notStarted} |`, `| 1 | User login | ${GLYPH.done} |`);

function withFixture(opts, fn) {
  const dir = newFixture(opts);
  try {
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

function recordGate(dir, ...args) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'record-gate.js'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function writeGates(dir, milestone, names) {
  const gates = {};
  for (const g of names) gates[g] = { verdict: 'ship', milestone, tree: null, recordedAt: new Date().toISOString() };
  const stateDir = path.join(dir, '.claude', 'rajesh-devkit');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'gates.json'), JSON.stringify({ version: 1, gates }), 'utf8');
}

// ---------------------------------------------------------------------------
// The escalation carries the whole chain
// ---------------------------------------------------------------------------

test('the sensitive-milestone question carries every gate after implementation', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': SENSITIVE } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.match(r.stderr, /SENSITIVE/);
    for (const agent of ['devkit-reviewer', 'devkit-quality', 'devkit-security', 'devkit-ship', 'devkit-docs']) {
      assert.match(r.stderr, new RegExp(agent), `the escalation leaves out ${agent}`);
    }
    // Both routes are spelled out, and the answer is to be recorded.
    assert.match(r.stderr, /yourself/);
    assert.match(r.stderr, /devkit-implementer/);
    assert.match(r.stderr, /approach self/);
  });
});

test('the escalation names only the gates this project enabled', () => {
  const files = { '.claude/devkit.json': JSON.stringify({ stages: ['specify', 'implement', 'review'] }) };
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': SENSITIVE }, files }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.match(r.stderr, /devkit-reviewer/);
    assert.doesNotMatch(r.stderr, /devkit-security|devkit-ship|devkit-docs/);
  });
});

// ---------------------------------------------------------------------------
// The recorded choice is followed on every later nudge
// ---------------------------------------------------------------------------

test('after "implement it myself", later nudges keep every gate but never delegate', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': SENSITIVE } }, (dir) => {
    runHook('continue-loop.js', dir); // the question
    const rec = recordGate(dir, 'approach', 'self');
    assert.strictEqual(rec.exitCode, 0, rec.stderr);
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.doesNotMatch(r.stderr, /SENSITIVE/, 'asked again after the user answered');
    assert.match(r.stderr, /yourself/);
    assert.doesNotMatch(r.stderr, /invoking the devkit-implementer/, 'overrode the user and delegated');
    for (const agent of ['devkit-reviewer', 'devkit-quality', 'devkit-security', 'devkit-ship', 'devkit-docs']) {
      assert.match(r.stderr, new RegExp(agent), `implementing directly dropped ${agent}`);
    }
  });
});

test('a recorded choice survives a lost temp memory, so the question is not asked twice', () => {
  // The gate's "shown once" memory is in OS temp; a resume on another machine
  // loses it. The recorded approach lives in the project.
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': SENSITIVE } }, (dir) => {
    assert.strictEqual(recordGate(dir, 'approach', 'delegate').exitCode, 0);
    const r = runHook('continue-loop.js', dir);
    assert.doesNotMatch(r.stderr, /SENSITIVE/);
    assert.match(r.stderr, /invoking the devkit-implementer/);
  });
});

test('record-gate refuses an approach it does not know', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    assert.strictEqual(recordGate(dir, 'approach', 'vibes').exitCode, 1);
    assert.strictEqual(recordGate(dir, 'approach').exitCode, 1);
  });
});

// ---------------------------------------------------------------------------
// Marking a milestone done without its gates
// ---------------------------------------------------------------------------

test('a milestone marked done with gates never run is called out', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    runHook('track-milestones.js', dir); // baseline
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), DONE_PROGRESS, 'utf8');
    writeGates(dir, 'M1 - User login', ['review']);
    const r = runHook('track-milestones.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /quality/);
    assert.match(r.stderr, /security/);
    assert.match(r.stderr, /ship/);
    assert.doesNotMatch(r.stderr, /from: review/, 'named a gate that did run');
  });
});

test('a milestone marked done after every enabled gate ran passes quietly', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    runHook('track-milestones.js', dir);
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), DONE_PROGRESS, 'utf8');
    // ui-verify is enabled by default but gates a UI; a stamp stands in for it here.
    writeGates(dir, 'M1 - User login', ['ui-verify', 'review', 'quality', 'security', 'ship']);
    const r = runHook('track-milestones.js', dir);
    assert.strictEqual(r.exitCode, 0, r.stderr);
  });
});

test('a session not driving the loop is never told about gates', () => {
  // PRINCIPLES 4: a person ticking a row by hand in a session doing other
  // work is not nagged.
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    runHook('track-milestones.js', dir, JSON.stringify({ session_id: 'other-work' }));
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), DONE_PROGRESS, 'utf8');
    const r = runHook('track-milestones.js', dir, JSON.stringify({ session_id: 'other-work' }));
    assert.strictEqual(r.exitCode, 0, r.stderr);
  });
});

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

test('"loop": "devkit" records shipped milestones even with an old loop skill on disk', () => {
  const files = { '.claude/devkit.json': JSON.stringify({ loop: 'devkit' }) };
  withFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true, files }, (dir) => {
    runHook('track-milestones.js', dir, JSON.stringify({ session_id: 'x' }));
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), DONE_PROGRESS, 'utf8');
    runHook('track-milestones.js', dir, JSON.stringify({ session_id: 'x' }));
    const log = read(dir, '.claude', 'rajesh-devkit', 'telemetry.jsonl') ?? '';
    assert.match(log, /"milestone_shipped","milestone":"M1 - User login"/);
  });
});

test('the first look at a tracker records a baseline, not a ship for every done row', () => {
  withFixture({ progress: DONE_PROGRESS }, (dir) => {
    runHook('track-milestones.js', dir);
    const log = read(dir, '.claude', 'rajesh-devkit', 'telemetry.jsonl') ?? '';
    assert.doesNotMatch(log, /milestone_shipped/);
  });
});
