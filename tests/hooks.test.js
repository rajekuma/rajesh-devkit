'use strict';

// Behavioural checks: the hooks run as real processes against throwaway
// fixture projects, and their real exit codes and streams are asserted.
// Exit 2 plus the right stderr text IS this plugin's contract with the
// harness; testing the contract survives refactoring in a way that testing
// internals does not - this suite carried over from the PowerShell hooks to
// the Node ones without a single behavioural assertion changing.
//
// The exception proves the rule. Seven of these did have to change, and not
// because behaviour moved: they asserted the literal phrase
// "STOP before delegating", and rewording the gate's instructions broke them
// while the gate itself worked exactly as before. They now key off the one
// thing only the escalation branch mentions. Assert on what a message MEANS,
// not on how it currently reads.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  PLUGIN_ROOT,
  GLYPH,
  SAMPLE_PROGRESS,
  newFixture,
  removeFixture,
  runHook,
  exists,
  read,
} = require('./helpers');

function withFixture(opts, fn) {
  const dir = newFixture(opts);
  try {
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

// Only the escalation branch of continue-loop's message mentions SENSITIVE;
// the two ordinary nudges never do. That makes it a stable discriminator
// that survives rewording the gate's instructions.
const ESCALATION_RE = /SENSITIVE/;

function spec(body) {
  return `# Spec: User login\n\nMilestone: 1\n\n## Behaviour / requirements\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// The escalation gate. It fails OPEN - an unrecognised marker means a
// milestone that should have paused for a human gets auto-delegated silently -
// so it has to tolerate every way a model might render the prefix. Four of
// these were genuine misses under the original exact-substring matcher.
// ---------------------------------------------------------------------------
const markerCases = [
  ['glyph + space (canonical)', `1. ${GLYPH.lock} SENSITIVE: alters the users table`, true],
  ['glyph, no space', `1. ${GLYPH.lock}SENSITIVE: alters the users table`, true],
  ['glyph + variation selector', `1. ${GLYPH.lock}${GLYPH.vs16} SENSITIVE: touches auth`, true],
  ['glyph omitted entirely', '1. SENSITIVE: touches auth', true],
  ['wrapped in bold markdown', `1. **${GLYPH.lock} SENSITIVE:** touches auth`, true],
  ['space before the colon', `1. ${GLYPH.lock} SENSITIVE : touches auth`, true],
  ['lowercase prose does not trip it', 'This is not sensitive: just a note', false],
  ['ordinary requirement', '1. Returns 404 for a missing id', false],
];

for (const [name, body, shouldEscalate] of markerCases) {
  test(`escalation marker: ${name}`, () => {
    withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': spec(body) } }, (dir) => {
      const r = runHook('continue-loop.js', dir);
      const escalated = ESCALATION_RE.test(r.stderr);
      assert.strictEqual(escalated, shouldEscalate, `stderr was: ${r.stderr}`);
    });
  });
}

// ---------------------------------------------------------------------------
test('nudges toward devkit-specify when no spec exists', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2, 'should block the stop');
    assert.match(r.stderr, /devkit-specify/);
    assert.match(r.stderr, /User login/, 'should name the first unstarted milestone');
  });
});

test('nudges toward review then ship when a spec is ready', () => {
  const ready = '# Spec: User login\n\nMilestone: 1\n\n## Acceptance criteria\n\n- [ ] It works\n';
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': ready } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /devkit-reviewer/);
    assert.match(r.stderr, /devkit-ship/);
  });
});

// ---------------------------------------------------------------------------
test('allows the stop when stop_hook_active is true', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('continue-loop.js', dir, '{"stop_hook_active":true}');
    assert.strictEqual(r.exitCode, 0);
  });
});

test('allows the stop when there is no PROGRESS.md', () => {
  withFixture({}, (dir) => {
    assert.strictEqual(runHook('continue-loop.js', dir).exitCode, 0);
  });
});

test('allows the stop when nothing is unstarted', () => {
  const done = `# Progress\n\n| # | Milestone | Status |\n|---|---|---|\n| 1 | User login | ${GLYPH.done} |\n`;
  withFixture({ progress: done }, (dir) => {
    assert.strictEqual(runHook('continue-loop.js', dir).exitCode, 0);
  });
});

// ---------------------------------------------------------------------------
// All three hooks must defer to a project's own loop skill together.
// continue-loop deferring alone was a real bug: session-welcome kept
// advertising the devkit chain and signing off "the Stop hook will nudge
// automatically" - false precisely BECAUSE continue-loop had deferred - and
// track-milestones kept writing telemetry whose matching "started" events
// would never exist.
// ---------------------------------------------------------------------------
test('continue-loop defers to a project own spec-loop skill', () => {
  withFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true }, (dir) => {
    assert.strictEqual(runHook('continue-loop.js', dir).exitCode, 0);
  });
});

test('session-welcome defers, and drops the false nudge promise', () => {
  withFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true }, (dir) => {
    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.stdout, /defers to it/);
    assert.doesNotMatch(r.stdout, /nudge automatically/, 'promises a nudge that cannot happen');
    assert.doesNotMatch(r.stdout, /spec this feature/, 'still steering toward devkit-specify');
  });
});

test('track-milestones defers, writing nothing at all', () => {
  withFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true }, (dir) => {
    const r = runHook('track-milestones.js', dir);
    assert.strictEqual(r.exitCode, 0);
    assert.ok(!exists(dir, '.claude', 'rajesh-devkit'), 'created a telemetry folder anyway');
    assert.ok(!exists(dir, '.gitignore'), 'appended to the host .gitignore anyway');
  });
});

// ---------------------------------------------------------------------------
test('escalation shows once per milestone, not on every nudge', () => {
  const sens = spec(`1. ${GLYPH.lock} SENSITIVE: touches auth`);
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': sens } }, (dir) => {
    const first = runHook('continue-loop.js', dir);
    const second = runHook('continue-loop.js', dir);
    assert.match(first.stderr, ESCALATION_RE);
    assert.doesNotMatch(second.stderr, ESCALATION_RE, 'escalationShown did not stick');
    assert.strictEqual(second.exitCode, 2, 'should still block with the normal message');
  });
});

test('stops nudging after the 8-nudge cap', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    let last;
    for (let i = 0; i < 9; i++) last = runHook('continue-loop.js', dir);
    assert.strictEqual(last.exitCode, 0);
    assert.match(last.stdout, /8-nudge cap/, 'should explain why it stopped');
  });
});

