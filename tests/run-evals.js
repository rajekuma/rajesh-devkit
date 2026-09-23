#!/usr/bin/env node
'use strict';

// Cross-platform entry point for the behavioral evals under evals/.
//
// The official runner (`claude plugin eval`) is the intended way to run
// these, and it works directly on macOS/Linux. On Windows it currently
// can't grant Bash to a case at all: a `systemprofile`-owned WindowsApps
// entry that ends up on PATH makes its credential-helper scan fail with
// EPERM, and past that, this platform's Claude Code build has no active
// sandbox backend to confine a Bash-granting run ("Windows sandbox is not
// active on this session"). `run-evals.ps1` exists as a bridge around both:
// same case.yaml/scaffold.sh/graders files, driven through `claude -p
// --plugin-dir` directly with its own isolation instead. See that script's
// header for the full detail.
//
// This script just dispatches to whichever one actually works here, so
// there is one command to remember regardless of OS.

const { spawnSync } = require('child_process');
const path = require('path');

function parseArgs(argv) {
  const out = { case: '*', keepTemp: false, judgeModel: null, profile: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') out.case = argv[++i];
    else if (a === '--keep-temp') out.keepTemp = true;
    else if (a === '--judge-model') out.judgeModel = argv[++i];
    else if (a === '--profile') out.profile = argv[++i];
    else out.rest.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pluginRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

// --profile <name>: run the cases on a provider profile instead of the Claude
// login - the only honest way to know whether a cheaper model can actually do
// the work, since a pong proves the wiring and nothing about a red-green loop.
// The environment comes from the launcher's own profileEnv, so an eval
// measures exactly the setup a real fallback session gets. The judge that
// grades the run stays on the Claude login (run-evals.ps1 strips the gateway
// variables for it): grading a model with itself measures nothing.
let childEnv = process.env;
let sessionModel = null;
if (args.profile) {
  const { profileEnv, DEFAULT_SESSION_TIER } = require('../profiles/devkit.js');
  try {
    const built = profileEnv(args.profile);
    childEnv = built.env;
    if (built.gateway) sessionModel = DEFAULT_SESSION_TIER;
    process.stderr.write(`${built.lines.join('\n')}\n`);
  } catch (e) {
    console.error(`run-evals: ${e.message}`);
    process.exit(1);
  }
  if (!isWindows) {
    console.error(
      'run-evals: note - on macOS/Linux the official runner is used, and it is given the ' +
        "profile's environment but not a --model, so the session starts on Claude Code's default " +
        'alias. The Windows bridge passes --model explicitly.'
    );
  }
}

let command, cmdArgs;
if (isWindows) {
  command = 'powershell.exe';
  cmdArgs = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'run-evals.ps1'),
    '-Case', args.case,
  ];
  if (args.keepTemp) cmdArgs.push('-KeepTemp');
  if (args.judgeModel) cmdArgs.push('-JudgeModel', args.judgeModel);
  if (sessionModel) cmdArgs.push('-Model', sessionModel);
  cmdArgs.push(...args.rest);
} else {
  command = 'claude';
  cmdArgs = [
    'plugin', 'eval', '.', '--scaffold',
    '--allow-tools', 'Bash', 'Write', 'Edit',
    '--runs', '1', '--max-cost-usd', '15', '--trust-plugin',
    '--case', args.case,
  ];
  if (args.keepTemp) cmdArgs.push('--keep-temp');
  if (args.judgeModel) cmdArgs.push('--judge-model', args.judgeModel);
  cmdArgs.push(...args.rest);
}

const result = spawnSync(command, cmdArgs, { stdio: 'inherit', cwd: pluginRoot, env: childEnv });

if (result.error) {
  console.error(`\nCould not launch ${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
