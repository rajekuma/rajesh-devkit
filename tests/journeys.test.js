'use strict';

// User journeys (docs/plans/journeys.md): what a project can show a person can
// actually do, proven by running a check rather than by anyone's say-so. Hooks and
// the CLI run as separate processes, as the harness runs them, and the assertions
// are on states and JSON fields rather than on wording.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, SAMPLE_PROGRESS, GLYPH, newFixture, removeFixture, runHook } = require('./helpers');
const receipt = require('../scripts/lib/receipt');
const arm = require('../scripts/lib/arm');

const ME = 'journey-session-01';

const PASS = 'node pass.js';
const FAIL = 'node fail.js';

const journey = (id, check, extra = '') =>
  `## ${id} Journey ${id}\nFor: a person\nOutcome: something useful happens\n${extra}Check: ${check}\n`;

const FILES = {
  'pass.js': 'process.exit(0);\n',
  'fail.js': 'process.exit(3);\n',
  'src.js': 'module.exports = 1;\n',
};

function git(dir, ...args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
}

// A committed git project, because a proof is only ever good for a known tree.
function withProject(journeysText, fn, { files = {}, progress = SAMPLE_PROGRESS, repo = true } = {}) {
  const all = { ...FILES, ...files };
  if (journeysText !== null) all['JOURNEYS.md'] = journeysText;
  const dir = newFixture({
    progress,
    specs: { 'user-login.md': 'Status: Approved\n\n- [x] a\n- [ ] b\n' },
    files: all,
  });
  try {
    if (repo) {
      git(dir, 'init', '-q');
      git(dir, 'config', 'user.email', 'test@example.com');
      git(dir, 'config', 'user.name', 'test');
      fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/rajesh-devkit/\n', 'utf8');
      git(dir, 'add', '-A');
      git(dir, 'commit', '-qm', 'init');
    }
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

function cli(dir, ...args) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', 'journeys.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    timeout: 60000,
  });
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function states(dir) {
  const out = JSON.parse(cli(dir, 'status', '--json').stdout);
  return Object.fromEntries(out.journeys.map((j) => [j.id, j.state]));
}

const prompt = (dir, text, sid = ME) =>
  runHook('loop-command.js', dir, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: text }));
const stop = (dir, extra = {}, sid = ME) =>
  runHook('continue-loop.js', dir, JSON.stringify({ hook_event_name: 'Stop', session_id: sid, ...extra }));
const welcome = (dir, sid = ME) =>
  runHook('session-welcome.js', dir, JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source: 'startup' }));
const track = (dir, sid = ME) => runHook('track-milestones.js', dir, JSON.stringify({ session_id: sid }));

function tickM1(dir) {
  fs.writeFileSync(
    path.join(dir, 'PROGRESS.md'),
    SAMPLE_PROGRESS.replace(`| 1 | User login | ${GLYPH.notStarted} |`, `| 1 | User login | ${GLYPH.done} |`),
    'utf8'
  );
}

function telemetry(dir) {
  const raw = fs.readFileSync(path.join(dir, '.claude', 'rajesh-devkit', 'telemetry.jsonl'), 'utf8');
  return raw.trim().split(/\r?\n/).map((l) => JSON.parse(l));
}

// --- parsing -----------------------------------------------------------------

test('with no JOURNEYS.md, hooks say nothing about journeys', () => {
  withProject(null, (dir) => {
    for (const r of [welcome(dir), prompt(dir, 'devkit continue'), stop(dir, { stop_hook_active: true })]) {
      assert.doesNotMatch(`${r.stdout}${r.stderr}`, /journey/i);
    }
    assert.doesNotMatch(stop(dir).stderr, /journey/i, 'the loop nudge changed');
  });
});

test('"journeys": false behaves as if the file were not there', () => {
  withProject(
    journey('J1', PASS),
    (dir) => {
      prompt(dir, 'devkit continue');
      assert.doesNotMatch(`${welcome(dir).stdout}${stop(dir).stderr}`, /journey/i);
      assert.doesNotMatch(stop(dir, { stop_hook_active: true }).stdout, /journey/i);
    },
    { files: { '.claude/devkit.json': JSON.stringify({ journeys: false }) } }
  );
});