// ---------------------------------------------------------------------------
test('writes valid, BOM-free telemetry and gitignores it', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    runHook('continue-loop.js', dir);
    const telPath = path.join(dir, '.claude', 'rajesh-devkit', 'telemetry.jsonl');
    assert.ok(fs.existsSync(telPath), 'no telemetry.jsonl created');

    // Checked in raw bytes on purpose. The obvious string form of this test
    // is silently vacuous: String.startsWith is culture-sensitive in .NET and
    // U+FEFF is ignorable, so the PowerShell original passed for every input.
    const bytes = fs.readFileSync(telPath);
    const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    assert.ok(!hasBom, 'a BOM on line 1 breaks strict line-by-line JSON parsing');

    const first = JSON.parse(read(telPath).split(/\r?\n/)[0]);
    assert.strictEqual(first.event, 'milestone_started');

    const gitignore = read(dir, '.gitignore');
    assert.ok(gitignore, 'no .gitignore written');
    assert.match(gitignore, /\.claude\/rajesh-devkit\//);
  });
});

test('gitignore entry is written exactly once, by any hook, ever', () => {
  // Two different hooks call ensureGitignoreEntry, and continue-loop may run
  // many times over a milestone's life. All of that must add up to one line.
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    runHook('continue-loop.js', dir);
    runHook('continue-loop.js', dir);
    runHook('track-milestones.js', dir);
    const gitignore = read(dir, '.gitignore') ?? '';
    const count = gitignore.split('.claude/rajesh-devkit/').length - 1;
    assert.strictEqual(count, 1, `entry appears ${count} times`);
  });
});

// ---------------------------------------------------------------------------
test('session-welcome agrees with continue-loop about a sensitive spec', () => {
  // devkit-help's whole promise is that the on-demand check and the automatic
  // banner never drift apart. If these two disagree, that promise is broken.
  const sens = spec(`1. ${GLYPH.lock} SENSITIVE: touches auth`);
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': sens } }, (dir) => {
    const w = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.strictEqual(w.exitCode, 0, 'session-welcome must never block');
    assert.match(w.stdout, /SENSITIVE/);
  });
});

test('session-welcome names the next milestone', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    const w = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.match(w.stdout, /User login/);
  });
});

test('session-welcome only greets a genuinely new session', () => {
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    const resumed = runHook('session-welcome.js', dir, '{"source":"resume"}');
    assert.strictEqual(resumed.stdout.trim(), '', 'should stay quiet on resume/clear/compact');
  });
});

// ---------------------------------------------------------------------------
test('run-verify is a silent no-op without a host verify script', () => {
  withFixture({}, (dir) => {
    const r = runHook('run-verify.js', dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stdout.trim(), '');
  });
});

for (const code of [0, 1, 2]) {
  test(`run-verify passes a host script's exit ${code} straight through`, () => {
    // The whole contract is that it does NOT remap the exit code - the host
    // project's own convention decides whether Claude sees the failure.
    const verify = `process.stdout.write('verify ran');\nprocess.exit(${code});\n`;
    withFixture({ files: { '.claude/verify.js': verify } }, (dir) => {
      const r = runHook('run-verify.js', dir);
      assert.strictEqual(r.exitCode, code);
      assert.match(r.stdout, /verify ran/);
    });
  });
}

test('run-verify prefers verify.js when several exist', () => {
  withFixture(
    {
      files: {
        '.claude/verify.js': "process.stdout.write('js ran');\nprocess.exit(0);\n",
        '.claude/verify.sh': 'echo sh ran\nexit 0\n',
      },
    },
    (dir) => {
      const r = runHook('run-verify.js', dir);
      assert.match(r.stdout, /js ran/);
      assert.doesNotMatch(r.stdout, /sh ran/, 'lookup order must be fixed and predictable');
    }
  );
});

test('run-verify does not block when it cannot execute what it found', () => {
  // Exit 0 rather than 2: this fires after EVERY edit, and blocking all work
  // over a setup problem is disproportionate. But it must say so - a verify
  // gate that silently never runs is the "unrun check assumed green" failure
  // devkit-ship exists to prevent.
  withFixture({ files: { '.claude/verify.ps1': 'exit 0\n' } }, (dir) => {
    const r = runHook('run-verify.js', dir);
    assert.strictEqual(r.exitCode, 0);
  });
});

// ---------------------------------------------------------------------------
// Stage configuration. Not everyone runs the whole chain: a product owner
// wants specs and documentation, a UX designer wants the design stage, a
// project that already owns spec/implement/review wants only what it lacks.
// A stage that isn't enabled must never be nudged toward, and when nothing
// enabled applies the loop must STOP - that is what makes a two-stage loop a
// real loop rather than a crippled version of the full one.
// ---------------------------------------------------------------------------
function withStages(stages, opts, fn) {
  return withFixture(
    { ...opts, files: { ...(opts.files ?? {}), '.claude/devkit.json': JSON.stringify({ stages }) } },
    fn
  );
}

const READY_SPEC = '# Spec: User login\n\nMilestone: 1\n\n## Acceptance criteria\n\n- [ ] It works\n';

test('a product-owner loop nudges the spec stage and names no engineering stage', () => {
  withStages(['specify', 'docs'], { progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /devkit-specify/);
    assert.doesNotMatch(r.stderr, /devkit-implementer/, 'named a stage this loop does not run');
    assert.doesNotMatch(r.stderr, /devkit-reviewer/, 'named a stage this loop does not run');
    assert.doesNotMatch(r.stderr, /devkit-ship/, 'named a stage this loop does not run');
  });
});

test('a product-owner loop STOPS once the spec exists', () => {
  // docs is enabled, so it still has something to say; the point is that it
  // must not push toward implementation.
  withStages(['specify'], { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 0, 'should allow the stop - every enabled stage is done');
    assert.strictEqual(r.stderr.trim(), '', `should say nothing, said: ${r.stderr}`);
  });
});

test('a UX loop nudges toward devkit-ux while the ux spec is missing', () => {
  withStages(['ux'], { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /devkit-ux/);
    assert.doesNotMatch(r.stderr, /devkit-implementer/);
  });
});

test('a UX loop stops once the ux spec exists', () => {
  withStages(
    ['ux'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC, 'user-login.ux.md': '# UX\n' } },
    (dir) => {
      assert.strictEqual(runHook('continue-loop.js', dir).exitCode, 0);
    }
  );
});

test('a loop without the spec stage stays silent when no spec exists', () => {
  // A ship-only or ux-only loop waits for whoever owns specs to write one,
  // rather than telling them to.
  withStages(['ship'], { progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stderr.trim(), '');
  });
});

test('the escalation gate does not fire for a loop that does not implement', () => {
  // The escalation message is entirely about whether to delegate to
  // devkit-implementer. With implement disabled there is nothing to ask.
  const sens = spec(`1. ${GLYPH.lock} SENSITIVE: touches auth`);
  withStages(['specify', 'ux'], { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': sens } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.doesNotMatch(r.stderr, /WRITE NO CODE YET/);
  });
});

