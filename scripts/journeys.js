#!/usr/bin/env node
'use strict';

// Runs a project's journey checks and records what actually happened.
//
//   node journeys.js run <id>          one journey, even if its Needs are unfinished
//   node journeys.js run --needs M<n>  the journeys naming that milestone
//   node journeys.js run --all         every journey not still blocked
//   node journeys.js status [--json]   every journey's state, computed fresh
//
// There is no command to record a pass. See lib/journeys.js for why.
//
// Exit codes. run: 0 nothing failed, 1 a check failed or could not run, 2 usage
// error or no such journey. status: always 0.

const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const j = require('./lib/journeys');

// A session has no CLAUDE_PROJECT_DIR of its own - only hooks get that.
function resolveProjectDir() {
  const fromEnv = d.projectDir();
  if (fromEnv) return fromEnv;
  return require('./lib/git').run(null, ['rev-parse', '--show-toplevel']) || process.cwd();
}

function usage() {
  process.stderr.write(
    'usage: node journeys.js run <id> | run --needs M<n> | run --all | status [--json]\n'
  );
  process.exit(2);
}

const dir = resolveProjectDir();
const config = d.readStageConfig(dir);
const [command, ...rest] = process.argv.slice(2);

function say(text) {
  process.stdout.write(`${text}\n`);
}

if (command === 'status') {
  const json = rest.includes('--json');
  if (!j.active(dir, config)) {
    if (json) say(JSON.stringify({ active: false, journeys: [], closest: null, tree: null }));
    else say(`No journeys here: ${j.JOURNEYS_FILE} is absent or "journeys" is false in .claude/devkit.json.`);
    process.exit(0);
  }
  const e = j.evaluate(dir, config);
  if (json) {
    say(
      JSON.stringify(
        {
          active: true,
          journeys: e.journeys.map((x) => ({
            id: x.id,
            title: x.title,
            state: x.state,
            needs: x.needs,
            unfinished: x.unfinished,
            missing: x.missing,
            manual: x.manual,
            lastRunAt: x.lastRunAt,
            invalid: x.invalid,
          })),
          closest: e.closest ? { id: e.closest.id, unfinished: e.closest.unfinished, missing: e.closest.missing } : null,
          tree: e.tree,
        },
        null,
        2
      )
    );
  } else {
    say(j.report(e));
  }
  process.exit(0);
}

if (command !== 'run' || rest.length === 0) usage();

if (!j.active(dir, config)) {
  process.stderr.write(`journeys: nothing to run, ${j.JOURNEYS_FILE} is absent or switched off.\n`);
  process.exit(2);
}

const evaluation = j.evaluate(dir, config);
const all = evaluation.journeys;
let targets = [];
let milestoneKey = null;

if (rest[0] === '--all') {
  // A journey that is still blocked would only fail for want of the unbuilt
  // milestone, and record that as if it meant something.
  for (const x of all) if (x.state === 'blocked' && !x.invalid) say(`${x.id} blocked: needs ${[...x.unfinished, ...x.missing].join(', ')}; not run.`);
  targets = all.filter((x) => !x.invalid && x.state !== 'blocked');
} else if (rest[0] === '--needs') {
  if (!rest[1]) usage();
  milestoneKey = j.needKey(rest[1]);
  for (const x of all.filter((y) => !y.invalid && j.namesMilestone(y, milestoneKey))) {
    // The milestone being closed may not be ticked yet, so it can't count against
    // its own journey.
    const others = [...x.unfinished, ...x.missing].filter((n) => n.toLowerCase() !== milestoneKey.toLowerCase());
    if (others.length > 0) say(`${x.id} blocked: also needs ${others.join(', ')}; not run.`);
    else targets.push(x);
  }
  if (targets.length === 0) say(`No journey can run for ${milestoneKey} yet.`);
} else {
  const found = all.find((x) => x.id === rest[0]);
  if (!found) {
    process.stderr.write(`journeys: no journey called ${rest[0]}.\n`);
    process.exit(2);
  }
  if (found.invalid) {
    process.stderr.write(`journeys: ${found.id} is invalid: ${found.invalid}.\n`);
    process.exit(2);
  }
  targets = [found];
}

function telemetryMilestone() {
  if (!milestoneKey) return null;
  const rows = d.readMilestoneStatuses(path.join(dir, 'PROGRESS.md'));
  return rows[milestoneKey] ? rows[milestoneKey].display : milestoneKey;
}

async function main() {
  j.prepare(dir);
  let bad = 0;
  for (const target of targets) {
    if (target.manual) {
      say(`${target.id} is a manual journey, so no command can prove it. Try it, then say "devkit journey ${target.id} passed".`);
      continue;
    }
    const tree = j.fingerprint(dir, config);
    say(`--- ${target.id} ${target.title}`);
    const run = await j.runCheck(dir, target);
    j.recordProof(dir, target, { ...run, tree });

    const after = j.fingerprint(dir, config);
    const dirtied = Boolean(tree && after && tree !== after);
    const state =
      run.result === 'unknown'
        ? 'unknown'
        : run.result === 'fail'
          ? 'failing'
          : tree && !dirtied
            ? 'proven'
            : 'stale';
    d.appendTelemetry(dir, 'journey_run', telemetryMilestone(), undefined, {
      id: target.id,
      state,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
    });

    const seconds = `${Math.round((run.durationMs ?? 0) / 100) / 10}s`;
    if (run.timedOut) say(`${target.id} unknown: timed out after ${target.timeoutS}s, so it proves nothing.`);
    else if (state === 'unknown') say(`${target.id} unknown: the check could not run (exit ${run.exitCode}), so it proves nothing.`);
    else if (state === 'failing') say(`${target.id} failing: exit ${run.exitCode} in ${seconds}. Fix this failure only, then run it again.`);
    else if (dirtied) say(`${target.id} stale: it passed, but the check changed the tree, so the result can't be tied to the code it tested. Have it write its output somewhere .gitignore covers.`);
    else if (!tree) say(`${target.id} stale: it passed, but this tree can't be fingerprinted, so the result can't be proved current.`);
    else say(`${target.id} proven: exit 0 in ${seconds}.`);
    if (state === 'failing' || state === 'unknown') bad += 1;
  }

  if (milestoneKey) {
    if (bad === 0) {
      if (targets.some((t) => !t.manual)) j.setAttempts(dir, milestoneKey, 0);
    } else {
      const attempts = j.attemptsFor(dir, milestoneKey) + 1;
      j.setAttempts(dir, milestoneKey, attempts);
      if (attempts >= j.MAX_ATTEMPTS) {
        say(
          `Stop and ask the user: ${milestoneKey}'s journeys have failed ${attempts} times, so the plan may be wrong ` +
            'rather than the code. Show them what failed. The loop will not push this milestone again until they say ' +
            '"devkit continue".'
        );
      }
    }
  }
  process.exit(bad > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`journeys: ${err && err.message}\n`);
  process.exit(1);
});