test('a section missing a required field is invalid, and the others still work', () => {
  withProject(`## J1 No check\nFor: a person\nOutcome: something\n\n${journey('J2', PASS)}`, (dir) => {
    assert.deepStrictEqual(states(dir), { J1: 'invalid', J2: 'ready' });
  });
});

test('a duplicate id makes both invalid, since a proof could not say whose it is', () => {
  withProject(`${journey('J1', PASS)}\n${journey('J1', FAIL)}`, (dir) => {
    const out = JSON.parse(cli(dir, 'status', '--json').stdout);
    assert.deepStrictEqual(out.journeys.map((j) => j.state), ['invalid', 'invalid']);
  });
});

test('a heading that is not a journey is ignored', () => {
  withProject(`# Journeys\n\n## How to read this\nFor: nobody\n\n${journey('J1', PASS)}`, (dir) => {
    assert.deepStrictEqual(states(dir), { J1: 'ready' });
  });
});

// --- states ------------------------------------------------------------------

test('needs decide ready and blocked before any result exists', () => {
  withProject(`${journey('J1', PASS, 'Needs: M1\n')}\n${journey('J2', PASS)}`, (dir) => {
    assert.deepStrictEqual(states(dir), { J1: 'blocked', J2: 'ready' });
    tickM1(dir);
    assert.strictEqual(states(dir).J1, 'ready');
  });
});

test('exit 0 is proven, non-zero is failing, and the run reports it', () => {
  withProject(`${journey('J1', PASS)}\n${journey('J2', FAIL)}`, (dir) => {
    assert.strictEqual(cli(dir, 'run', 'J1').exitCode, 0);
    assert.strictEqual(cli(dir, 'run', 'J2').exitCode, 1);
    assert.deepStrictEqual(states(dir), { J1: 'proven', J2: 'failing' });
  });
});

test('a command that cannot run is unknown, never failing and never proven', () => {
  withProject(journey('J1', 'definitely-not-a-command-xyz --go'), (dir) => {
    assert.strictEqual(cli(dir, 'run', 'J1').exitCode, 1);
    assert.strictEqual(states(dir).J1, 'unknown');
  });
});

test('a timeout is unknown and leaves no child process behind', () => {
  const slow = [
    "const { spawn } = require('child_process');",
    "spawn(process.execPath, ['-e', \"setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 3000)\"], { stdio: 'ignore' });",
    'setTimeout(() => {}, 60000);',
  ].join('\n');
  withProject(
    journey('J1', 'node slow.js', 'Timeout: 1\n'),
    (dir) => {
      assert.strictEqual(cli(dir, 'run', 'J1').exitCode, 1);
      assert.strictEqual(states(dir).J1, 'unknown');
      spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 4000)']);
      assert.strictEqual(fs.existsSync(path.join(dir, 'late.txt')), false, 'the child outlived the timeout');
    },
    { files: { 'slow.js': slow } }
  );
});

test('changing source makes a proof stale', () => {
  withProject(journey('J1', PASS), (dir) => {
    cli(dir, 'run', 'J1');
    fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = 2;\n', 'utf8');
    assert.strictEqual(states(dir).J1, 'stale');
  });
});

test('ticking the tracker or editing JOURNEYS.md does not, even when staged', () => {
  withProject(journey('J1', PASS), (dir) => {
    cli(dir, 'run', 'J1');
    tickM1(dir);
    fs.appendFileSync(path.join(dir, 'JOURNEYS.md'), '\nA note for the reader.\n', 'utf8');
    assert.strictEqual(states(dir).J1, 'proven', 'unstaged');
    git(dir, 'add', 'PROGRESS.md', 'JOURNEYS.md');
    assert.strictEqual(states(dir).J1, 'proven', 'staged');
  });
});

test('a metrics record does not make a proof stale either', () => {
  withProject(journey('J1', PASS), (dir) => {
    cli(dir, 'run', 'J1');
    fs.mkdirSync(path.join(dir, 'docs', 'metrics'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'metrics', 'milestones.jsonl'), '{}\n', 'utf8');
    assert.strictEqual(states(dir).J1, 'proven');
  });
});

test('editing the check makes a proof stale', () => {
  withProject(journey('J1', PASS), (dir) => {
    cli(dir, 'run', 'J1');
    fs.writeFileSync(path.join(dir, 'JOURNEYS.md'), journey('J1', 'node pass.js --changed'), 'utf8');
    assert.strictEqual(states(dir).J1, 'stale');
  });
});