test('the escalation gate still fires when implement IS enabled', () => {
  const sens = spec(`1. ${GLYPH.lock} SENSITIVE: touches auth`);
  withStages(['specify', 'implement'], { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': sens } }, (dir) => {
    assert.match(runHook('continue-loop.js', dir).stderr, ESCALATION_RE);
  });
});

test('a local config overrides the committed project one', () => {
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      files: {
        '.claude/devkit.json': JSON.stringify({ stages: ['specify', 'implement', 'review', 'ship'] }),
        '.claude/rajesh-devkit/devkit.local.json': JSON.stringify({ stages: ['specify'] }),
      },
    },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.match(r.stderr, /devkit-specify/);
      assert.doesNotMatch(r.stderr, /devkit-ship/, 'local override was ignored');
    }
  );
});

test('a malformed config falls back to the full loop rather than crashing', () => {
  // A hook that dies on a typo in a config file is worse than one that runs
  // the behaviour every project had before the file existed.
  withFixture(
    { progress: SAMPLE_PROGRESS, files: { '.claude/devkit.json': '{ this is not json' } },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2);
      assert.match(r.stderr, /devkit-specify/);
    }
  );
});

test('no config at all still means the full chain', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.match(r.stderr, /devkit-reviewer/);
    assert.match(r.stderr, /devkit-ship/);
  });
});

test('a nudge never names a component whose stage is disabled', () => {
  // Not just the instructions - the explanatory asides too. A backend loop's
  // datamodel step once described itself as "the data-side counterpart to
  // devkit-ux", naming a stage that loop had switched off.
  const ALL = ['specify', 'ux', 'datamodel', 'implementer', 'reviewer', 'quality', 'security', 'ship', 'docs', 'release', 'pipeline'];
  const stages = ['specify', 'datamodel', 'implement', 'review'];
  withStages(stages, { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    // component name -> the stage that enables it
    const stageOf = { implementer: 'implement', reviewer: 'review' };
    for (const name of ALL) {
      const stage = stageOf[name] ?? name;
      if (stages.includes(stage)) continue;
      assert.ok(
        !r.stderr.includes(`devkit-${name}`),
        `nudge named devkit-${name} but the ${stage} stage is disabled: ${r.stderr}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The deliver stage is the single exception to "nothing here commits". It is
// therefore the one stage that must be OFF unless a project asks for it -
// installing the plugin must never be enough to grant it.
// ---------------------------------------------------------------------------
test('deliver is NOT enabled by default', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.doesNotMatch(
      r.stderr,
      /devkit-deliver/,
      'a project that never opted in was nudged toward committing and pushing'
    );
  });
});

test('deliver appears only when explicitly enabled', () => {
  withStages(
    ['implement', 'review', 'ship', 'deliver'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } },
    (dir) => {
      assert.match(runHook('continue-loop.js', dir).stderr, /devkit-deliver/);
    }
  );
});

test('ui-verify is nudged for a UI loop', () => {
  withStages(
    ['implement', 'ui-verify'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } },
    (dir) => {
      assert.match(runHook('continue-loop.js', dir).stderr, /devkit-ui-verify/);
    }
  );
});

test('the security stage is nudged when enabled, absent when not', () => {
  withStages(
    ['implement', 'security', 'ship'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } },
    (dir) => {
      assert.match(runHook('continue-loop.js', dir).stderr, /devkit-security/);
    }
  );
  withStages(
    ['implement', 'ship'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } },
    (dir) => {
      assert.doesNotMatch(runHook('continue-loop.js', dir).stderr, /devkit-security/);
    }
  );
});

// ---------------------------------------------------------------------------
// A narrow loop is legitimate; a narrow loop nobody noticed was narrow is
// not. The "UNKNOWN, never PASS" rule lives inside devkit-ship, so switching
// ship off removes the one place an unrun check would have been reported.
// The banner names what was switched off - once, at session start, without
// blocking - so the omission is a choice rather than an oversight.
// ---------------------------------------------------------------------------
test('the banner names gate stages a loop switched off while implementing', () => {
  withStages(['specify', 'implement'], { progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('session-welcome.js', dir);
    assert.strictEqual(r.exitCode, 0, 'the banner never blocks');
    assert.match(r.stdout, /implement is on but review, security, ship are off/);
    assert.match(r.stdout, /\.claude\/devkit\.json/, 'should say where to change it');
  });
});

test('the banner stays quiet about gates when the loop does not implement', () => {
  // A product owner's specify-and-docs loop skips every gate by design;
  // there is no code to gate, so there is nothing to warn about.
  withStages(['specify', 'docs'], { progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('session-welcome.js', dir);
    assert.doesNotMatch(r.stdout, /is on but/);
  });
  // And the full default chain has every gate on.
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('session-welcome.js', dir);
    assert.doesNotMatch(r.stdout, /is on but/);
  });
});

test('the banner names only the gates that are actually off', () => {
  withStages(['implement', 'review', 'ship'], { progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('session-welcome.js', dir);
    assert.match(r.stdout, /implement is on but security is off/);
    assert.doesNotMatch(r.stdout, /review, security/);
  });
});

test('the quality stage is nudged after review and before security', () => {
  withStages(
    ['implement', 'review', 'quality', 'security'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      const i = (s) => r.stderr.indexOf(s);
      assert.ok(i('devkit-quality') > 0, 'quality not nudged');
      assert.ok(i('devkit-reviewer') < i('devkit-quality'), 'quality before review');
      assert.ok(i('devkit-quality') < i('devkit-security'), 'security before quality');
    }
  );
});

test('the release stage is nudged after docs, and says it never tags', () => {
  withStages(
    ['implement', 'docs', 'release', 'deliver'],
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC } },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      const i = (s) => r.stderr.indexOf(s);
      assert.ok(i('devkit-release') > 0, 'release not nudged');
      assert.ok(i('devkit-docs') < i('devkit-release'), 'release before docs');
      assert.ok(i('devkit-release') < i('devkit-deliver'), 'deliver before release');
      assert.match(r.stderr, /never tags/, 'the nudge must carry the one rule that matters');
    }
  );
});

test('an empty queue points at devkit-roadmap instead of a dead end', () => {
  // "Add a row when you have one" was the open end of the loop. The moment
  // the queue empties is when everything roadmap reads is freshest.
  const allDone = SAMPLE_PROGRESS.replace(/\u{2B1C}/gu, '\u{2705}');
  withFixture({ progress: allDone }, (dir) => {
    const r = runHook('session-welcome.js', dir);
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.stdout, /nothing queued/);
    assert.match(r.stdout, /devkit roadmap/);
    assert.match(r.stdout, /only when you approve/, 'must say it does not write rows unasked');
  });
});

// ---------------------------------------------------------------------------
// Annotated status cells. A tracker that writes "(glyph) spec Approved
// 2026-09-18 (...)" instead of a bare glyph had half its rows invisible to
// every hook here, and the loop silently nudged toward a milestone forty rows
// further down the file. Found by running these hooks against the project
// this toolkit was extracted from, which is exactly what it writes.
// ---------------------------------------------------------------------------

const ANNOTATED_PROGRESS = [
  '# Progress',
  '',
  '| # | Milestone | Status |',
  '|---|-----------|--------|',
  `| 1 | User login | ${GLYPH.done} shipped 2026-09-01 (with refresh tokens) |`,
  `| 2 | Password reset | ${GLYPH.notStarted} spec Approved 2026-09-18 (token expiry, rate limit) |`,
  '',
].join('\n');

test('an annotated status cell still matches', () => {
  withFixture({ progress: ANNOTATED_PROGRESS }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /M2 - Password reset/, `stderr was: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /spec Approved/, 'the annotation leaked into the milestone name');
  });
});

test('an annotated done row is still read as done', () => {
  withFixture({ progress: ANNOTATED_PROGRESS }, (dir) => {
    // M1 is done-with-a-note; if the glyph-only pattern were still in force
    // it would be unparsed, and M1 rather than M2 would be nudged toward.
    const r = runHook('continue-loop.js', dir);
    assert.doesNotMatch(r.stderr, /M1 - User login/, `stderr was: ${r.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// Parked rows. A tracker that doubles as an idea list has rows that are
// genuinely unstarted and genuinely not next - nobody has decided to build
// them. Without this the loop stalls on the first one forever, nudging for a
// spec the owner deliberately parked.
// ---------------------------------------------------------------------------

const PARKED_PROGRESS = [
  '# Progress',
  '',
  '| # | Milestone | Status |',
  '|---|-----------|--------|',
  `| 1a | Onboarding Assistant | ${GLYPH.notStarted} not spec'd - see product_vision.md |`,
  `| 2 | Password reset | ${GLYPH.notStarted} spec Approved |`,
  '',
].join('\n');

test('a parked row is skipped for the next real milestone', () => {
  withFixture({ progress: PARKED_PROGRESS }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /M2 - Password reset/, `stderr was: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Onboarding Assistant/, 'nudged toward a parked row');
  });
});

test('a custom parkedPattern replaces the default', () => {
  withFixture(
    {
      progress: PARKED_PROGRESS,
      files: { '.claude/devkit.json': JSON.stringify({ parkedPattern: 'icebox' }) },
    },
    (dir) => {
      // "not spec'd" is no longer parked, so the first row IS next again.
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2);
      assert.match(r.stderr, /Onboarding Assistant/, `stderr was: ${r.stderr}`);
    }
  );
});

test('a malformed parkedPattern parks nothing rather than crashing', () => {
  withFixture(
    {
      progress: PARKED_PROGRESS,
      files: { '.claude/devkit.json': JSON.stringify({ parkedPattern: '[unclosed' }) },
    },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2, `should still nudge; stderr was: ${r.stderr}`);
      assert.match(r.stderr, /Onboarding Assistant/);
    }
  );
});

// ---------------------------------------------------------------------------
// The spec Status gate. A project whose workflow says "propose a spec and
// STOP for my approval" has that approval recorded in the spec's own header.
// Implementing a Draft walks straight past it.
// ---------------------------------------------------------------------------

function statusSpec(status) {
  return (
    '# Spec: User login\n\n' +
    `Milestone: M1 (PROGRESS.md) - Status: ${status} - Related ADRs: none\n\n` +
    '## Acceptance criteria\n\n- [ ] It works\n'
  );
}

test('a Draft spec is never nudged toward implementation', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': statusSpec('Draft') } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /Draft/, `stderr was: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /strict TDD/, 'nudged toward implementing an unapproved spec');
  });
});

test('an Approved spec runs the chain as normal', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': statusSpec('Approved'), 'user-login.ux.md': UX_DONE } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /strict TDD/, `stderr was: ${r.stderr}`);
  });
});

