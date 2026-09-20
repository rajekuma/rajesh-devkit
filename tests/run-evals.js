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
  const out = { case: '*', keepTemp: false, judgeModel: null, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case') out.case = argv[++i];
    else if (a === '--keep-temp') out.keepTemp = true;
    else if (a === '--judge-model') out.judgeModel = argv[++i];
    else out.rest.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pluginRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';

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

const result = spawnSync(command, cmdArgs, { stdio: 'inherit', cwd: pluginRoot });

if (result.error) {
  console.error(`\nCould not launch ${command}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
