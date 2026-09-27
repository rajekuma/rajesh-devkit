'use strict';

// Onboarding and stage presets: the first thing a new user of the plugin
// meets. The starter files are copied by scripts/scaffold.js rather than
// retyped by a model, so the one promise that matters in someone else's
// project - never overwrite a file - is a tested fact, not an instruction.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT, GLYPH, SAMPLE_PROGRESS, newFixture, removeFixture, runHook, read } = require('./helpers');
const d = require('../scripts/lib/devkit');

const SCAFFOLD = path.join(PLUGIN_ROOT, 'scripts', 'scaffold.js');

function scaffold(dir, ...args) {
  const r = spawnSync(process.execPath, [SCAFFOLD, dir, ...args], { encoding: 'utf8' });
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function withEmpty(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-onboard-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// scaffold.js
// ---------------------------------------------------------------------------

test('scaffold lays down every starter file in an empty project', () => {
  withEmpty((dir) => {
    const r = scaffold(dir);
    assert.strictEqual(r.exitCode, 0, r.stderr);
    for (const f of [
      'CLAUDE.md',
      'PROGRESS.md',
      '.gitattributes',
      'docs/product_vision.md',
      'docs/adr/0000-template.md',
      'docs/adr/0001-record-architecture-decisions.md',
      'specs/_template.md',
      '.claude/rules/testing.md',
      '.claude/rules/architecture.md',
      '.claude/rules/conventions.md',
      '.claude/rules/workflow.md',
    ]) {
      assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
    }
  });
});

test('scaffold never overwrites a file that already exists', () => {
  withEmpty((dir) => {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'my own rules\n', 'utf8');
    const r = scaffold(dir, '--items', 'claude-md,progress');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'my own rules\n');
    assert.match(r.stdout, /kept\s+CLAUDE\.md/);
    assert.ok(fs.existsSync(path.join(dir, 'PROGRESS.md')), 'did not create the missing one');
  });
});

test('a scaffolded PROGRESS.md is one the loop can read', () => {
  // Otherwise onboarding hands the user a tracker every hook ignores.
  withEmpty((dir) => {
    scaffold(dir, '--items', 'progress');
    const m = d.findNextMilestone(path.join(dir, 'PROGRESS.md'), null, { phase: '1' });
    assert.ok(m, 'the template tracker has no row the loop can see');
    assert.strictEqual(m.number, '1');
  });
});

test('scaffold writes the chosen preset, and refuses an unknown one or item', () => {
  withEmpty((dir) => {
    scaffold(dir, '--items', 'claude-md', '--preset', 'ui');
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'devkit.json'), 'utf8'));
    assert.strictEqual(cfg.preset, 'ui');
    assert.deepStrictEqual(d.readStageConfig(dir).stages, d.STAGE_PRESETS.ui);
  });
  withEmpty((dir) => {
    assert.strictEqual(scaffold(dir, '--preset', 'wizard').exitCode, 1);
    assert.strictEqual(scaffold(dir, '--items', 'bogus').exitCode, 1);
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'wrote something despite refusing');
  });
});

test('scaffold --git-init makes a repository, once', () => {
  withEmpty((dir) => {
    const first = scaffold(dir, '--git-init', '--items', 'gitattributes');
    assert.match(first.stdout, /git init/);
    assert.ok(fs.existsSync(path.join(dir, '.git')));
    assert.match(scaffold(dir, '--git-init', '--items', 'gitattributes').stdout, /already initialised/);
  });
});

test('templates never ship under names Claude Code would load as live rules', () => {
  // A CLAUDE.md or a .claude/rules/ inside the plugin's own tree would be
  // loaded as instructions whenever someone works on the plugin itself.
  const walk = (p) =>
    fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [e.name, ...walk(path.join(p, e.name))] : [e.name]));
  const names = walk(path.join(PLUGIN_ROOT, 'templates'));
  assert.ok(!names.includes('CLAUDE.md'), 'templates/ contains a CLAUDE.md');
  assert.ok(!names.includes('.claude'), 'templates/ contains a .claude folder');
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

