'use strict';

// A hook waits on git, and git can wait on something else. Found on Windows: a
// system gitconfig set core.fsmonitor and a `git add -A` waited 40 minutes on the
// file-watcher daemon. These make git hang on purpose - an fsmonitor hook that
// sleeps - and assert that the hook still finishes, answering "cannot tell".

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, SAMPLE_PROGRESS, newFixture, removeFixture, runHook } = require('./helpers');

// Long enough to mean "stuck", short enough that a hung run fails the test
// rather than hanging the suite.
const GIVE_UP_MS = 20000;
const LIMIT_MS = 1500;

function hungGitEnv(dir) {
  // helpers.js already appended fsmonitor=false; a later entry wins.
  const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
  return {
    ...process.env,
    CLAUDE_PROJECT_DIR: dir,
    RAJESH_DEVKIT_GIT_TIMEOUT_MS: String(LIMIT_MS),
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: 'core.fsmonitor',
    [`GIT_CONFIG_VALUE_${n}`]: 'sleep 60',
  };
}

function withRepo(fn) {
  const dir = newFixture({
    progress: SAMPLE_PROGRESS,
    specs: { 'user-login.md': 'Status: Approved\n\nMilestone: 1\n\n- [x] a\n- [ ] b\n' },
  });
  try {
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'init');
    return fn(dir);
  } finally {
    removeFixture(dir);
  }
}

function timed(args, dir, input = '') {
  const started = Date.now();
  const r = spawnSync(process.execPath, args, {
    input,
    encoding: 'utf8',
    env: hungGitEnv(dir),
    timeout: GIVE_UP_MS,
  });
  return { ...r, ms: Date.now() - started };
}

test('a fingerprint gives up on a hung git and reports it cannot tell', () => {
  withRepo((dir) => {
    const script = `const g = require(${JSON.stringify(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'gates.js'))});` +
      `process.stdout.write(String(g.treeFingerprint(${JSON.stringify(dir)})));`;
    const r = timed(['-e', script], dir);
    assert.ok(r.error == null && r.status === 0, `still waiting after ${r.ms} ms`);
    assert.strictEqual(r.stdout, 'null', 'a tree git could not read must never be fingerprinted');
  });
});

test('the edit hook finishes when git hangs', () => {
  withRepo((dir) => {
    runHook('loop-command.js', dir, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'devkit continue' }));
    const input = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'PROGRESS.md') } });
    const r = timed([path.join(PLUGIN_ROOT, 'scripts', 'write-resume.js')], dir, input);
    assert.ok(r.error == null, `still waiting after ${r.ms} ms`);
    assert.strictEqual(r.status, 0);
  });
});

test('the end-of-turn hook finishes when git hangs', () => {
  withRepo((dir) => {
    runHook('loop-command.js', dir, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'devkit continue' }));
    const input = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', stop_hook_active: true });
    const r = timed([path.join(PLUGIN_ROOT, 'scripts', 'continue-loop.js')], dir, input);
    assert.ok(r.error == null, `still waiting after ${r.ms} ms`);
    assert.ok(r.ms < GIVE_UP_MS / 2, `took ${r.ms} ms`);
  });
});