test('a spec with no Status header behaves exactly as before', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /strict TDD/, `stderr was: ${r.stderr}`);
  });
});

test('an Implemented spec under an unfinished row reports a stale tracker', () => {
  withFixture(
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': statusSpec('Implemented') } },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2);
      assert.match(r.stderr, /stale|out of date/i, `stderr was: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /strict TDD/, 'told the session to rebuild shipped work');
    }
  );
});

test('a Draft spec outranks the sensitive gate, and does not burn it', () => {
  const draftSensitive =
    '# Spec: User login\n\nMilestone: M1 - Status: Draft\n\n' +
    '## Behaviour / requirements\n\n1. SENSITIVE: touches auth\n';
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': draftSensitive } }, (dir) => {
    const first = runHook('continue-loop.js', dir);
    assert.match(first.stderr, /Draft/, `stderr was: ${first.stderr}`);
    assert.doesNotMatch(first.stderr, ESCALATION_RE, 'escalated before the spec was approved');

    // Approve it: the escalation must still be available, not already spent.
    fs.writeFileSync(
      path.join(dir, 'specs', 'user-login.md'),
      draftSensitive.replace('Status: Draft', 'Status: Approved'),
      'utf8'
    );
    const second = runHook('continue-loop.js', dir);
    assert.match(second.stderr, ESCALATION_RE, `stderr was: ${second.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// Configurable sensitivity. A project that predates this plugin flags the
// same five categories in its own words; the marker gate never fired on any
// of it. Configured patterns are ORed in, so adding one can only make the
// gate fire more often - the safe direction for a gate that fails open.
// ---------------------------------------------------------------------------

test('a configured pattern fires the gate on prose the marker misses', () => {
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      specs: { 'user-login.md': spec('1. Money is a decimal everywhere.') },
      files: {
        '.claude/devkit.json': JSON.stringify({ sensitivePatterns: ['Money is a decimal'] }),
      },
    },
    (dir) => {
      assert.match(runHook('continue-loop.js', dir).stderr, ESCALATION_RE);
    }
  );
});

test('the canonical marker still fires when patterns are configured', () => {
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      specs: { 'user-login.md': spec('1. SENSITIVE: touches auth') },
      files: { '.claude/devkit.json': JSON.stringify({ sensitivePatterns: ['never matches this'] }) },
    },
    (dir) => {
      assert.match(runHook('continue-loop.js', dir).stderr, ESCALATION_RE);
    }
  );
});

test('a malformed sensitivePattern is ignored, not fatal', () => {
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      specs: { 'user-login.md': spec('1. Returns 404 for a missing id'), 'user-login.ux.md': UX_DONE },
      files: { '.claude/devkit.json': JSON.stringify({ sensitivePatterns: ['([unclosed'] }) },
    },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2, `should still nudge; stderr was: ${r.stderr}`);
      assert.match(r.stderr, /strict TDD/);
    }
  );
});

// ---------------------------------------------------------------------------
// Loop ownership. Detection alone meant the project this toolkit came from
// could never run it: the old spec-loop skill is still on disk, so every hook
// stood down and there was no way to say "drive anyway" short of deleting the
// fallback.
// ---------------------------------------------------------------------------