test('a check that dirties the tree cannot prove itself, and the run says why', () => {
  const dirty = "require('fs').writeFileSync('artifact.txt', String(Date.now()));";
  withProject(
    journey('J1', 'node dirty.js'),
    (dir) => {
      const r = cli(dir, 'run', 'J1');
      assert.match(`${r.stdout}${r.stderr}`, /changed the tree/);
      assert.strictEqual(states(dir).J1, 'stale');
    },
    { files: { 'dirty.js': dirty } }
  );
});

test('outside git a passing run reads stale, never proven', () => {
  withProject(
    journey('J1', PASS),
    (dir) => {
      assert.strictEqual(cli(dir, 'run', 'J1').exitCode, 0);
      assert.strictEqual(states(dir).J1, 'stale');
    },
    { repo: false }
  );
});

test('the first proof in a project does not go stale from its own bookkeeping', () => {
  // Found in a live run: the first write added the plugin's state folder to
  // .gitignore, which changed the tree the proof had just been stamped with.
  withProject(`${journey('J1', PASS)}\n${journey('J2', 'manual')}`, (dir) => {
    fs.rmSync(path.join(dir, '.gitignore'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'no ignore file');
    prompt(dir, 'devkit journey J2 passed');
    assert.strictEqual(states(dir).J2, 'accepted');
    cli(dir, 'run', 'J1');
    assert.deepStrictEqual(states(dir), { J1: 'proven', J2: 'accepted' });
  });
});

test('a result outranks the tracker, and an unknown Needs entry is named', () => {
  withProject(journey('J1', PASS, 'Needs: M1, M99\n'), (dir) => {
    cli(dir, 'run', 'J1');
    const j = JSON.parse(cli(dir, 'status', '--json').stdout).journeys[0];
    assert.strictEqual(j.state, 'proven');
    assert.deepStrictEqual(j.missing, ['M99']);
    assert.deepStrictEqual(j.unfinished, ['M1']);
  });
});

test('a corrupt proof file claims nothing', () => {
  withProject(journey('J1', PASS), (dir) => {
    cli(dir, 'run', 'J1');
    fs.writeFileSync(path.join(dir, '.claude', 'rajesh-devkit', 'journeys.json'), '{not json', 'utf8');
    assert.strictEqual(states(dir).J1, 'ready');
  });
});

// --- running -----------------------------------------------------------------

test('--needs runs only what names the milestone, and skips what is still blocked', () => {
  const text = [
    journey('J1', PASS, 'Needs: M1\n'),
    journey('J2', PASS, 'Needs: M1, M2\n'),
    journey('J3', PASS, 'Needs: M2\n'),
  ].join('\n');
  withProject(text, (dir) => {
    tickM1(dir);
    assert.strictEqual(cli(dir, 'run', '--needs', 'M1').exitCode, 0);
    assert.deepStrictEqual(states(dir), { J1: 'proven', J2: 'blocked', J3: 'blocked' });
  });
});

test('--all skips blocked journeys, but naming one runs it anyway', () => {
  withProject(`${journey('J1', PASS)}\n${journey('J2', PASS, 'Needs: M1\n')}`, (dir) => {
    cli(dir, 'run', '--all');
    assert.deepStrictEqual(states(dir), { J1: 'proven', J2: 'blocked' });
    cli(dir, 'run', 'J2');
    assert.strictEqual(states(dir).J2, 'proven');
  });
});

test('running an unknown id or a manual journey records nothing and says so', () => {
  withProject(journey('J1', 'manual'), (dir) => {
    assert.strictEqual(cli(dir, 'run', 'J9').exitCode, 2);
    const r = cli(dir, 'run', 'J1');
    assert.match(`${r.stdout}${r.stderr}`, /manual/);
    assert.strictEqual(states(dir).J1, 'ready');
  });
});

test('there is no command that records a pass without a run', () => {
  withProject(journey('J1', FAIL), (dir) => {
    for (const args of [['record', 'J1', 'pass'], ['stamp', 'J1'], ['accept', 'J1'], ['run', 'J1', '--pass']]) {
      cli(dir, ...args);
      assert.notStrictEqual(states(dir).J1, 'proven', args.join(' '));
      assert.notStrictEqual(states(dir).J1, 'accepted', args.join(' '));
    }
  });
});

test('check output is never stored', () => {
  const noisy = "console.log('SECRET-TOKEN-123'); console.error('SECRET-TOKEN-456');";
  withProject(
    journey('J1', 'node noisy.js'),
    (dir) => {
      const r = cli(dir, 'run', 'J1');
      assert.match(r.stdout, /SECRET-TOKEN-123/, 'stdout is not streamed');
      assert.match(r.stderr, /SECRET-TOKEN-456/, 'stderr is not streamed');
      const state = path.join(dir, '.claude', 'rajesh-devkit');
      for (const f of fs.readdirSync(state)) {
        assert.doesNotMatch(fs.readFileSync(path.join(state, f), 'utf8'), /SECRET-TOKEN/, f);
      }
    },
    { files: { 'noisy.js': noisy } }
  );
});

test('a run is logged without its command or output', () => {
  withProject(journey('J1', PASS), (dir) => {
    cli(dir, 'run', 'J1');
    const e = telemetry(dir).find((x) => x.event === 'journey_run');
    assert.strictEqual(e.id, 'J1');
    assert.strictEqual(e.state, 'proven');
    assert.doesNotMatch(JSON.stringify(e), /pass\.js/);
  });
});

test('no hook ever runs a check', () => {
  const marker = "require('fs').writeFileSync('ran.txt', 'x');";
  withProject(
    journey('J1', 'node mark.js', 'Needs: M1\n'),
    (dir) => {
      prompt(dir, 'devkit continue');
      welcome(dir);
      stop(dir);
      stop(dir, { stop_hook_active: true });
      prompt(dir, 'devkit journeys');
      track(dir);
      tickM1(dir);
      track(dir);
      runHook('write-resume.js', dir, JSON.stringify({ session_id: ME }));
      assert.strictEqual(fs.existsSync(path.join(dir, 'ran.txt')), false);
    },
    { files: { 'mark.js': marker } }
  );
});

// --- manual acceptance -------------------------------------------------------

test('only the user can accept a manual journey, and only at the start of a prompt', () => {
  withProject(`${journey('J1', 'manual')}\n${journey('J2', PASS)}`, (dir) => {
    prompt(dir, 'did devkit journey J1 passed yesterday?');
    prompt(dir, 'devkit journey J1 passed because I said so, ok');
    assert.strictEqual(states(dir).J1, 'ready', 'a sentence accepted it');

    const refused = JSON.parse(prompt(dir, 'devkit journey J2 passed').stdout);
    assert.strictEqual(refused.decision, 'block');
    assert.strictEqual(states(dir).J2, 'ready', 'a command-checked journey was accepted by hand');

    assert.strictEqual(JSON.parse(prompt(dir, 'devkit journey J1 passed').stdout).decision, 'block');
    assert.strictEqual(states(dir).J1, 'accepted');
    assert.ok(telemetry(dir).some((e) => e.event === 'journey_accepted' && e.id === 'J1'));

    fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = 2;\n', 'utf8');
    assert.strictEqual(states(dir).J1, 'stale', 'an acceptance outlived the code it saw');
  });
});

test('the keywords parse only as whole commands', () => {
  assert.deepStrictEqual(arm.parseCommand('devkit journeys'), { action: 'journeys' });
  assert.deepStrictEqual(arm.parseCommand('devkit journey J3 passed'), { action: 'journey-accept', id: 'J3' });
  assert.strictEqual(arm.parseCommand('devkit journeys draft'), null);
  assert.strictEqual(arm.parseCommand('devkit journey J3 passed but only on web'), null);
});

// --- what the user sees ------------------------------------------------------

test('devkit journeys costs no model turn and reports each journey and the closest', () => {
  withProject(`${journey('J1', PASS, 'Needs: M1, M2\n')}\n${journey('J2', PASS, 'Needs: M2\n')}`, (dir) => {
    const out = JSON.parse(prompt(dir, 'devkit journeys').stdout);
    assert.strictEqual(out.decision, 'block');
    assert.match(out.reason, /J1/);
    assert.match(out.reason, /Closest: J2/);
    assert.match(out.reason, /M2/);
  });
});

test('closest is the fewest unfinished needs, with ties to file order', () => {
  withProject(`${journey('J1', PASS, 'Needs: M1\n')}\n${journey('J2', PASS, 'Needs: M2\n')}`, (dir) => {
    assert.strictEqual(JSON.parse(cli(dir, 'status', '--json').stdout).closest.id, 'J1');
    cli(dir, 'run', 'J1');
    assert.strictEqual(JSON.parse(cli(dir, 'status', '--json').stdout).closest.id, 'J2');
  });
});

test('the banner counts real freshness', () => {
  withProject(`${journey('J1', PASS)}\n${journey('J2', PASS)}`, (dir) => {
    cli(dir, 'run', 'J1');
    assert.match(welcome(dir).stdout, /1 of 2 proven/);
    fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = 2;\n', 'utf8');
    assert.match(welcome(dir).stdout, /0 of 2 proven.*1 stale/);
  });
});

test('the status line counts last-run results and never says proven', () => {
  withProject(`${journey('J1', PASS)}\n${journey('J2', PASS)}`, (dir) => {
    prompt(dir, 'devkit continue');
    cli(dir, 'run', 'J1');
    fs.writeFileSync(path.join(dir, 'src.js'), 'module.exports = 2;\n', 'utf8');
    const line = JSON.parse(stop(dir, { stop_hook_active: true }).stdout).systemMessage;
    assert.match(line, /journeys 1\/2 passed at last run/);
    assert.doesNotMatch(line, /proven/);
  });
});

test('devkit continue on an unlinked milestone says so and still takes it', () => {
  withProject(journey('J1', PASS, 'Needs: M2\n'), (dir) => {
    const out = JSON.parse(prompt(dir, 'devkit continue').stdout);
    assert.match(out.systemMessage, /M1/);
    assert.match(out.systemMessage, /J1/);
    assert.match(out.systemMessage, /M2/);
    const armed = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'rajesh-devkit', 'loop-arm.json'), 'utf8'));
    assert.match(armed.sessions[ME].milestone, /^M1 /);
  });
});

