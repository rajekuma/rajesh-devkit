'use strict';

// The committed per-milestone records (scripts/milestone-metrics.js) and the
// transcript scan they are built on (scripts/token-report.js). Transcripts
// are faked under a throwaway home directory, laid out the way Claude Code
// lays them out, so these run offline and cost nothing.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, GLYPH, SAMPLE_PROGRESS, newFixture, removeFixture } = require('./helpers');

const DONE_PROGRESS = SAMPLE_PROGRESS.replace(`| 1 | User login | ${GLYPH.notStarted} |`, `| 1 | User login | ${GLYPH.done} |`);
const T0 = Date.parse('2026-09-28T10:00:00Z');
const at = (min) => new Date(T0 + min * 60000).toISOString();

function turn(min, model, usage) {
  return JSON.stringify({ type: 'assistant', timestamp: at(min), message: { model, usage } });
}

// A project with a tracker, telemetry for M1, and fake transcripts: the main
// session on Opus 5.5 and one reviewer subagent on a dated Haiku id.
function withProject(fn, { telemetry = true, files } = {}) {
  const dir = newFixture({ progress: SAMPLE_PROGRESS, files });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-home-'));
  try {
    const tdir = path.join(home, '.claude', 'projects', dir.replace(/[:\\/. ]/g, '-'));
    fs.mkdirSync(path.join(tdir, 'sess', 'subagents'), { recursive: true });
    const opus = { input_tokens: 1000000, output_tokens: 100000 }; // $4 + $2 = $6 a turn
    fs.writeFileSync(
      path.join(tdir, 'sess.jsonl'),
      // Turns at 0, 5 and 10 minutes, then one 3 hours later; with the
      // subagent's turn at 20 that is gaps of 5, 5, 10 and 170 - the last
      // capped at 15 - so 35 active minutes.
      [turn(0, 'claude-opus-5-5', opus), turn(5, 'claude-opus-5-5', opus), turn(10, 'claude-opus-5-5', opus), turn(190, 'claude-opus-5-5', opus)].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(tdir, 'sess', 'subagents', 'agent-r1.jsonl'),
      turn(20, 'claude-haiku-4-5-20251001', { input_tokens: 1000000, output_tokens: 0 }), // $1
      'utf8'
    );
    fs.writeFileSync(
      path.join(tdir, 'sess', 'subagents', 'agent-r1.meta.json'),
      JSON.stringify({ agentType: 'rajesh-devkit:devkit-reviewer', description: 'review' }),
      'utf8'
    );
    if (telemetry) {
      const tel = path.join(dir, '.claude', 'rajesh-devkit');
      fs.mkdirSync(tel, { recursive: true });
      fs.writeFileSync(
        path.join(tel, 'telemetry.jsonl'),
        [
          { event: 'milestone_started', milestone: 'M1 - User login (old title)', timestamp: at(-1) },
          { event: 'milestone_started', milestone: 'M1 - User login', timestamp: at(100) },
          { event: 'milestone_shipped', milestone: 'M1 - User login', timestamp: at(200) },
        ].map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf8'
      );
    }
    return fn(dir, home);
  } finally {
    removeFixture(dir);
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function run(script, dir, home, args, stdin = '{}') {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', script), ...args], {
    cwd: dir,
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, HOME: home, USERPROFILE: home },
  });
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function records(dir) {
  const text = fs.readFileSync(path.join(dir, 'docs', 'metrics', 'milestones.jsonl'), 'utf8');
  return text.trim().split('\n').map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// token-report
// ---------------------------------------------------------------------------

test('token-report prices Opus 5.5 and a dated Haiku id, and separates the main session', () => {
  withProject((dir, home) => {
    const r = run('token-report.js', dir, home, ['--project-dir', dir, '--start-time', at(-1), '--end-time', at(200)]);
    assert.strictEqual(r.exitCode, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.unknownModelTokens, 0, 'a current model went unpriced');
    assert.strictEqual(out.totalCostUsd, 25); // 4 Opus turns at $6 + $1 Haiku
    assert.strictEqual(out.mainSession.costUsd, 24);
    assert.strictEqual(out.byAgent[0].costUsd, 1);
    assert.strictEqual(out.activeMinutes, 35, 'a 3-hour pause counted as work');
  });
});

// ---------------------------------------------------------------------------
// milestone-metrics
// ---------------------------------------------------------------------------

test('a milestone is recorded from telemetry, by number, from its earliest start', () => {
  withProject((dir, home) => {
    const r = run('milestone-metrics.js', dir, home, ['record', 'M1']);
    assert.strictEqual(r.exitCode, 0, r.stderr);
    const [rec] = records(dir);
    assert.strictEqual(rec.milestone, 'M1');
    assert.strictEqual(rec.window.source, 'measured');
    assert.strictEqual(rec.window.start, at(-1), 'a renamed milestone lost its first start');
    assert.strictEqual(rec.costUsd, 25);
    assert.strictEqual(rec.primaryModel, 'claude-opus-5-5');
    assert.strictEqual(rec.subagentCostUsd, 1);
    const readme = fs.readFileSync(path.join(dir, 'docs', 'metrics', 'README.md'), 'utf8');
    assert.match(readme, /\| M1 \|/);
    assert.match(readme, /claude-opus-5-5/);
  });
});

test('recording a milestone again replaces its record', () => {
  withProject((dir, home) => {
    run('milestone-metrics.js', dir, home, ['record', 'M1']);
    run('milestone-metrics.js', dir, home, ['record', 'M1']);
    assert.strictEqual(records(dir).length, 1);
  });
});

test('a window given by hand is marked estimated, never measured', () => {
  withProject(
    (dir, home) => {
      const r = run('milestone-metrics.js', dir, home, ['record', 'M1', '--start', at(0), '--end', at(30), '--note', 'from commits']);
      assert.strictEqual(r.exitCode, 0, r.stderr);
      const [rec] = records(dir);
      assert.strictEqual(rec.window.source, 'estimated');
      assert.strictEqual(rec.window.note, 'from commits');
    },
    { telemetry: false }
  );
});

test('no window, no record - and nothing written', () => {
  withProject(
    (dir, home) => {
      const r = run('milestone-metrics.js', dir, home, ['record', 'M1']);
      assert.strictEqual(r.exitCode, 1);
      assert.ok(!fs.existsSync(path.join(dir, 'docs', 'metrics')), 'wrote a record with no window');
    },
    { telemetry: false }
  );
});

test('"metrics": false records nothing', () => {
  withProject(
    (dir, home) => {
      const r = run('milestone-metrics.js', dir, home, ['record', 'M1']);
      assert.strictEqual(r.exitCode, 0);
      assert.ok(!fs.existsSync(path.join(dir, 'docs', 'metrics')));
    },
    { files: { '.claude/devkit.json': JSON.stringify({ metrics: false }) } }
  );
});

test('marking a milestone done in a driving session records it automatically', () => {
  withProject((dir, home) => {
    run('track-milestones.js', dir, home, []); // baseline
    fs.writeFileSync(path.join(dir, 'PROGRESS.md'), DONE_PROGRESS, 'utf8');
    // The ship event is written by this same hook run, so the window closes
    // now; the fake turns all precede it.
    run('track-milestones.js', dir, home, []);
    const [rec] = records(dir);
    assert.strictEqual(rec.milestone, 'M1');
    assert.strictEqual(rec.window.source, 'measured');
  });
});

// ---------------------------------------------------------------------------
// What the user sees when a milestone, or a phase, is finished
// ---------------------------------------------------------------------------

const PHASED = [
  '# Progress',
  '',
  '## Phase 1 - Accounts',
  '',
  '| # | Milestone | Status |',
  '|---|-----------|--------|',
  `| 1 | User login | ${GLYPH.notStarted} |`,
  '',
  '## Phase 2 - Billing',
  '',
  '| # | Milestone | Status |',
  '|---|-----------|--------|',
  `| 2 | Invoices | ${GLYPH.notStarted} |`,
  '',
].join('\n');

function finishM1(dir, home, progress) {
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), progress, 'utf8');
  run('track-milestones.js', dir, home, []); // baseline
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), progress.replace(`| 1 | User login | ${GLYPH.notStarted} |`, `| 1 | User login | ${GLYPH.done} |`), 'utf8');
  return run('track-milestones.js', dir, home, []);
}