test('a preset in devkit.json sets the stages; an explicit list wins over it', () => {
  const withCfg = (cfg, fn) => {
    const dir = newFixture({ files: { '.claude/devkit.json': JSON.stringify(cfg) } });
    try {
      return fn(d.readStageConfig(dir));
    } finally {
      removeFixture(dir);
    }
  };
  withCfg({ preset: 'api' }, (c) => assert.deepStrictEqual(c.stages, d.STAGE_PRESETS.api));
  withCfg({ preset: 'api', stages: ['specify', 'docs'] }, (c) => assert.deepStrictEqual(c.stages, ['specify', 'docs']));
  withCfg({ preset: 'nonsense' }, (c) => assert.deepStrictEqual(c.stages, d.DEFAULT_STAGES));
});

test('the ui preset keeps the implementer and drops data-model planning', () => {
  // The implementer implements whatever the spec describes, in the
  // project's own stack - in a UI lane, the screens.
  assert.ok(d.STAGE_PRESETS.ui.includes('implement'));
  assert.ok(d.STAGE_PRESETS.ui.includes('ux') && d.STAGE_PRESETS.ui.includes('ui-verify'));
  assert.ok(!d.STAGE_PRESETS.ui.includes('datamodel'));
});

const READY = '# Spec: User login\n\nMilestone: 1\n\n## Acceptance criteria\n\n- [ ] It works\n';

test('devkit continue ... as ui runs this session as a UI lane only', () => {
  const dir = newFixture({ progress: SAMPLE_PROGRESS, specs: { 'user-login.md': READY, 'user-login.ux.md': '# UX\n' } });
  try {
    const sid = JSON.stringify({ session_id: 'ui-lane', prompt: 'devkit continue as ui' });
    const started = runHook('loop-command.js', dir, sid);
    assert.match(started.stdout, /Stages for this session/);
    const r = runHook('continue-loop.js', dir, JSON.stringify({ session_id: 'ui-lane' }));
    assert.match(r.stderr, /devkit-ui-verify/);
    assert.doesNotMatch(r.stderr, /devkit-datamodel/, 'a UI lane was sent to data-model planning');
    // Another session in the same project keeps the project's own stages.
    runHook('loop-command.js', dir, JSON.stringify({ session_id: 'other', prompt: 'devkit continue' }));
    // (The other session collides on the same milestone, which is fine here:
    // what matters is that the project config itself was not changed.)
    assert.strictEqual(fs.existsSync(path.join(dir, '.claude', 'devkit.json')), false);
  } finally {
    removeFixture(dir);
  }
});

test('an unknown preset starts nothing', () => {
  const dir = newFixture({ progress: SAMPLE_PROGRESS });
  try {
    const r = runHook('loop-command.js', dir, JSON.stringify({ session_id: 'x', prompt: 'devkit continue as wizard' }));
    assert.match(r.stdout, /not a stage preset/);
    assert.strictEqual(runHook('continue-loop.js', dir, JSON.stringify({ session_id: 'x' })).exitCode, 0);
  } finally {
    removeFixture(dir);
  }
});

// ---------------------------------------------------------------------------
// The first-run banner
// ---------------------------------------------------------------------------

test('an empty folder is greeted with the guided onboarding', () => {
  const dir = newFixture({});
  try {
    const r = runHook('session-welcome.js', dir, JSON.stringify({ source: 'startup' }));
    assert.match(r.stdout, /new, empty project/);
    assert.match(r.stdout, /devkit onboard/);
  } finally {
    removeFixture(dir);
  }
});

test('an existing codebase without a tracker is pointed at onboarding too', () => {
  const dir = newFixture({ files: { 'src/app.js': 'module.exports = 1;\n' } });
  try {
    const r = runHook('session-welcome.js', dir, JSON.stringify({ source: 'startup' }));
    assert.doesNotMatch(r.stdout, /new, empty project/);
    assert.match(r.stdout, /no PROGRESS\.md yet/);
    assert.match(r.stdout, /devkit onboard/);
  } finally {
    removeFixture(dir);
  }
});
