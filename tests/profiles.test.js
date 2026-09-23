'use strict';

// The provider launcher, profiles/devkit.js. It replaced two shell scripts
// (devkit-env.ps1 / .sh) after they failed on a real Windows machine: an
// AllSigned execution policy refused the .ps1, npm's claude.ps1 shim was
// refused after it, and hand-typed `$env:` lines in a cmd.exe window silently
// sent the "OpenRouter" test to the subscription. These run the launcher as a
// real process with a fake claude (DEVKIT_CLAUDE_BIN) that reports back the
// environment and arguments it was actually started with - because what
// claude receives is the whole contract.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT } = require('./helpers');

const LAUNCHER = path.join(PLUGIN_ROOT, 'profiles', 'devkit.js');
const KEY = 'sk-or-v1-test-0123456789abcdef';

function withFakeClaude(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-launcher-'));
  const report = path.join(dir, 'report.json');
  const fake = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(
    fake,
    `require('fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify({ env: process.env, argv: process.argv.slice(2) }));\n` +
      'process.exit(7);\n',
    'utf8'
  );
  try {
    return fn({ dir, fake, report: () => JSON.parse(fs.readFileSync(report, 'utf8')) });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// A fresh HOME per run, so a real ~/.devkit key file on the machine running
// the suite can never leak into, or satisfy, a test.
function launch(args, { env = {}, home } = {}) {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (k.startsWith('ANTHROPIC_') || k === 'OPENROUTER_API_KEY') delete base[k];
  const r = spawnSync(process.execPath, [LAUNCHER, ...args], {
    encoding: 'utf8',
    env: { ...base, HOME: home, USERPROFILE: home, ...env },
  });
  return { exitCode: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('claude is started with the profile environment, and its exit code comes back', () => {
  withFakeClaude(({ dir, fake, report }) => {
    const r = launch(['openrouter', '-p', 'say pong'], {
      home: dir,
      env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY },
    });
    assert.strictEqual(r.exitCode, 7, `launcher swallowed claude's exit code: ${r.stderr}`);
    const got = report();
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'profiles', 'openrouter.json'), 'utf8'));
    assert.strictEqual(got.env.ANTHROPIC_BASE_URL, cfg.baseUrl);
    assert.strictEqual(got.env.ANTHROPIC_AUTH_TOKEN, KEY);
    assert.strictEqual(got.env.ANTHROPIC_DEFAULT_SONNET_MODEL, cfg.tiers.sonnet);
    assert.strictEqual(got.env.ANTHROPIC_DEFAULT_OPUS_MODEL, cfg.tiers.opus);
    assert.deepStrictEqual(got.argv.slice(-2), ['-p', 'say pong'], 'arguments not passed through intact');
  });
});

test('a stray ANTHROPIC_API_KEY never reaches claude under a gateway profile', () => {
  // It outranks the gateway token, and the gateway rejects it.
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter'], {
      home: dir,
      env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY, ANTHROPIC_API_KEY: 'sk-ant-stale' },
    });
    assert.ok(!('ANTHROPIC_API_KEY' in report().env));
  });
});

test('the claude profile clears every gateway variable left in the shell', () => {
  withFakeClaude(({ dir, fake, report }) => {
    launch(['claude'], {
      home: dir,
      env: {
        DEVKIT_CLAUDE_BIN: fake,
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_AUTH_TOKEN: KEY,
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'qwen/qwen3-coder',
      },
    });
    const env = report().env;
    assert.ok(!('ANTHROPIC_BASE_URL' in env));
    assert.ok(!('ANTHROPIC_AUTH_TOKEN' in env));
    assert.ok(!('ANTHROPIC_DEFAULT_SONNET_MODEL' in env));
  });
});

test('a gateway session names its tier, so no [1m] suffix lands on the gateway id', () => {
  // Found live: with no --model, the session started on the default alias and
  // sent `qwen/qwen3.8-27b:free[1m]`, which OpenRouter does not know.
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    const argv = report().argv;
    assert.strictEqual(argv[argv.indexOf('--model') + 1], 'sonnet');
  });
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter', '--model', 'opus'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    const argv = report().argv;
    assert.strictEqual(argv.filter((a) => a === '--model').length, 1, 'overrode an explicit --model');
    assert.strictEqual(argv[argv.indexOf('--model') + 1], 'opus');
  });
});

test('with no key anywhere it refuses, and says both places a key can go', () => {
  withFakeClaude(({ dir, fake }) => {
    const r = launch(['openrouter'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake } });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.stderr, /OPENROUTER_API_KEY/);
    assert.match(r.stderr, /\.devkit/);
  });
});

test('a key file in the home directory works without any shell variable', () => {
  // The Windows path of least resistance: no per-window `$env:` or `set`.
  withFakeClaude(({ dir, fake, report }) => {
    fs.mkdirSync(path.join(dir, '.devkit'));
    fs.writeFileSync(path.join(dir, '.devkit', 'openrouter_api_key.txt'), `${KEY}\n`, 'utf8');
    launch(['openrouter'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake } });
    assert.strictEqual(report().env.ANTHROPIC_AUTH_TOKEN, KEY);
  });
});

test('a key file saved as .txt.txt is named, not silently missed', () => {
  // Found on the first real use: Notepad plus hidden extensions produced
  // openrouter_api_key.txt.txt, and the launcher said only "no API key".
  withFakeClaude(({ dir, fake }) => {
    fs.mkdirSync(path.join(dir, '.devkit'));
    fs.writeFileSync(path.join(dir, '.devkit', 'openrouter_api_key.txt.txt'), KEY, 'utf8');
    const r = launch(['openrouter'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake } });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.stderr, /openrouter_api_key\.txt\.txt/);
    assert.match(r.stderr, /[Rr]ename/);
  });
});

test('the key is never printed', () => {
  withFakeClaude(({ dir, fake }) => {
    const r = launch(['openrouter', '--dry-run'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    assert.strictEqual(r.exitCode, 0);
    assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY), 'printed the full key');
  });
});

test('dry-run starts nothing', () => {
  withFakeClaude(({ dir, fake }) => {
    launch(['openrouter', '--dry-run'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    assert.ok(!fs.existsSync(path.join(dir, 'report.json')), 'dry-run launched claude');
  });
});

test('a profile name cannot be a path', () => {
  withFakeClaude(({ dir, fake }) => {
    const r = launch(['../package'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    assert.strictEqual(r.exitCode, 1);
  });
});

test('the shell-specific profile scripts are gone, not shadowed', () => {
  // Two ways to do one thing is the drift this plugin keeps warning about,
  // and the .ps1 one is the one that fails on a locked-down Windows machine.
  const strays = fs.readdirSync(path.join(PLUGIN_ROOT, 'profiles')).filter((f) => /\.(ps1|sh)$/.test(f));
  assert.deepStrictEqual(strays, []);
});
