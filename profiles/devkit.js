#!/usr/bin/env node
'use strict';

// Starts `claude` against a provider profile, on any OS.
//
//   node <plugin>/profiles/devkit.js openrouter            start a session via OpenRouter
//   node <plugin>/profiles/devkit.js openrouter -p "hi"    anything after the profile goes to claude
//   node <plugin>/profiles/devkit.js openrouter --dry-run  show what would run, run nothing
//   node <plugin>/profiles/devkit.js claude                a clean subscription session
//
// Why a Node launcher and not a shell function. This used to be two scripts,
// devkit-env.ps1 and devkit-env.sh, that edited the CURRENT shell's variables
// and then left you to type `claude`. On Windows that failed three ways in
// one sitting, on a real machine: a LocalMachine execution policy of
// AllSigned refused the unsigned .ps1 outright; running it without
// dot-sourcing would have set the variables in a child scope and thrown them
// away; and once past both, `claude` itself resolved to npm's unsigned
// claude.ps1 shim and was refused too. Typing the variables by hand then hit
// the other trap - the window was cmd.exe, not PowerShell, so every `$env:`
// line failed and the "successful" test silently went to the subscription.
//
// A child process cannot change its parent shell's environment, on any OS.
// But it does not need to: it only has to hand the right environment to the
// ONE process that reads it, which is claude. So this sets the variables on
// the claude it starts and on nothing else. Execution policy governs .ps1
// scripts, not node, so none of the above applies; the same command works in
// PowerShell, cmd, Git Bash, zsh and bash; and closing the session leaves
// your shell exactly as it was - there is no "switch back" step to forget.
//
// The provider is fixed when claude starts (nothing inside a session can
// change it), and the loop's position lives on disk in resume.json, so a new
// session under a new profile picks up where the last one stopped. Never
// `claude --continue` across a switch: it replays the whole transcript to the
// new provider as uncached input tokens.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Every variable a profile may set, cleared first, so a profile is a
// replacement and never an accumulation. A leftover
// ANTHROPIC_DEFAULT_SONNET_MODEL from an earlier experiment is the kind of
// bug found three milestones later. ANTHROPIC_API_KEY is removed rather than
// blanked: a stray key otherwise outranks the gateway token and is rejected.
const MANAGED = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
];

const TIER_VARS = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
};

// The session's own tier when the caller names none. Without an explicit
// --model, Claude Code started the session on its default alias and carried
// that alias's context suffix onto the gateway id - `qwen/...:free[1m]` - an
// id the gateway does not know. Naming a tier avoids that. `sonnet`, not
// `opus`, because a fallback session is the orchestrator and the implementer,
// not the place for spec work: the README says to wait for the subscription
// window for that. Pass `--model opus` to override.
const DEFAULT_SESSION_TIER = 'sonnet';

function fail(message) {
  process.stderr.write(`devkit: ${message}\n`);
  process.exit(1);
}

function usage() {
  const names = listProfiles().join(', ');
  process.stderr.write(
    'usage: node profiles/devkit.js <profile> [--dry-run] [claude arguments...]\n' +
      `profiles: claude, ${names}\n`
  );
  process.exit(1);
}

function listProfiles() {
  try {
    return fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

function loadProfile(name) {
  const file = path.join(__dirname, `${name}.json`);
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`cannot read profile '${name}' (${file}): ${e.message}`);
  }
  if (typeof cfg.baseUrl !== 'string' || !cfg.tiers || typeof cfg.tiers !== 'object') {
    fail(`profile '${name}' needs a baseUrl and a tiers object`);
  }
  return cfg;
}

// The credential comes from an environment variable, or failing that from a
// one-line file in your home directory - never from this repository, and
// never from an argument, which would land in shell history. The file exists
// for Windows, where setting a variable per window is exactly the friction
// this launcher removes; it is outside every repo, so nothing can commit it.
function readKey(envName) {
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return { key: fromEnv.trim(), source: `$${envName}` };
  const file = path.join(os.homedir(), '.devkit', `${envName.toLowerCase()}.txt`);
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (text) return { key: text, source: file };
  } catch {
    /* absent is the normal case */
  }
  // Windows hides known extensions by default, so a file saved from Notepad
  // as "openrouter_api_key.txt" is really "openrouter_api_key.txt.txt" while
  // Explorer shows one ".txt". Found on the first real use of this file.
  const doubled = `${file}.txt`;
  return { key: null, file, doubled: fs.existsSync(doubled) ? doubled : null };
}