test('loop devkit takes the loop back from a project spec-loop skill', () => {
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      ownLoopSkill: true,
      files: { '.claude/devkit.json': JSON.stringify({ loop: 'devkit' }) },
    },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2, 'should have driven the loop');
      assert.match(r.stderr, /M1 - User login/);
    }
  );
});

test('a config that sets only loop keeps the full default stage chain', () => {
  // The stage list and the other settings are read independently: saying one
  // thing must not mean losing the others.
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      ownLoopSkill: true,
      files: { '.claude/devkit.json': JSON.stringify({ loop: 'devkit' }) },
    },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.match(r.stderr, /devkit-specify/, `stderr was: ${r.stderr}`);
    }
  );
});

test('detection still wins with no config at all', () => {
  withFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true }, (dir) => {
    assert.strictEqual(runHook('continue-loop.js', dir).exitCode, 0, 'should still defer');
  });
});

test('loop project defers even without a spec-loop skill', () => {
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      files: { '.claude/devkit.json': JSON.stringify({ loop: 'project' }) },
    },
    (dir) => {
      assert.strictEqual(runHook('continue-loop.js', dir).exitCode, 0);
    }
  );
});

test('the welcome banner says how to take the loop back', () => {
  withFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true }, (dir) => {
    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.match(r.stdout, /loop.*devkit/, `stdout was: ${r.stdout}`);
  });
});

// ---------------------------------------------------------------------------
// The resume checkpoint. A usage-limit block gives the session no turn at
// all, so the only record of where it was is whatever a hook already wrote.
// PostToolUse is the one event that has fired by then.
// ---------------------------------------------------------------------------

// The ux stage is on by default, so a fixture that wants to exercise a LATER
// stage has to satisfy it first - otherwise every such test is really a test
// of the ux branch.
const UX_DONE = '# UX: User login\n';

const PARTIAL_SPEC =
  '# Spec: User login\n\nMilestone: M1 - Status: Approved\n\n' +
  '## Acceptance criteria\n\n- [x] Rejects a bad password\n- [x] Issues a token\n- [ ] Expires it\n';

function resumeFile(dir) {
  const raw = read(dir, '.claude', 'rajesh-devkit', 'resume.json');
  return raw === null ? null : JSON.parse(raw);
}

test('write-resume records position derived from the repo, not from a claim', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    assert.strictEqual(runHook('write-resume.js', dir).exitCode, 0);
    const r = resumeFile(dir);
    assert.ok(r, 'no resume.json written');
    assert.strictEqual(r.milestone, 'M1 - User login');
    assert.strictEqual(r.criteria, '2/3');
    assert.strictEqual(r.nextCriterion, 3);
    assert.strictEqual(r.specStatus, 'approved');
    assert.strictEqual(r.stage, 'implement');
  });
});

test('the resume checkpoint is gitignored like the rest of the telemetry', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    runHook('write-resume.js', dir);
    assert.match(read(dir, '.gitignore') ?? '', /\.claude\/rajesh-devkit\//);
  });
});

test('write-resume defers to a project own loop, like every writing hook', () => {
  withFixture(
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE }, ownLoopSkill: true },
    (dir) => {
      runHook('write-resume.js', dir);
      assert.strictEqual(resumeFile(dir), null, 'wrote state nothing would ever read');
      assert.ok(!exists(dir, '.claude', 'rajesh-devkit'), 'created a folder inside another loop');
    }
  );
});

test('a cold session resumes from the checkpoint instead of restarting', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    runHook('write-resume.js', dir);
    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.match(r.stdout, /mid-flight/, `stdout was: ${r.stdout}`);
    assert.match(r.stdout, /criterion 3/);
    assert.match(r.stdout, /M1 - User login/);
  });
});

test('an untouched milestone is not greeted as mid-flight', () => {
  // 0 of N ticked has a perfectly good "next criterion" - the first one -
  // and is not mid-flight by any useful definition. The banner said
  // "picking up M28, mid-flight" for a milestone nobody had started, which
  // is both false and the wrong instruction: it says carry on, when the
  // session should be running the gates that come before the first line of
  // code.
  const untouched = PARTIAL_SPEC.split('- [x]').join('- [ ]');
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': untouched, 'user-login.ux.md': UX_DONE } }, (dir) => {
    runHook('write-resume.js', dir);
    assert.strictEqual(resumeFile(dir).started, false);
    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.doesNotMatch(r.stdout, /mid-flight/, `stdout was: ${r.stdout}`);
  });
});

test('a checkpoint for a different milestone is ignored, not followed backwards', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    runHook('write-resume.js', dir);
    const file = path.join(dir, '.claude', 'rajesh-devkit', 'resume.json');
    const stale = JSON.parse(fs.readFileSync(file, 'utf8'));
    stale.milestone = 'M99 - Something already shipped';
    fs.writeFileSync(file, JSON.stringify(stale), 'utf8');

    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.doesNotMatch(r.stdout, /mid-flight/, `followed a stale checkpoint: ${r.stdout}`);
    assert.doesNotMatch(r.stdout, /M99/);
  });
});

test('a hand-run of write-resume without the harness says the checkpoint is stale', () => {
  // Found in M28: a manual run with no CLAUDE_PROJECT_DIR wrote nothing and
  // said nothing, and the old resume.json read as current - "4/36" for a
  // milestone that was 36/36.
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    runHook('write-resume.js', dir);
    const file = path.join(dir, '.claude', 'rajesh-devkit', 'resume.json');
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    old.updatedAt = '2026-01-01T00:00:00.000Z';
    fs.writeFileSync(file, JSON.stringify(old), 'utf8');

    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const r = require('child_process').spawnSync(
      process.execPath,
      [path.join(PLUGIN_ROOT, 'scripts', 'write-resume.js')],
      { cwd: dir, input: '{}', encoding: 'utf8', env }
    );
    assert.strictEqual(r.status, 0, 'must still never block');
    assert.match(r.stderr, /CLAUDE_PROJECT_DIR/);
    assert.match(r.stderr, /2026-01-01/, `did not point at the stale timestamp: ${r.stderr}`);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).updatedAt, '2026-01-01T00:00:00.000Z');
  });
});

test('write-resume under the harness stays silent', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    const r = runHook('write-resume.js', dir);
    assert.strictEqual(r.stderr.trim(), '', `noise in the loop: ${r.stderr}`);
  });
});

test('a corrupt checkpoint is ignored rather than fatal', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    const outDir = path.join(dir, '.claude', 'rajesh-devkit');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'resume.json'), '{ not json', 'utf8');
    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.stdout, /M1 - User login/, `stdout was: ${r.stdout}`);
  });
});

