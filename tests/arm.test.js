'use strict';

// Starting and stopping the loop: `devkit continue` / `devkit pause`.
//
// Found in real use: after a milestone ended, a new session opened for other
// work was asked at every stop which of two sessions owned the next
// milestone. Every session drove the loop and every session claimed the next
// milestone just by existing, so an idle session and a real one reported each
// other. These run the hooks as real processes with real session ids.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { GLYPH, SAMPLE_PROGRESS, newFixture, removeFixture, runHook, read } = require('./helpers');
const { writeLease } = require('./lease-fixtures');

const ME = 'session-me-0001';
const READY_SPEC = '# Spec: User login\n\nMilestone: 1\n\n## Acceptance criteria\n\n- [ ] It works\n';

function withProject(fn, { config } = {}) {
  const files = config ? { '.claude/devkit.json': JSON.stringify(config) } : {};
  const dir = newFixture({
    progress: SAMPLE_PROGRESS,
    specs: { 'user-login.md': READY_SPEC, 'user-login.ux.md': '# UX\n' },
    files,
  });
  try {
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

const stop = (dir, sid = ME) => runHook('continue-loop.js', dir, JSON.stringify({ session_id: sid }));
const say = (dir, prompt, sid = ME) => runHook('loop-command.js', dir, JSON.stringify({ session_id: sid, prompt }));

function leaseHolders(dir) {
  const raw = read(dir, '.claude', 'rajesh-devkit', 'session-lease.json');
  return raw ? JSON.parse(raw).leases.map((l) => l.sessionId) : [];
}

function finishMilestoneOne(dir) {
  const done = SAMPLE_PROGRESS.replace(`| 1 | User login | ${GLYPH.notStarted} |`, `| 1 | User login | ${GLYPH.done} |`);
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), done, 'utf8');
}

test('a session nobody started the loop in is never nudged', () => {
  withProject((dir) => {
    const r = stop(dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stderr.trim(), '', `nudged an idle session: ${r.stderr}`);
  });
});

test('an idle session is not asked about another session that holds the milestone', () => {
  // The reported case, exactly: a live, driving session holds M1, and a
  // session opened for other work stops. It must say nothing at all.
  withProject((dir) => {
    writeLease(dir);
    const r = stop(dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stderr.trim(), '', `asked an idle session about a collision: ${r.stderr}`);
  });
});

test('an idle session claims no milestone, whatever hooks it fires', () => {
  withProject((dir) => {
    runHook('session-welcome.js', dir, JSON.stringify({ session_id: ME, source: 'startup' }));
    runHook('write-resume.js', dir, JSON.stringify({ session_id: ME }));
    stop(dir);
    assert.ok(!leaseHolders(dir).includes(ME), 'an idle session published a claim');
  });
});

test('devkit continue starts the loop and says what to do first', () => {
  withProject((dir) => {
    const r = say(dir, 'devkit continue');
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.stdout, /M1 - User login/);
    assert.match(r.stdout, /devkit-reviewer/, `no first step handed over: ${r.stdout}`);
    const s = stop(dir);
    assert.strictEqual(s.exitCode, 2, 'the Stop hook did not drive an armed session');
  });
});

test('an armed session stops by itself when its milestone ships', () => {
  // The next milestone waits for the user to say so: that is the moment a
  // human looks at what just shipped.
  withProject((dir) => {
    say(dir, 'devkit continue');
    finishMilestoneOne(dir);
    const r = stop(dir);
    assert.strictEqual(r.exitCode, 0, `drove on into M2 unasked: ${r.stderr}`);
  });
});

test('devkit continue all keeps going through the queue', () => {
  withProject((dir) => {
    say(dir, 'devkit continue all');
    finishMilestoneOne(dir);
    const r = stop(dir);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /M2 - Password reset/);
  });
});

test('devkit pause stops the loop and drops the claim', () => {
  withProject((dir) => {
    say(dir, 'devkit continue');
    stop(dir);
    assert.ok(leaseHolders(dir).includes(ME), 'a driving session should hold its milestone');
    const r = say(dir, 'devkit pause');
    assert.match(r.stdout, /paused/i);
    assert.ok(!leaseHolders(dir).includes(ME), 'a paused session still claims the milestone');
    assert.strictEqual(stop(dir).exitCode, 0, 'still nudged after pause');
  });
});

test('mentioning the keywords mid-sentence changes nothing', () => {
  withProject((dir) => {
    const r = say(dir, 'why did devkit continue not pick up M1?');
    assert.strictEqual(r.stdout.trim(), '');
    assert.strictEqual(stop(dir).exitCode, 0);
  });
});

test('arming one session does not arm another', () => {
  withProject((dir) => {
    say(dir, 'devkit continue', 'session-a');
    assert.strictEqual(stop(dir, 'session-b').exitCode, 0);
  });
});

test('"loopStart": "always" drives every session, as before 0.7', () => {
  withProject(
    (dir) => {
      assert.strictEqual(stop(dir).exitCode, 2);
    },
    { config: { loopStart: 'always' } }
  );
});

test('a corrupt arm file leaves the loop idle rather than crashing', () => {
  withProject((dir) => {
    const stateDir = path.join(dir, '.claude', 'rajesh-devkit');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'loop-arm.json'), '{ nope', 'utf8');
    const r = stop(dir);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stderr.trim(), '');
  });
});

test('the banner tells a new session how to start the loop, and does not start it', () => {
  withProject((dir) => {
    const r = runHook('session-welcome.js', dir, JSON.stringify({ session_id: ME, source: 'startup' }));
    assert.match(r.stdout, /devkit continue/);
    assert.match(r.stdout, /devkit pause/);
    assert.doesNotMatch(r.stdout, /keep working/i, `still reads as an instruction to start: ${r.stdout}`);
  });
});

test('the loop keywords do nothing in a project that runs its own loop', () => {
  const dir = newFixture({ progress: SAMPLE_PROGRESS, ownLoopSkill: true });
  try {
    const r = say(dir, 'devkit continue');
    assert.match(r.stdout, /own loop/);
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'rajesh-devkit', 'loop-arm.json')));
  } finally {
    removeFixture(dir);
  }
});
