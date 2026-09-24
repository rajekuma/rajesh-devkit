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

// Variables a running Claude session (the desktop app, an SDK host, a
// session's own tool shell) hands its child processes so they act as part of
// it - its entry point, its session ids, its host-side OAuth refresh. A
// `claude` started with them believes it is that session's child and uses the
// host's login, whatever ANTHROPIC_AUTH_TOKEN says. Found by running an eval
// under a gateway profile from the desktop app's shell: every request came
// back authentication_failed, while the same pong from a plain terminal
// worked; stripping these made it answer. A profile starts an independent
// session, so they never pass through. A few user-set CLAUDE_CODE_* knobs
// are kept, because they are the user's intent rather than a host's plumbing.
const HOST_SESSION = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|USE_LOCAL_OAUTH|USE_STAGING_OAUTH)$/;
const USER_KNOBS = /^CLAUDE_CODE_(MAX_CONTEXT_TOKENS|MAX_OUTPUT_TOKENS|DISABLE_NONESSENTIAL_TRAFFIC|DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT)$/;

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
    throw new Error(`cannot read profile '${name}' (${file}): ${e.message}`);
  }
  if (typeof cfg.baseUrl !== 'string' || !cfg.tiers || typeof cfg.tiers !== 'object') {
    throw new Error(`profile '${name}' needs a baseUrl and a tiers object`);
  }
  return cfg;
}

// The credential comes from an environment variable, or failing that from a
// one-line file in your home directory - never from this repository, and
// never from an argument, which would land in shell history. The file exists
// for Windows, where setting a variable per window is exactly the friction
// this launcher removes; it is outside every repo, so nothing can commit it.
function readKey(envName, baseEnv = process.env) {
  const fromEnv = baseEnv[envName];
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

// The environment a profile gives claude, built from `baseEnv` without
// touching it. Exported so the eval runner can put a profile under test with
// exactly the variables a real fallback session gets - two copies of this
// would drift, and an eval that measured a different setup than the one
// people run would be measuring nothing. Throws with a user-facing message.
function profileEnv(name, baseEnv = process.env) {
  // A profile is a file in this folder, named by a plain word - never a path.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`not a profile name: ${name}`);
  const env = { ...baseEnv };
  for (const v of MANAGED) delete env[v];
  for (const v of Object.keys(env)) if (HOST_SESSION.test(v) && !USER_KNOBS.test(v)) delete env[v];

  if (name === 'claude') {
    return { env, gateway: false, lines: ['devkit: profile claude - your subscription login, Anthropic models.'] };
  }

  const cfg = loadProfile(name);
  const keyEnv = typeof cfg.keyEnv === 'string' ? cfg.keyEnv : `${name.toUpperCase()}_API_KEY`;
  const { key, source, file, doubled } = readKey(keyEnv, baseEnv);
  if (!key && doubled) {
    throw new Error(
      `found ${doubled} - one ".txt" too many (Windows hides extensions, so Notepad added its ` +
        `own). Rename it to ${path.basename(file)} and run this again.`
    );
  }
  if (!key) {
    throw new Error(
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

  // Every request re-sends the whole conversation, so its cost grows with the
  // context, and a gateway charges for all of it. Measured: one 26-minute
  // fallback session made 192 requests that carried 18.6 million input tokens
  // between them - about $8.50 at $0.30 per million - while writing only
  // 14 thousand. Claude Code compacts as the context nears the window it
  // assumes (200k for a model it doesn't know), so a lower ceiling here makes
  // it compact sooner and caps what each late request costs. A value the user
  // set themselves wins.
  const ceiling = cfg.maxContextTokens;
  let ceilingNote = null;
  if (typeof ceiling === 'number' && Number.isFinite(ceiling) && ceiling >= 20000) {
    if (baseEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS) {
      ceilingNote = `  context -> ${baseEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS} tokens (your own setting, kept)`;
    } else {
      env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(Math.floor(ceiling));
      ceilingNote = `  context -> compacts near ${Math.floor(ceiling)} tokens, to cap per-request cost`;
    }
  }

  const lines = [`devkit: profile ${name} - ${cfg.baseUrl}, key from ${source} (${mask(key)})`];
  for (const tier of Object.keys(TIER_VARS)) {
    if (cfg.tiers[tier]) lines.push(`  ${tier.padEnd(7)}-> ${cfg.tiers[tier]}`);
  }
  if (ceilingNote) lines.push(ceilingNote);
  lines.push(
    'Billed per token to this provider, NOT to your Claude subscription. Set a hard spend ' +
      "cap on the key in the provider's dashboard - nothing here can enforce one."
  );
  return { env, gateway: true, lines };
}

// --- main -----------------------------------------------------------------

// One line, at most once a week, when starting a gateway session: the only
// moment you are both online and choosing a model. Never during the loop -
// a milestone is not the place for a model shortlist. Short timeout and
// silent on any failure, because this runs in front of someone trying to get
// back to work after a usage limit. It only counts; `check.js --new` lists
// and records. DEVKIT_NO_MODEL_NOTICE=1 turns it off (the tests do).
async function weeklyModelNotice(baseUrl) {
  if (process.env.DEVKIT_NO_MODEL_NOTICE === '1') return;
  try {
    const cat = require('./catalogue');
    const state = cat.readState();
    const last = Date.parse(state.lastNotice || '');
    if (Number.isFinite(last) && Date.now() - last < cat.WEEK_MS) return;
    const catalogue = await cat.fetchCatalogue(baseUrl, 2500);
    const now = new Date().toISOString();
    if (!state.seen) {
      cat.writeState({ seen: catalogue.map((m) => m.id), seenAt: now, lastNotice: now });
      return;
    }
    const fresh = cat.newToolModels(catalogue, state.seen);
    cat.writeState({ ...state, lastNotice: now });
    if (fresh.length > 0) {
      process.stderr.write(
        `devkit: ${fresh.length} new tool-capable model(s) on this gateway since ${state.seenAt.slice(0, 10)} ` +
          '- see them with: node profiles/check.js --new (candidates to measure, not to trust)\n'
      );
    }
  } catch {
    /* offline, slow or odd catalogue: say nothing, start claude */
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') usage();

  const name = argv[0];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) usage();
  const rest = argv.slice(1);
  const dryRun = rest.includes('--dry-run');
  const claudeArgs = rest.filter((a) => a !== '--dry-run');

  let built;
  try {
    built = profileEnv(name);
  } catch (e) {
    fail(e.message);
  }
  const { env, lines } = built;
  if (built.gateway && !claudeArgs.some((a) => a === '--model' || a.startsWith('--model='))) {
    claudeArgs.unshift('--model', DEFAULT_SESSION_TIER);
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
  if (built.gateway) await weeklyModelNotice(env.ANTHROPIC_BASE_URL);

  const args = [...target.prefix, ...claudeArgs];
  const child = target.shell
    ? spawn(`"${target.command}" ${args.map(quoteForCmd).join(' ')}`, { stdio: 'inherit', env, shell: true })
    : spawn(target.command, args, { stdio: 'inherit', env });

  // Ctrl+C belongs to claude, which shares this console; the launcher only
  // waits and hands back claude's exit code.
  process.on('SIGINT', () => {});
  child.on('error', (e) => fail(`could not start claude: ${e.message}`));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

module.exports = { profileEnv, DEFAULT_SESSION_TIER, MANAGED };

if (require.main === module) main();  // async; the child process keeps node alive