// An Approved spec that is SENSITIVE and has a checkbox criteria list, with
// each box's state given as 'x' or ' '.
function sensitiveSpecWithCriteria(boxes) {
  return [
    '# Spec: User login',
    '',
    'Milestone: M1 - Status: Approved',
    '',
    '## Behaviour / requirements',
    '',
    '1. SENSITIVE: touches auth',
    '',
    '## Acceptance criteria',
    '',
    ...boxes.map((b, i) => `- [${b}] Criterion ${i + 1}`),
    '',
  ].join('\n');
}

test('the escalation gate does not re-fire on work already underway', () => {
  // The "shown once" memory lives in OS temp, keyed by project path, so it
  // does not survive the two cases this loop explicitly supports: resuming on
  // another machine, or in a fresh session after a usage limit. Found in a
  // resume drill - a session picking up a milestone with 7 of 36 criteria
  // green was told "WRITE NO CODE YET" about work seven tests already proved.
  // A ticked criterion is proof the gate's moment has passed, and unlike the
  // temp file it travels with the work.
  const startedSensitive = sensitiveSpecWithCriteria(['x', ' ']);
  withFixture(
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': startedSensitive, 'user-login.ux.md': UX_DONE } },
    (dir) => {
      const r = runHook('continue-loop.js', dir);
      assert.strictEqual(r.exitCode, 2);
      assert.doesNotMatch(r.stderr, /WRITE NO CODE/, `stderr was: ${r.stderr}`);
      assert.match(r.stderr, /criterion 2/, 'should point at where to resume instead');
    }
  );
});

test('the escalation gate still fires before the first criterion is green', () => {
  const untouchedSensitive = sensitiveSpecWithCriteria([' ', ' ']);
  withFixture(
    { progress: SAMPLE_PROGRESS, specs: { 'user-login.md': untouchedSensitive, 'user-login.ux.md': UX_DONE } },
    (dir) => {
      assert.match(runHook('continue-loop.js', dir).stderr, /WRITE NO CODE/);
    }
  );
});

test('the Stop nudge names where the ticks got to, for a resumed run', () => {
  withFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': PARTIAL_SPEC, 'user-login.ux.md': UX_DONE } }, (dir) => {
    const r = runHook('continue-loop.js', dir);
    assert.match(r.stderr, /criterion 3/, `stderr was: ${r.stderr}`);
    assert.match(r.stderr, /resume/i);
  });
});

// ---------------------------------------------------------------------------
// Reading the harness payload must never outlive the harness. These scripts
// are also run directly - devkit-help invokes session-welcome.js, devkit-eval
// runs hooks by hand - and there a blocking read waits for an EOF that never
// arrives. Found by running devkit-help's own documented command, which hung
// for two minutes; the skill claimed at the time that stdin was not required.
// ---------------------------------------------------------------------------

test('a hook run on a terminal does not block waiting for stdin', () => {
  const { spawnSync } = require('child_process');
  // Stands in for an interactive terminal: the child sees isTTY true and must
  // answer immediately rather than waiting for a close that is not coming.
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      "process.stdin.isTTY = true; const d = require(process.argv[1]); " +
        "process.stdout.write(JSON.stringify(d.readStdin()));",
      path.join(PLUGIN_ROOT, 'scripts', 'lib', 'devkit.js'),
    ],
    { encoding: 'utf8', timeout: 10000, input: '' }
  );
  assert.strictEqual(r.signal, null, 'readStdin blocked and had to be killed');
  assert.strictEqual(r.stdout, '""', `expected an empty read, got: ${r.stdout}`);
});

test('a hook still reads a piped payload, because the harness sends one', () => {
  // The guard above must not cost the hooks their actual input: source is what
  // session-welcome uses to skip resume/clear/compact.
  withFixture({ progress: SAMPLE_PROGRESS }, (dir) => {
    const r = runHook('session-welcome.js', dir, '{"source":"resume"}');
    assert.strictEqual(r.stdout.trim(), '', 'greeted on a resume, so the payload was not read');
  });
});

// ---------------------------------------------------------------------------
// Provider awareness. Nothing here switches a model - a hook cannot. But a
// session run on a cheap open model through a gateway must never be mistaken
// for one run on Claude, and billing changes the moment a gateway credential
// is present.
// ---------------------------------------------------------------------------

const { detectProvider, describeProvider } = require('../scripts/lib/provider');

test('a stock session says nothing about providers', () => {
  assert.strictEqual(describeProvider(detectProvider({})), null);
});

test('the desktop app own base URL is not reported as a provider switch', () => {
  // The desktop app sets ANTHROPIC_BASE_URL=https://api.anthropic.com itself.
  // Treating the presence of that variable as a signal announced a provider
  // switch in every ordinary session - which is how a line earns being
  // ignored, and how a real switch goes unnoticed when it happens.
  assert.strictEqual(
    describeProvider(detectProvider({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })),
    null
  );
});

test('a gateway session names the provider and the tier mapping', () => {
  const line = describeProvider(
    detectProvider({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
      ANTHROPIC_AUTH_TOKEN: 'sk-or-test',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen/qwen3-coder',
    })
  );
  assert.match(line, /openrouter/);
  assert.match(line, /sonnet->qwen\/qwen3-coder/);
  assert.match(line, /billed per token/, 'did not say the subscription is not in use');
});

test('a base URL without a credential is not reported as billed per token', () => {
  const line = describeProvider(detectProvider({ ANTHROPIC_BASE_URL: 'https://proxy.internal/api' }));
  assert.match(line, /subscription credential/);
});

// ---------------------------------------------------------------------------
// Liveness: is another session already holding this milestone in this tree?
//
// Every check above this line derives "where the work got to" from disk -
// PROGRESS.md, the spec's ticks, resume.json, git status. None of them records
// whether a session is currently RUNNING against the tree, and the hooks were
// reading the first as an answer to the second. The cost, measured: a
// SessionStart told a new session to "resume at criterion 4" of a milestone
// another session had been implementing for nine minutes, and the two
// independently set out to write the same two registration lines.
//
// The rule these all circle is one shape and only one: same worktree, same
// milestone, a different session, still alive. Every other combination is
// somebody working the way they meant to, and a false alarm there is worse
// than the collision - so most of what follows is the cases that must NOT fire.
// ---------------------------------------------------------------------------

const {
  MILESTONE,
  MINUTE,
  specs: leaseSpecs,
  writeLease,
  readLeaseFile,
  payload,
  transcriptFile,
} = require('./lease-fixtures');
const leaseLib = require('../scripts/lib/lease');

const MINE = 'my-session-9999';

function withLeaseFixture(fn, opts = {}) {
  return withFixture({ progress: SAMPLE_PROGRESS, specs: leaseSpecs(), ...opts }, fn);
}

