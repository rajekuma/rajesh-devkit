#!/usr/bin/env node
'use strict';

// Not a hook - the orchestrator runs this, because continue-loop's nudge
// tells it to, with the absolute path filled in.
//
//   node record-gate.js <gate> <verdict>   stamp a verdict with the tree now
//   node record-gate.js check [--json]     judge every stamp against the tree now
//
// A verdict describes the diff its gate saw, not the diff that exists after
// someone acts on it. In the M28 run three gates passed, two of quality's
// findings were applied, and all three verdicts rode on toward ship as if
// nothing had changed. This is how the loop tells the difference. See
// lib/gates.js for why every unprovable case reads as STALE.
//
// Exit codes. record: 0 stamped, 1 usage error or unwritable state. check: 0
// when at least one verdict is recorded and every one is fresh, 1 otherwise -
// "nothing recorded" is deliberately not a success, because the thing reading
// the exit code is asking whether the verdicts can be trusted.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const gates = require('./lib/gates');

// The harness sets CLAUDE_PROJECT_DIR for hooks; a Bash call from the session
// may or may not inherit it. The repository containing the working directory
// is the same answer by another route.
function resolveProjectDir() {
  const fromEnv = d.projectDir();
  if (fromEnv) return fromEnv;
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (!r.error && r.status === 0 && (r.stdout ?? '').trim()) return r.stdout.trim();
  return process.cwd();
}

function currentMilestone(dir) {
  const progressPath = path.join(dir, 'PROGRESS.md');
  if (!fs.existsSync(progressPath)) return null;
  const config = d.readStageConfig(dir);
  const m = d.findNextMilestone(progressPath, config.parked);
  return m ? m.display : null;
}

function usage() {
  process.stderr.write(
    'usage: node record-gate.js <gate> <verdict>\n' +
      '       node record-gate.js check [--json]\n' +
      `gates: ${gates.GATES.join(', ')}\n`
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) usage();

const dir = resolveProjectDir();
const milestone = currentMilestone(dir);

if (args[0] === 'check') {
  const result = gates.check(dir, { milestone });
  const allFresh = result.results.length > 0 && result.results.every((r) => r.state === 'fresh');
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(allFresh ? 0 : 1);
  }
  const lines = [`Gate verdicts${milestone ? ` for ${milestone}` : ''}, judged against the tree as it is now:`];
  if (result.results.length === 0) {
    lines.push(
      '  none recorded. A verdict with no stamp cannot be shown to describe this tree, so ' +
        'it is STALE, not a pass.'
    );
  }
  for (const r of result.results) {
    const state = r.state === 'fresh' ? 'FRESH' : `STALE - ${gates.describeReason(r.reason)}`;
    lines.push(`  ${r.gate.padEnd(10)} ${String(r.verdict).padEnd(20)} ${state}  (recorded ${r.recordedAt})`);
  }
  const unrecorded = gates.GATES.filter((g) => !result.results.some((r) => r.gate === g));
  if (result.results.length > 0 && unrecorded.length > 0) {
    lines.push(`  not recorded: ${unrecorded.join(', ')}`);
  }
  if (result.results.some((r) => r.state === 'stale')) {
    lines.push('Re-run each STALE gate against the current tree before relying on its verdict.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(allFresh ? 0 : 1);
}

if (args.length < 2) usage();

const out = gates.record(dir, { gate: args[0], verdict: args.slice(1).join(' '), milestone });
if (!out.ok) {
  process.stderr.write(`record-gate: ${out.error ?? 'could not write the gate record'}\n`);
  process.exit(1);
}
process.stdout.write(
  `record-gate: ${out.gate} = ${out.entry.verdict}` +
    (milestone ? ` for ${milestone}` : '') +
    (out.entry.tree
      ? `, against tree ${out.entry.tree.slice(0, 12)}\n`
      : ' - WITHOUT a tree fingerprint (not a git repository?), so it will always read as STALE\n')
);
process.exit(0);
