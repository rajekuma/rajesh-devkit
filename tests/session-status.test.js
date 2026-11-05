'use strict';

// What the user is shown about a session: when it was last worked, on what, and
// whether it is the latest window. Run as the harness runs hooks, and asserting
// on the JSON fields the harness acts on, not on how the text is worded.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SAMPLE_PROGRESS, GLYPH, newFixture, removeFixture, runHook } = require('./helpers');

const ME = 'session-me-0001';
const OTHER = 'session-other-02';

function withProject(fn, { files } = {}) {
  const dir = newFixture({
    progress: SAMPLE_PROGRESS,
    specs: { 'user-login.md': 'Status: Approved\n\n- [x] a\n- [ ] b\n- [ ] c\n' },
    files,
  });
  try {
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

const prompt = (dir, text, extra = {}, sid = ME) =>
  runHook(
    'loop-command.js',
    dir,
    JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: text, ...extra })
  );
const stop = (dir, extra = {}, sid = ME) =>
  runHook('continue-loop.js', dir, JSON.stringify({ hook_event_name: 'Stop', session_id: sid, ...extra }));
const start = (dir, source, extra = {}, sid = ME) =>
  runHook('session-welcome.js', dir, JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source, ...extra }));
const json = (r) => JSON.parse(r.stdout);
// A hook with no title to set answers in plain text, which is not JSON.
const titleIn = (r) => (r.stdout.trim().startsWith('{') ? json(r).hookSpecificOutput.sessionTitle : undefined);

function finishMilestoneOne(dir) {
  fs.writeFileSync(
    path.join(dir, 'PROGRESS.md'),
    SAMPLE_PROGRESS.replace(`| 1 | User login | ${GLYPH.notStarted} |`, `| 1 | User login | ${GLYPH.done} |`),
    'utf8'
  );
}

function setRegistry(dir, sessions) {
  const file = path.join(dir, '.claude', 'rajesh-devkit', 'sessions.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions }), 'utf8');
}

function registry(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'rajesh-devkit', 'sessions.json'), 'utf8')).sessions;
}

test('a session that never ran the loop is shown nothing and retitled nothing', () => {
  withProject((dir) => {
    assert.strictEqual(stop(dir).stdout.trim(), '');
    assert.strictEqual(prompt(dir, 'fix the typo').stdout.trim(), '');
    assert.strictEqual(start(dir, 'resume').stdout.trim(), '');
    assert.strictEqual(fs.existsSync(path.join(dir, '.claude', 'rajesh-devkit', 'sessions.json')), false);
  });
});

test('a real end of turn shows the date, the milestone and how far it got', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    // stop_hook_active is the stop after a nudge, the one that ends the turn.
    const message = json(stop(dir, { stop_hook_active: true })).systemMessage;
    const today = new Date();
    const y = today.getFullYear();
    assert.ok(message.includes(String(y)), `no date in: ${message}`);
    assert.match(message, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assert.match(message, /M1 - User login/);
    assert.match(message, /1\/3/);
  });
});

test('a stop the loop turns into another step shows no status line', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    const r = stop(dir);
    assert.strictEqual(r.exitCode, 2);
    assert.strictEqual(r.stdout.trim(), '');
  });
});

test('a finished milestone says so and names what is next', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    finishMilestoneOne(dir);
    const message = json(stop(dir)).systemMessage;
    assert.match(message, /M1 - User login \| done/);
    assert.match(message, /next: M2 - Password reset/);
  });
});

test('a paused session is not reported as working', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    prompt(dir, 'devkit pause');
    assert.match(json(stop(dir)).systemMessage, /paused/);
  });
});

test('devkit continue names the session after its milestone, and still briefs the model', () => {
  withProject((dir) => {
    const out = json(prompt(dir, 'devkit continue')).hookSpecificOutput;
    assert.strictEqual(out.sessionTitle, 'M1 User login');
    assert.match(out.additionalContext, /loop started/);
  });
});

test('the title catches up on the next prompt, once', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    finishMilestoneOne(dir);
    stop(dir);
    const r = prompt(dir, 'what now?', { session_title: 'M1 User login' });
    assert.strictEqual(titleIn(r), 'M1 done, next M2');
    assert.strictEqual(prompt(dir, 'and then?', { session_title: 'M1 done, next M2' }).stdout.trim(), '');
  });
});

test('a title the user chose is never overwritten', () => {
  withProject((dir) => {
    const named = { session_title: 'my billing work' };
    assert.strictEqual(titleIn(prompt(dir, 'devkit continue', named)), undefined);
    finishMilestoneOne(dir);
    stop(dir);
    assert.strictEqual(prompt(dir, 'what now?', named).stdout.trim(), '');
  });
});

test('a resume says how long ago, and warns when another session is more recent', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    const lastAt = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 3600 * 1000).toISOString();
    setRegistry(dir, {
      [ME]: { lastAt, milestone: 'M1 - User login', titleSet: 'M1 User login' },
      [OTHER]: { lastAt: recent, milestone: 'M2 - Password reset', titleSet: 'M2 Password reset' },
    });
    const message = json(start(dir, 'resume', { session_title: 'M1 User login' })).systemMessage;
    assert.match(message, /7 days/);
    assert.match(message, /M2 Password reset/);
  });
});