test('devkit continue on a linked milestone adds no notice', () => {
  withProject(journey('J1', PASS, 'Needs: M1\n'), (dir) => {
    assert.strictEqual(JSON.parse(prompt(dir, 'devkit continue').stdout).systemMessage, undefined);
  });
});

// --- close-out ---------------------------------------------------------------

test('the close-out names the run step only for a linked milestone', () => {
  withProject(journey('J1', PASS, 'Needs: M1\n'), (dir) => {
    prompt(dir, 'devkit continue');
    assert.match(stop(dir).stderr, /journeys\.js" run --needs M1/);
  });
  withProject(journey('J1', PASS, 'Needs: M2\n'), (dir) => {
    prompt(dir, 'devkit continue');
    assert.doesNotMatch(stop(dir).stderr, /run --needs/);
  });
});

test('the ship step is given journey status when journeys exist', () => {
  withProject(journey('J1', PASS, 'Needs: M1\n'), (dir) => {
    prompt(dir, 'devkit continue');
    assert.match(stop(dir).stderr, /journeys\.js" status/);
  });
});

function finish(dir) {
  prompt(dir, 'devkit continue');
  track(dir); // baseline
  tickM1(dir);
  return track(dir);
}

test('a failing linked journey does not stop the row being ticked by default', () => {
  withProject(journey('J1', FAIL, 'Needs: M1\n'), (dir) => {
    cli(dir, 'run', 'J1');
    const r = finish(dir);
    assert.notStrictEqual(r.exitCode, 2, r.stderr);
  }, { files: { '.claude/devkit.json': JSON.stringify({ stages: ['implement'] }) } });
});

test('under journeyGate block, a linked journey that is not proven says do not close', () => {
  withProject(
    journey('J1', FAIL, 'Needs: M1\n'),
    (dir) => {
      cli(dir, 'run', 'J1');
      const r = finish(dir);
      assert.strictEqual(r.exitCode, 2);
      assert.match(r.stderr, /J1/);
      assert.match(r.stderr, /failing/);
    },
    { files: { '.claude/devkit.json': JSON.stringify({ stages: ['implement'], journeyGate: 'block' }) } }
  );
});

test('three failures on a milestone stop and ask, once, and continue clears it', () => {
  withProject(
    journey('J1', FAIL, 'Needs: M1\n'),
    (dir) => {
      prompt(dir, 'devkit continue');
      assert.doesNotMatch(`${cli(dir, 'run', '--needs', 'M1').stdout}`, /stop and ask/i);
      assert.doesNotMatch(`${cli(dir, 'run', '--needs', 'M1').stdout}`, /stop and ask/i);
      assert.match(cli(dir, 'run', '--needs', 'M1').stdout, /stop and ask/i);
      const r = stop(dir);
      assert.strictEqual(r.exitCode, 0, 'the loop kept pushing after the stop-and-ask');
      assert.strictEqual(r.stderr.trim(), '');
      prompt(dir, 'devkit continue');
      assert.strictEqual(stop(dir).exitCode, 2, 'devkit continue did not clear it');
    }
  );
});

test('a pass clears the failure count', () => {
  withProject(journey('J1', 'node maybe.js', 'Needs: M1\n'), (dir) => {
    const write = (code) => fs.writeFileSync(path.join(dir, 'maybe.js'), `process.exit(${code});\n`, 'utf8');
    prompt(dir, 'devkit continue');
    write(1);
    cli(dir, 'run', '--needs', 'M1');
    cli(dir, 'run', '--needs', 'M1');
    write(0);
    cli(dir, 'run', '--needs', 'M1');
    write(1);
    assert.doesNotMatch(cli(dir, 'run', '--needs', 'M1').stdout, /stop and ask/i);
  }, { files: { 'maybe.js': 'process.exit(0);\n' } });
});

test('an unlinked finished milestone is logged and raised once', () => {
  withProject(journey('J1', PASS, 'Needs: M2\n'), (dir) => {
    const r = finish(dir);
    assert.match(`${r.stdout}${r.stderr}`, /no journey/i);
    assert.strictEqual(telemetry(dir).filter((e) => e.event === 'journey_unlinked').length, 1);
    const again = track(dir);
    assert.doesNotMatch(`${again.stdout}${again.stderr}`, /no journey/i);
  }, { files: { '.claude/devkit.json': JSON.stringify({ stages: ['implement'] }) } });
});

test('a session not on the loop is never asked', () => {
  withProject(journey('J1', PASS, 'Needs: M2\n'), (dir) => {
    track(dir);
    tickM1(dir);
    const r = track(dir);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /journey/i);
  });
});

// --- receipt -----------------------------------------------------------------

const RECORD = {
  milestone: 'M1',
  name: 'User login',
  primaryModel: 'm',
  costUsd: 1,
  activeHours: 1,
  gates: {},
  devkit: null,
};

test('the receipt says what a milestone moved, or that it moved none', () => {
  const moved = receipt.format({ ...RECORD, journeys: { moved: [{ id: 'J1', state: 'proven' }] } });
  assert.match(moved, /Journeys\s+moved J1 \(proven\)/);
  assert.match(receipt.format({ ...RECORD, journeys: { moved: [] } }), /Journeys\s+moved none/);
});

test('a record from before journeys says nothing, rather than none', () => {
  assert.doesNotMatch(receipt.format(RECORD), /Journeys/);
  assert.strictEqual(receipt.journeyCell(RECORD), '');
  assert.strictEqual(receipt.journeyCell({ ...RECORD, journeys: { moved: [] } }), 'none');
});

// --- generic use (PRINCIPLES 1) ----------------------------------------------

test('a library with one consumer journey and no UI works end to end', () => {
  const progress = ['# Progress', '', '| # | Milestone | Status |', '|---|-----------|--------|', `| 1 | Publish | ${GLYPH.done} |`, ''].join('\n');
  const consumer = "const lib = require('./src.js'); process.exit(lib === 1 ? 0 : 1);";
  withProject(
    '## J1 A consumer installs it and calls it\nFor: a developer\nOutcome: The call returns the documented value.\nNeeds: M1\nCheck: node consumer.js\n',
    (dir) => {
      assert.strictEqual(states(dir).J1, 'ready');
      assert.strictEqual(cli(dir, 'run', '--all').exitCode, 0);
      assert.strictEqual(states(dir).J1, 'proven');
    },
    { progress, files: { 'consumer.js': consumer } }
  );
});

test('the plugin assumes no project, stack or surface', () => {
  const lib = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'journeys.js'), 'utf8');
  const cliSource = fs.readFileSync(path.join(PLUGIN_ROOT, 'scripts', 'journeys.js'), 'utf8');
  const skill = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'devkit-journeys', 'SKILL.md'), 'utf8');
  for (const text of [lib, cliSource, skill]) assert.doesNotMatch(text, /MyHomeMaintenance|flutter|playwright/i);
});