// Where claude actually is. On macOS and Linux, `claude` on PATH is directly
// executable. On Windows npm installs three shims - claude (sh), claude.cmd
// and claude.ps1 - and the .ps1 is the one PowerShell prefers and an AllSigned
// policy refuses. All three wrap a native claude.exe, so this finds the .exe
// and starts it with no shell at all: nothing to sign, nothing to quote.
// DEVKIT_CLAUDE_BIN overrides the search; a .js path there runs under node,
// which is how the tests stand in a fake claude.
function resolveClaude() {
  const override = process.env.DEVKIT_CLAUDE_BIN;
  if (override) {
    return override.endsWith('.js')
      ? { command: process.execPath, prefix: [override], shell: false }
      : { command: override, prefix: [], shell: false };
  }
  if (process.platform !== 'win32') return { command: 'claude', prefix: [], shell: false };

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, 'claude.exe');
    if (fs.existsSync(exe)) return { command: exe, prefix: [], shell: false };
    if (fs.existsSync(path.join(dir, 'claude.cmd'))) {
      const bundled = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (fs.existsSync(bundled)) return { command: bundled, prefix: [], shell: false };
      // An npm layout this does not recognise: go through the .cmd shim,
      // which needs cmd.exe, and quote for it.
      return { command: path.join(dir, 'claude.cmd'), prefix: [], shell: true };
    }
  }
  return null;
}

// cmd.exe quoting, used only on the .cmd fallback above.
function quoteForCmd(arg) {
  if (/^[\w\-.:/\\=@,+]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function mask(key) {
  return key.length <= 8 ? '****' : `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// --- main -----------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') usage();

const name = argv[0];
// A profile is a file in this folder, named by a plain word - never a path.
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) usage();
const rest = argv.slice(1);
const dryRun = rest.includes('--dry-run');
const claudeArgs = rest.filter((a) => a !== '--dry-run');

const env = { ...process.env };
for (const v of MANAGED) delete env[v];

const lines = [];
if (name === 'claude') {
  lines.push('devkit: profile claude - your subscription login, Anthropic models.');
} else {
  const cfg = loadProfile(name);
  const keyEnv = typeof cfg.keyEnv === 'string' ? cfg.keyEnv : `${name.toUpperCase()}_API_KEY`;
  const { key, source, file, doubled } = readKey(keyEnv);
  if (!key && doubled) {
    fail(
      `found ${doubled} - one ".txt" too many (Windows hides extensions, so Notepad added its ` +
        `own). Rename it to ${path.basename(file)} and run this again.`
    );
  }
  if (!key) {
    fail(
      `no API key for profile '${name}'. Either set ${keyEnv} in this terminal, or put the key ` +
        `alone on one line in ${file} (outside every repository, so it can never be committed).`
    );
  }
  // Bare /api, never /api/v1: claude appends /v1/messages itself, and a
  // doubled /v1 is a 404 that reads exactly like an auth failure.
  env.ANTHROPIC_BASE_URL = cfg.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = key;
  for (const [tier, variable] of Object.entries(TIER_VARS)) {
    if (typeof cfg.tiers[tier] === 'string') env[variable] = cfg.tiers[tier];
  }
  if (!claudeArgs.some((a) => a === '--model' || a.startsWith('--model='))) claudeArgs.unshift('--model', DEFAULT_SESSION_TIER);

  lines.push(`devkit: profile ${name} - ${cfg.baseUrl}, key from ${source} (${mask(key)})`);
  for (const tier of Object.keys(TIER_VARS)) {
    if (cfg.tiers[tier]) lines.push(`  ${tier.padEnd(7)}-> ${cfg.tiers[tier]}`);
  }
  lines.push(
    'Billed per token to this provider, NOT to your Claude subscription. Set a hard spend ' +
      "cap on the key in the provider's dashboard - nothing here can enforce one."
  );
}

const target = resolveClaude();
if (!target) {
  fail(
    'cannot find claude on PATH. Install Claude Code, or set DEVKIT_CLAUDE_BIN to the full ' +
      'path of the claude executable.'
  );
}
lines.push(`devkit: starting ${target.command} ${claudeArgs.join(' ')}`.trimEnd());
process.stderr.write(`${lines.join('\n')}\n`);

if (dryRun) process.exit(0);

const args = [...target.prefix, ...claudeArgs];
const child = target.shell
  ? spawn(`"${target.command}" ${args.map(quoteForCmd).join(' ')}`, { stdio: 'inherit', env, shell: true })
  : spawn(target.command, args, { stdio: 'inherit', env });

// Ctrl+C belongs to claude, which shares this console; the launcher only
// waits and hands back claude's exit code.
process.on('SIGINT', () => {});
child.on('error', (e) => fail(`could not start claude: ${e.message}`));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
