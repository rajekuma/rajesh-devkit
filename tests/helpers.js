'use strict';

// Shared fixtures for the regression suite. Nothing here touches the real
// repo or any real host project - every fixture is a throwaway directory
// under the OS temp dir, removed after the test that made it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');

// Glyphs as escapes, so these test sources stay pure ASCII for the same
// reason the hooks do - see scripts/lib/devkit.js.
const GLYPH = {
  notStarted: '\u{2B1C}',
  done: '\u{2705}',
  lock: '\u{1F512}',
  vs16: '\u{FE0F}',
};

const SAMPLE_PROGRESS = [
  '# Progress',
  '',
  '| # | Milestone | Status |',
  '|---|-----------|--------|',
  `| 1 | User login | ${GLYPH.notStarted} |`,
  `| 2 | Password reset | ${GLYPH.notStarted} |`,
  '',
].join('\n');

function newFixture({ progress, specs, ownLoopSkill = false, files } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-test-'));
  if (progress) fs.writeFileSync(path.join(dir, 'PROGRESS.md'), progress, 'utf8');
  if (specs) {
    const specsDir = path.join(dir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    for (const [name, content] of Object.entries(specs)) {
      fs.writeFileSync(path.join(specsDir, name), content, 'utf8');
    }
  }
  if (ownLoopSkill) {
    const skillDir = path.join(dir, '.claude', 'skills', 'spec-loop');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# own loop\n', 'utf8');
  }
  if (files) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
  }
  return dir;
}

// Also clears the per-project nudge state this fixture may have created in
// the temp dir, so a repeat run of the suite starts from the same slate.
function removeFixture(dir) {
  const hash = crypto.createHash('md5').update(dir, 'utf8').digest('hex').toUpperCase();
  try {
    fs.rmSync(path.join(os.tmpdir(), 'rajesh-devkit-continue-loop', `${hash}.json`), { force: true });
  } catch {
    /* nothing to clean */
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort - a fixture left behind is noise, not a failure */
  }
}

// Runs a hook the way the harness does: a separate process, stdin fed a JSON
// payload, stdout/stderr/exit code captured separately. Exit 2 plus the right
// stderr text IS this plugin's contract, so testing the contract this way
// survives refactoring in a way that testing internals would not.
function runHook(script, projectDir, stdinJson = '{}') {
  const result = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'scripts', script)], {
    input: stdinJson,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function exists(...parts) {
  return fs.existsSync(path.join(...parts));
}

function read(...parts) {
  try {
    return fs.readFileSync(path.join(...parts), 'utf8');
  } catch {
    return null;
  }
}

module.exports = {
  PLUGIN_ROOT,
  GLYPH,
  SAMPLE_PROGRESS,
  newFixture,
  removeFixture,
  runHook,
  exists,
  read,
};
