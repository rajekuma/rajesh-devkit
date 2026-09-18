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