function contextOf(r) {
  // Gates missing: the stats ride along on the exit-2 message instead.
  if (r.exitCode === 2) return r.stderr;
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

test('finishing a milestone puts its receipt in front of the session and the user', () => {
  withProject((dir, home) => {
    const r = finishM1(dir, home, SAMPLE_PROGRESS);
    const text = contextOf(r);
    assert.match(text, /DevKit \| M1 User login \| done/);
    if (r.exitCode === 0) assert.match(JSON.parse(r.stdout).systemMessage, /DevKit \| M1/, 'the user is not shown it');
    assert.match(text, /\$25\.00/);
    assert.match(text, /claude-opus-5-5/);
    assert.doesNotMatch(text, /Phase .* is complete/, 'no phases in this tracker, so no phase is complete');
  });
});

test('the last milestone of a phase says to push - and never pushes', () => {
  withProject((dir, home) => {
    const text = contextOf(finishM1(dir, home, PHASED));
    assert.match(text, /Phase 1 is complete/);
    assert.match(text, /push/);
    assert.match(text, /do not run it yourself/);
    assert.doesNotMatch(text, /Phase 2/);
  });
});

test('with the deliver stage on, the phase boundary is handed to devkit-deliver', () => {
  const files = { '.claude/devkit.json': JSON.stringify({ stages: ['implement', 'deliver'] }) };
  withProject(
    (dir, home) => {
      const text = contextOf(finishM1(dir, home, PHASED));
      assert.match(text, /devkit-deliver/);
      assert.doesNotMatch(text, /do not run it yourself/);
    },
    { files }
  );
});

// ---------------------------------------------------------------------------
// The receipt says what devkit did - and only what its records show
// ---------------------------------------------------------------------------

function receiptOf(dir, home) {
  const r = run('milestone-metrics.js', dir, home, ['receipt', 'M1']);
  assert.strictEqual(r.exitCode, 0, r.stderr);
  return r.stdout;
}

test("the receipt counts the loop's nudges, its own agents, and the gates that never ran", () => {
  withProject((dir, home) => {
    const tel = path.join(dir, '.claude', 'rajesh-devkit', 'telemetry.jsonl');
    const events = [
      { event: 'loop_nudge', milestone: 'M1 - User login', timestamp: at(101), kind: 'sensitive-question' },
      { event: 'loop_nudge', milestone: 'M1 - User login', timestamp: at(120), kind: 'chain' },
      { event: 'gates_stale', milestone: 'M1 - User login', timestamp: at(150), gates: ['review (ship)'] },
      { event: 'loop_nudge', milestone: 'M2 - Password reset', timestamp: at(150), kind: 'chain' },
    ];
    fs.appendFileSync(tel, events.map((e) => `${JSON.stringify(e)}\n`).join(''), 'utf8');
    run('milestone-metrics.js', dir, home, ['record', 'M1']);
    const text = receiptOf(dir, home);
    assert.match(text, /2 stops turned into the next step/, "counted another milestone's nudge, or missed one");
    assert.match(text, /asked the sensitive-milestone question/);
    assert.match(text, /1 devkit agent run \(reviewer\)/);
    assert.match(text, /1 stale-verdict warning/);
    assert.match(text, /review: NOT RUN/, 'an enabled gate with no verdict went unmentioned');
  });
});

test('a window with no loop events says so instead of claiming the loop did nothing', () => {
  withProject((dir, home) => {
    run('milestone-metrics.js', dir, home, ['record', 'M1']);
    const text = receiptOf(dir, home);
    assert.match(text, /loop events not recorded/);
    assert.doesNotMatch(text, /0 stops/);
  });
});

// ---------------------------------------------------------------------------
// The record measures the real change, and remembers the gates of its time
// ---------------------------------------------------------------------------

function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('code committed before the row is ticked still counts toward the change', () => {
  // Found on M47b: committed five hours before the tracker was updated, and
  // recorded as 2 files, +219 lines, for a 9,008-line change.
  withProject((dir, home) => {
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'], {
      cwd: dir,
      env: { ...process.env, GIT_COMMITTER_DATE: at(-30), GIT_AUTHOR_DATE: at(-30) },
    });
    // The milestone's code, committed inside the window...
    fs.writeFileSync(path.join(dir, 'feature.js'), 'a\nb\nc\nd\n', 'utf8');
    git(dir, 'add', 'feature.js');
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'feature'], {
      cwd: dir,
      env: { ...process.env, GIT_COMMITTER_DATE: at(150), GIT_AUTHOR_DATE: at(150) },
    });
    // ...and a little left uncommitted when the row is ticked.
    fs.writeFileSync(path.join(dir, 'notes.md'), 'x\n', 'utf8');
    const r = run('milestone-metrics.js', dir, home, ['record', 'M1']);
    assert.strictEqual(r.exitCode, 0, r.stderr);
    const [rec] = records(dir);
    assert.ok(rec.diff.insertions >= 5, `committed lines were missed: ${JSON.stringify(rec.diff)}`);
    assert.match(rec.diff.source, /last commit before the start/);
  });
});

test('a receipt is judged against the gates enabled when the milestone ran', () => {
  withProject((dir, home) => {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const cfg = path.join(dir, '.claude', 'devkit.json');
    fs.writeFileSync(cfg, JSON.stringify({ stages: ['implement', 'review'] }), 'utf8');
    run('milestone-metrics.js', dir, home, ['record', 'M1']);
    // Later, ui-verify is switched on for another milestone.
    fs.writeFileSync(cfg, JSON.stringify({ stages: ['implement', 'ui-verify', 'review'] }), 'utf8');
    const text = receiptOf(dir, home);
    assert.match(text, /review: NOT RUN/);
    assert.doesNotMatch(text, /ui-verify: NOT RUN/, "judged against today's config");
  });
});