test('a live lease from another session withholds the resume instruction', () => {
  withLeaseFixture((dir) => {
    runHook('write-resume.js', dir, payload(MINE));
    writeLease(dir);

    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.strictEqual(r.exitCode, 0, 'a collision must never crash the greeting');
    assert.doesNotMatch(r.stdout, /criterion 3/, `handed over the resume point: ${r.stdout}`);
    assert.doesNotMatch(r.stdout, /mid-flight/);
    assert.match(r.stdout, /another session/i, `did not surface the conflict: ${r.stdout}`);
  });
});

test('the conflict is reported with evidence, not as a bare warning', () => {
  withLeaseFixture((dir) => {
    writeLease(dir);
    const out = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' })).stdout;
    assert.match(out, /other-session-0001/, 'no session id to match against a window');
    assert.match(out, /feat\/user-login/, 'no branch');
    assert.match(out, /last seen/, 'no recency');
    assert.ok(out.includes(MILESTONE), 'did not name the milestone');
  });
});

test('the conflict asks the owner rather than arbitrating', () => {
  withLeaseFixture((dir) => {
    writeLease(dir);
    const out = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' })).stdout;
    assert.match(out, /ask the owner/i, 'did not hand the decision to a human');
    // Nothing here may read as a verdict about which session should stop.
    assert.doesNotMatch(out, /you must stop|abort this session|exit now/i);
  });
});

test('an expired lease is ignored, so a dead session cannot lock the milestone', () => {
  // The usage-limit case: a session dies without a turn, so nothing ever
  // clears its claim. Without a TTL the next session is locked out of its own
  // milestone permanently - a worse failure than the one being fixed.
  withLeaseFixture((dir) => {
    writeLease(dir, { renewedAt: new Date(Date.now() - 120 * MINUTE).toISOString() });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.doesNotMatch(r.stdout, /another session/i, `held by a corpse: ${r.stdout}`);
    assert.match(r.stdout, /M1 - User login/);
  });
});

test('a stale lease is dropped from the file rather than left to rot', () => {
  withLeaseFixture((dir) => {
    writeLease(dir, { renewedAt: new Date(Date.now() - 120 * MINUTE).toISOString() });
    runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    const ids = (readLeaseFile(dir)?.leases ?? []).map((l) => l.sessionId);
    assert.deepStrictEqual(ids, [MINE], `expected only the live session, got ${ids.join()}`);
  });
});

test('a session re-entering its own work is not a conflict', () => {
  // A /clear, a --resume, a second SessionStart in one session: the id is the
  // same, so there is nobody to collide with.
  withLeaseFixture((dir) => {
    writeLease(dir, { sessionId: MINE });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.doesNotMatch(r.stdout, /another session/i, `collided with itself: ${r.stdout}`);
  });
});

test('a session in a different worktree is not a conflict', () => {
  withLeaseFixture((dir) => {
    writeLease(dir, { worktree: '/somewhere/else/checkout-two' });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.doesNotMatch(
      r.stdout,
      /another session/i,
      `a second checkout is not a collision: ${r.stdout}`
    );
  });
});

test('a session on a different milestone in the same tree is not a conflict', () => {
  withLeaseFixture((dir) => {
    writeLease(dir, { milestone: 'M2 - Password reset' });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.doesNotMatch(r.stdout, /another session/i, `split the queue on purpose: ${r.stdout}`);
  });
});

test('two sessions on different milestones both stay recorded', () => {
  // A single-slot file would make each evict the other, so neither would be
  // visible to a third session arriving on a milestone one of them holds.
  withLeaseFixture((dir) => {
    writeLease(dir, { milestone: 'M2 - Password reset' });
    runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    const ids = (readLeaseFile(dir)?.leases ?? []).map((l) => l.sessionId).sort();
    assert.deepStrictEqual(ids, ['my-session-9999', 'other-session-0001']);
  });
});

test('no lease file at all is the ordinary case, not an error', () => {
  withLeaseFixture((dir) => {
    runHook('write-resume.js', dir, payload(MINE));
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.stdout, /criterion 3/, `a solo session lost its resume point: ${r.stdout}`);
  });
});

test('a corrupt lease file fails open rather than blocking a solo session', () => {
  withLeaseFixture((dir) => {
    runHook('write-resume.js', dir, payload(MINE));
    const file = leaseLib.leasePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json at all', 'utf8');

    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.strictEqual(r.exitCode, 0, 'a bad state file crashed the greeting');
    assert.match(r.stdout, /criterion 3/, `nagged a solo session: ${r.stdout}`);
  });
});

test('a lease file of the wrong shape is treated as no leases', () => {
  withLeaseFixture((dir) => {
    const file = leaseLib.leasePath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, leases: 'not-an-array' }), 'utf8');
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.strictEqual(r.exitCode, 0);
    assert.doesNotMatch(r.stdout, /another session/i);
  });
});

test('every hook still exits 0 when the state directory cannot be written', () => {
  // A file where the state directory belongs: mkdir, read and rename all fail.
  // Nothing here may take an edit, a stop or a greeting down with it.
  withLeaseFixture((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'rajesh-devkit'), 'not a directory', 'utf8');

    assert.strictEqual(runHook('write-resume.js', dir, payload(MINE)).exitCode, 0);
    const w = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.strictEqual(w.exitCode, 0, `session-welcome died: ${w.stderr}`);
    assert.match(w.stdout, /M1 - User login/, 'lost the banner over a state-file problem');
    // continue-loop's contract is exit 2 with a nudge - it must reach that,
    // not fall over on the way.
    const c = runHook('continue-loop.js', dir, payload(MINE));
    assert.strictEqual(c.exitCode, 2, `continue-loop died: ${c.stderr}`);
  });
});

test('a failed write leaves no temp file behind', () => {
  // PostToolUse renews on every edit, so an orphan per failure would pile up
  // fast in a project whose state directory has gone bad.
  withLeaseFixture((dir) => {
    const stateDir = path.join(dir, '.claude', 'rajesh-devkit');
    fs.mkdirSync(stateDir, { recursive: true });
    // A non-empty directory where the lease file belongs: the rename fails.
    fs.mkdirSync(path.join(leaseLib.leasePath(dir), 'blocker'), { recursive: true });

    runHook('write-resume.js', dir, payload(MINE));
    const litter = fs.readdirSync(stateDir).filter((f) => f.endsWith('.tmp'));
    assert.deepStrictEqual(litter, [], `left temp files: ${litter.join()}`);
  });
});

test('a hook with no session id in its payload never reports a conflict', () => {
  // devkit-help runs session-welcome.js directly and devkit-eval runs hooks by
  // hand; neither supplies a payload. With no identity there is no way to tell
  // our own lease from a stranger's, and guessing would mean telling a solo
  // session it is colliding with itself.
  withLeaseFixture((dir) => {
    writeLease(dir);
    const r = runHook('session-welcome.js', dir, '{"source":"startup"}');
    assert.strictEqual(r.exitCode, 0);
    assert.doesNotMatch(r.stdout, /another session/i, `false alarm with no identity: ${r.stdout}`);
  });
});

