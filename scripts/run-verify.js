#!/usr/bin/env node
'use strict';

// PostToolUse hook (matched on Edit|Write): if the host project provides its
// own verify script, run it and pass its exit code straight through, so the
// harness's exit-code semantics for this event apply (2 = surface the failure
// to Claude). Otherwise exit 0 silently - this hook is a no-op unless the
// host project opts in.
//
// The lookup is deliberately multi-language, because the old contract
// (`.claude/verify.ps1`, full stop) was Windows-only: a macOS or Linux
// project would ship `verify.sh`, and demanding PowerShell there to satisfy
// a hook is backwards. First match in this fixed order wins, on every
// platform, so behaviour is predictable rather than depending on what OS
// someone happens to be running:
//
//   .claude/verify.js   -> node   (always available; Claude Code is a Node program)
//   .claude/verify.sh   -> bash
//   .claude/verify.ps1  -> pwsh, or powershell.exe on Windows
//
// Existing projects that only have verify.ps1 keep working unchanged.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');

d.readStdin(); // drain the harness payload

const dir = d.projectDir();
if (!dir) process.exit(0);

const isWindows = process.platform === 'win32';

const candidates = [
  { file: 'verify.js', runners: [process.execPath] },
  { file: 'verify.sh', runners: ['bash'] },
  { file: 'verify.ps1', runners: isWindows ? ['pwsh', 'powershell.exe'] : ['pwsh'] },
];

let found = null;
for (const candidate of candidates) {
  const full = path.join(dir, '.claude', candidate.file);
  if (fs.existsSync(full)) {
    found = { ...candidate, full };
    break;
  }
}

if (!found) process.exit(0);

const baseArgs = found.file.endsWith('.ps1')
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', found.full]
  : [found.full];

for (const runner of found.runners) {
  const result = spawnSync(runner, baseArgs, { stdio: 'inherit', cwd: dir });
  // ENOENT means this interpreter isn't installed - try the next one rather
  // than reporting the project's verify script as failing.
  if (result.error && result.error.code === 'ENOENT') continue;
  if (result.error) {
    process.stderr.write(`run-verify: could not run ${found.full}: ${result.error.message}\n`);
    process.exit(0);
  }
  process.exit(result.status === null ? 0 : result.status);
}

// The script exists but nothing here can execute it - e.g. a verify.ps1 in a
// repo cloned onto macOS with no pwsh installed. Deliberately exit 0 rather
// than 2: this fires after EVERY edit, and blocking all work over a setup
// problem is disproportionate. But say so loudly, because a verify gate that
// silently never runs is exactly the "unrun check assumed green" failure
// devkit-ship exists to prevent.
process.stderr.write(
  `run-verify: found ${found.full} but none of [${found.runners.join(', ')}] is installed, ` +
    'so your verify script is NOT running on this machine. Install one of those, or add a ' +
    '.claude/verify.js or .claude/verify.sh equivalent.\n'
);
process.exit(0);