test('the latest session is not told it is out of date', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    assert.doesNotMatch(json(start(dir, 'resume')).systemMessage, /not the latest/);
  });
});

test('a compaction reminds the model and leaves the user and the title alone', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    const out = json(start(dir, 'compact'));
    assert.strictEqual(out.systemMessage, undefined);
    assert.strictEqual(out.hookSpecificOutput.sessionTitle, undefined);
    assert.match(out.hookSpecificOutput.additionalContext, /M1 - User login/);
  });
});

test('devkit sessions lists newest first without reaching the model', () => {
  withProject((dir) => {
    setRegistry(dir, {
      old: { lastAt: new Date(Date.now() - 9 * 86400000).toISOString(), titleSet: 'old one', milestone: 'M1 - A' },
      fresh: { lastAt: new Date(Date.now() - 3600000).toISOString(), titleSet: 'fresh one', milestone: 'M2 - B' },
    });
    const out = json(prompt(dir, 'devkit sessions', {}, 'fresh'));
    assert.strictEqual(out.decision, 'block');
    assert.ok(out.reason.indexOf('fresh one') < out.reason.indexOf('old one'));
    assert.match(out.reason, /this session/);
  });
});

test('a sentence that only mentions devkit status still reaches the model', () => {
  withProject((dir) => {
    assert.strictEqual(prompt(dir, 'devkit status of the login spec?').stdout.trim(), '');
    assert.strictEqual(prompt(dir, 'devkit status').exitCode, 0);
    assert.strictEqual(json(prompt(dir, 'devkit status')).decision, 'block');
  });
});

test('sessionStatus false turns off the line, the title and the registry', () => {
  withProject(
    (dir) => {
      assert.match(prompt(dir, 'devkit continue').stdout, /loop started/);
      assert.strictEqual(titleInPlain(prompt(dir, 'devkit pause')), true);
      assert.strictEqual(stop(dir, { stop_hook_active: true }).stdout.trim(), '');
      assert.strictEqual(fs.existsSync(path.join(dir, '.claude', 'rajesh-devkit', 'sessions.json')), false);
    },
    { files: { '.claude/devkit.json': JSON.stringify({ sessionStatus: false }) } }
  );
});

function titleInPlain(r) {
  return !r.stdout.includes('sessionTitle');
}

test('a corrupt registry never breaks a hook', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    fs.writeFileSync(path.join(dir, '.claude', 'rajesh-devkit', 'sessions.json'), '{not json', 'utf8');
    assert.strictEqual(stop(dir, { stop_hook_active: true }).exitCode, 0);
    assert.strictEqual(prompt(dir, 'hello').exitCode, 0);
    assert.strictEqual(start(dir, 'resume').exitCode, 0);
    assert.strictEqual(json(prompt(dir, 'devkit sessions')).decision, 'block');
  });
});

test('an unwritable state directory never breaks a hook', () => {
  withProject((dir) => {
    fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
    fs.writeFileSync(path.join(dir, '.claude'), 'a file where the directory belongs', 'utf8');
    assert.strictEqual(prompt(dir, 'devkit continue').exitCode, 0);
    assert.ok([0, 2].includes(stop(dir).exitCode));
  });
});

test('an edit moves the last-worked date only for a session already on the loop', () => {
  withProject((dir) => {
    prompt(dir, 'devkit continue');
    const old = new Date(Date.now() - 86400000).toISOString();
    setRegistry(dir, { [ME]: { lastAt: old, milestone: 'M1 - User login' } });
    runHook('write-resume.js', dir, JSON.stringify({ session_id: ME }));
    runHook('write-resume.js', dir, JSON.stringify({ session_id: OTHER }));
    const after = registry(dir);
    assert.ok(Date.parse(after[ME].lastAt) > Date.parse(old));
    assert.strictEqual(after[OTHER], undefined);
  });
});

test('linked worktrees share one registry, which outlives the worktree', () => {
  const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  withProject((dir) => {
    if (git(dir, 'init', '-q').status !== 0) return;
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'test');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    const lane = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-lane-')), 'lane');
    assert.strictEqual(git(dir, 'worktree', 'add', '-q', lane).status, 0);
    try {
      prompt(lane, 'devkit continue', {}, OTHER);
      assert.ok(fs.existsSync(path.join(dir, '.git', 'rajesh-devkit', 'sessions.json')));
      git(dir, 'worktree', 'remove', '--force', lane);
      assert.match(json(prompt(dir, 'devkit sessions')).reason, /M1 User login/);
      // In the git directory, so nothing about it can show up as a change.
      assert.strictEqual(git(dir, 'status', '--porcelain').stdout.includes('sessions.json'), false);
    } finally {
      fs.rmSync(path.dirname(lane), { recursive: true, force: true });
    }
  });
});