test('a transcript still being written keeps a lease alive without any hook', () => {
  // The incident's actual shape. PostToolUse only fires on an edit, so a
  // session reading, testing and diagnosing stops renewing - which is exactly
  // what the session that was NOT greeted had been doing. The harness appends
  // to the transcript every turn regardless, so its mtime is the signal that
  // survives a long read-only stretch.
  withLeaseFixture((dir) => {
    writeLease(dir, {
      renewedAt: new Date(Date.now() - 120 * MINUTE).toISOString(),
      transcript: transcriptFile(dir),
    });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.match(r.stdout, /another session/i, `missed a live read-only session: ${r.stdout}`);
    assert.match(r.stdout, /transcript/, 'did not say which signal proved it alive');
  });
});

test('a transcript that also went quiet lets the lease expire', () => {
  withLeaseFixture((dir) => {
    writeLease(dir, {
      renewedAt: new Date(Date.now() - 120 * MINUTE).toISOString(),
      transcript: transcriptFile(dir, 120 * MINUTE),
    });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.doesNotMatch(r.stdout, /another session/i, `both signals dead, still held: ${r.stdout}`);
  });
});

test('a missing transcript falls back to the hook signal rather than erroring', () => {
  withLeaseFixture((dir) => {
    writeLease(dir, { transcript: path.join(dir, 'gone', 'never-existed.jsonl') });
    const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.stdout, /another session/i, 'lost a fresh lease over a missing transcript');
  });
});

test('the Stop hook refuses to drive the loop into another session work', () => {
  withLeaseFixture((dir) => {
    writeLease(dir);
    const r = runHook('continue-loop.js', dir, payload(MINE));
    assert.strictEqual(r.exitCode, 2, 'let the stop through, so the collision went unsaid');
    assert.match(r.stderr, /another session/i, `stderr was: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /resume at criterion 3/, 'nudged into the collision anyway');
    assert.doesNotMatch(r.stderr, /devkit-reviewer/, 'named the downstream chain regardless');
  });
});

test('the Stop hook still nudges normally once the lease has expired', () => {
  withLeaseFixture((dir) => {
    writeLease(dir, { renewedAt: new Date(Date.now() - 120 * MINUTE).toISOString() });
    const r = runHook('continue-loop.js', dir, payload(MINE));
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /criterion 3/, `lost the ordinary nudge: ${r.stderr}`);
  });
});

test('a conflict does not log the milestone as started', () => {
  // The conflict message is not a nudge toward the milestone: it must not burn
  // one of the eight, and it must not record a start for work this session is
  // being told not to begin - devkit-stats pairs that event with a shipped one
  // that would never come.
  withLeaseFixture((dir) => {
    writeLease(dir);
    runHook('continue-loop.js', dir, payload(MINE));
    const telemetry = read(dir, '.claude', 'rajesh-devkit', 'telemetry.jsonl');
    assert.strictEqual(telemetry, null, 'wrote telemetry despite a live conflict');
  });
});

test('the lease is gitignored exactly like the rest of the state', () => {
  withLeaseFixture((dir) => {
    runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
    assert.ok(fs.existsSync(leaseLib.leasePath(dir)), 'no lease written');
    assert.match(read(dir, '.gitignore') ?? '', /\.claude\/rajesh-devkit\//);
  });
});

test('write-resume publishes presence on every edit, not just at a stop', () => {
  // An edit is proof of activity that a stop is not: a session can sit at a
  // stop for an hour waiting on a human.
  withLeaseFixture((dir) => {
    runHook('write-resume.js', dir, payload(MINE));
    const leases = readLeaseFile(dir)?.leases ?? [];
    assert.strictEqual(leases.length, 1);
    assert.strictEqual(leases[0].sessionId, MINE);
    assert.strictEqual(leases[0].milestone, MILESTONE);
  });
});

test('a session in a project with its own loop publishes nothing', () => {
  withLeaseFixture(
    (dir) => {
      runHook('write-resume.js', dir, payload(MINE));
      runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
      assert.ok(!exists(dir, '.claude', 'rajesh-devkit'), 'wrote state into another loop project');
    },
    { ownLoopSkill: true }
  );
});

test('a configured TTL replaces the default, and a silly one is clamped', () => {
  // 0 would disable detection silently and 9999 would make a crashed session's
  // claim effectively permanent - the lockout the TTL exists to prevent.
  assert.strictEqual(leaseLib.ttlMs({}) / 60000, leaseLib.DEFAULT_TTL_MINUTES);
  assert.strictEqual(leaseLib.ttlMs({ sessionLeaseTtlMinutes: 45 }) / 60000, 45);
  assert.strictEqual(leaseLib.ttlMs({ sessionLeaseTtlMinutes: 0 }) / 60000, 1);
  assert.strictEqual(leaseLib.ttlMs({ sessionLeaseTtlMinutes: 9999 }) / 60000, 240);
  assert.strictEqual(
    leaseLib.ttlMs({ sessionLeaseTtlMinutes: 'soon' }) / 60000,
    leaseLib.DEFAULT_TTL_MINUTES
  );
});

test('a short configured TTL expires a lease the default would still hold', () => {
  withLeaseFixture(
    (dir) => {
      writeLease(dir, { renewedAt: new Date(Date.now() - 5 * MINUTE).toISOString() });
      const r = runHook('session-welcome.js', dir, payload(MINE, { source: 'startup' }));
      assert.doesNotMatch(r.stdout, /another session/i, `ignored the configured TTL: ${r.stdout}`);
    },
    { files: { '.claude/devkit.json': JSON.stringify({ sessionLeaseTtlMinutes: 2 }) } }
  );
});

test('a loop with nothing to nudge toward stays silent even during a collision', () => {
  // The conflict check sits BELOW the "no spec and this loop doesn't own
  // specify" guard, not above it. A UX-only or ship-only loop waiting for
  // someone else to write the spec exits 0 in total silence today, and a
  // collision warning about a milestone this hook would never have driven
  // toward is noise in a loop that deliberately says nothing - there is no
  // forward motion to suppress. Caught by reading the diff, not by a failure:
  // placed one guard higher, this case gained an exit 2 it never had.
  withFixture(
    {
      progress: SAMPLE_PROGRESS,
      files: { '.claude/devkit.json': JSON.stringify({ stages: ['ux', 'ship'] }) },
    },
    (dir) => {
      writeLease(dir);
      const r = runHook('continue-loop.js', dir, payload(MINE));
      assert.strictEqual(r.exitCode, 0, `broke a deliberately silent loop: ${r.stderr}`);
      assert.strictEqual(r.stderr.trim(), '', `said something: ${r.stderr}`);
    }
  );
});
