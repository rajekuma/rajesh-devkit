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
    env: { ...base, HOME: home, USERPROFILE: home, DEVKIT_NO_MODEL_NOTICE: "1", ...env },
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

test('a host session\'s plumbing never reaches the claude a profile starts', () => {
  // Found live: launched from the desktop app's shell, claude inherited the
  // app's session variables, used the app's login instead of the gateway key,
  // and every request came back authentication_failed.
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter'], {
      home: dir,
      env: {
        DEVKIT_CLAUDE_BIN: fake,
        OPENROUTER_API_KEY: KEY,
        CLAUDECODE: '1',
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
        CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: '1',
        CLAUDE_CODE_OAUTH_SCOPES: 'user:inference',
        USE_LOCAL_OAUTH: '1',
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '262144',
      },
    });
    const env = report().env;
    for (const v of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH', 'CLAUDE_CODE_OAUTH_SCOPES', 'USE_LOCAL_OAUTH']) {
      assert.ok(!(v in env), `${v} leaked into the profile session`);
    }
    assert.strictEqual(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '262144', "dropped the user's own setting");
  });
});

test('a profile can put the session on a different tier from its agents', () => {
  // Measured: gpt-6-luna does good implementer work but, as the session
  // model, isolated the implementer; qwen3-coder orchestrates well. The
  // hybrid profile runs the session on opus (qwen) and the agents on sonnet
  // (Luna) - it scored 9/9.
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter-hybrid'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    const got = report();
    assert.strictEqual(got.argv[got.argv.indexOf('--model') + 1], 'opus');
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'profiles', 'openrouter-hybrid.json'), 'utf8'));
    assert.strictEqual(got.env.ANTHROPIC_DEFAULT_OPUS_MODEL, cfg.tiers.opus);
    assert.strictEqual(got.env.ANTHROPIC_DEFAULT_SONNET_MODEL, cfg.tiers.sonnet);
  });
});

test('a profile context ceiling reaches claude, and a user setting wins', () => {
  // Measured: 192 requests re-sending the whole conversation cost ~$8.50 on
  // a gateway. The ceiling makes Claude Code compact sooner.
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter'], { home: dir, env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY } });
    const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'profiles', 'openrouter.json'), 'utf8'));
    assert.strictEqual(report().env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, String(cfg.maxContextTokens));
  });
  withFakeClaude(({ dir, fake, report }) => {
    launch(['openrouter'], {
      home: dir,
      env: { DEVKIT_CLAUDE_BIN: fake, OPENROUTER_API_KEY: KEY, CLAUDE_CODE_MAX_CONTEXT_TOKENS: '150000' },
    });
    assert.strictEqual(report().env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '150000');
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

test('every profile is well-formed and maps all four tiers', () => {
  // A profile is selected by name at the worst possible moment - right after
  // a usage limit - so a malformed one must fail here, not then.
  const dir = path.join(PLUGIN_ROOT, 'profiles');
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(names.includes('openrouter.json') && names.includes('openrouter-lean.json'));
  for (const f of names) {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.match(cfg.baseUrl, /^https:\/\/\S+[^/]$/, `${f}: baseUrl`);
    assert.doesNotMatch(cfg.baseUrl, /\/v1$/, `${f}: base URL must not end in /v1 - claude appends it`);
    for (const tier of ['opus', 'sonnet', 'haiku', 'fable']) {
      assert.strictEqual(typeof cfg.tiers[tier], 'string', `${f}: tier ${tier} missing`);
    }
  }
});

test('the shell-specific profile scripts are gone, not shadowed', () => {
  // Two ways to do one thing is the drift this plugin keeps warning about,
  // and the .ps1 one is the one that fails on a locked-down Windows machine.
  const strays = fs.readdirSync(path.join(PLUGIN_ROOT, 'profiles')).filter((f) => /\.(ps1|sh)$/.test(f));
  assert.deepStrictEqual(strays, []);
});

// ---------------------------------------------------------------------------
// New models on the gateway: listed on demand, noticed at most weekly, and
// only ever the tool-capable ones - Claude Code cannot run on anything else.
// ---------------------------------------------------------------------------
const catalogue = require('../profiles/catalogue');

test('only unseen, tool-capable models count as new', () => {
  const cat = [
    { id: 'old/model', supported_parameters: ['tools'] },
    { id: 'new/coder', supported_parameters: ['tools', 'temperature'] },
    { id: 'new/no-tools', supported_parameters: ['temperature'] },
  ];
  assert.deepStrictEqual(catalogue.newToolModels(cat, ['old/model']).map((m) => m.id), ['new/coder']);
});

test('with no record yet, nothing is reported as new', () => {
  // The first look records a baseline; calling the whole catalogue "new"
  // would bury the one model worth trying under hundreds.
  assert.deepStrictEqual(catalogue.newToolModels([{ id: 'a', supported_parameters: ['tools'] }], null), []);
});

test('a new model is described with its real prices, cache included', () => {
  const line = catalogue.describe({
    id: 'x/y',
    context_length: 262144,
    pricing: { prompt: '0.0000003', completion: '0.000001', input_cache_read: '0.0000001' },
  });
  assert.match(line, /in \$0\.30 \(cached \$0\.10\) \/ out \$1\.00/);
});
