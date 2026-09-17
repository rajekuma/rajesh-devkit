#!/usr/bin/env node
'use strict';

// Stop hook: reads the JSON the harness pipes on stdin, looks for the first
// unfinished milestone in the host project's PROGRESS.md, and if found blocks
// the stop (exit 2) with a stderr instruction telling Claude what to do next
// - draft a spec first if none exists yet, otherwise implement it. Exits 0
// (allow the stop) in every other case: no PROGRESS.md, nothing unstarted
// left, the project has its own loop skill, or the nudge cap is hit.

const d = require('./lib/devkit');

const NUDGE_CAP = 8;

const hookInput = d.readStdinJson();

// The harness's own recursion guard: this Stop is already a continuation of a
// previous Stop-hook block. Don't stack another one on top of it.
if (hookInput && hookInput.stop_hook_active === true) process.exit(0);

const dir = d.projectDir();
if (!dir) process.exit(0);

// See lib/devkit.js - a project with its own loop owns its stop conditions.
if (d.hasOwnLoopSkill(dir)) process.exit(0);

const path = require('path');
const fs = require('fs');
const progressPath = path.join(dir, 'PROGRESS.md');
if (!fs.existsSync(progressPath)) process.exit(0);

const milestone = d.findNextMilestone(progressPath);
if (!milestone) process.exit(0);

const specPath = d.findSpecForMilestone(dir, milestone.number, milestone.name);

// Sensitive-milestone escalation gate: devkit-specify marks a requirement
// "SENSITIVE:" when it touches an existing invariant, a security/auth
// boundary, a data-model change, an external integration, or a
// backward-compatibility break. If the spec has one, this milestone
// shouldn't be nudged toward standard delegation the way an ordinary one is -
// the escalation message below asks the orchestrator to stop and ask the user
// whether to implement it directly at higher reasoning instead. Shown once
// per milestone, not on every repeat nudge: once surfaced, a human has had
// the chance to act on it.
const isSensitive = d.isSensitiveSpec(specPath);

// Runaway-loop guard: a counter keyed to this project + this exact milestone.
const statePath = d.nudgeStatePath(dir);
const previous = d.readNudgeState(statePath);

let count = 1;
let escalationShown = false;
if (previous && previous.milestone === milestone.display) {
  count = Number(previous.count) + 1;
  escalationShown = Boolean(previous.escalationShown);
}

if (count > NUDGE_CAP) {
  process.stdout.write(
    `continue-loop: '${milestone.display}' hit the ${NUDGE_CAP}-nudge cap without shipping - ` +
      `stopping instead of looping forever. Delete ${statePath} to reset the counter.\n`
  );
  try {
    fs.unlinkSync(statePath);
  } catch {
    /* already gone - nothing to reset */
  }
  process.exit(0);
}

const showEscalation = isSensitive && !escalationShown;
if (showEscalation) escalationShown = true;

d.writeNudgeState(statePath, { milestone: milestone.display, count, escalationShown });

// Log a "started" event the first time this milestone is seen, not on every
// repeat nudge - regardless of whether the nudge below is toward specifying,
// implementing, or escalating, since from the user's perspective work began
// the moment it was first mentioned. track-milestones logs the matching
// "shipped" event; devkit-stats pairs the two by display name.
if (count === 1) {
  d.appendTelemetry(dir, 'milestone_started', milestone.display);
}

let message;
if (showEscalation) {
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec (${specPath}) flags one ` +
    'or more requirements as SENSITIVE (an existing invariant, a security/authorization ' +
    'boundary, a data-model change, an external integration, or a backward-compatibility ' +
    'break). ' +
    // Worded to forbid BOTH routes, because the earlier version only said
    // "STOP before delegating" and an eval caught a session reading that as
    // permission to implement the milestone itself and ask afterwards - the
    // code was already written by the time the question arrived, which is
    // exactly the outcome this gate exists to prevent.
    'WRITE NO CODE YET. Do not edit, create or delete any file for this milestone, ' +
    'and do not invoke devkit-implementer. Ask the user one question first (e.g. via ' +
    'AskUserQuestion): should you implement this milestone directly yourself at higher ' +
    'reasoning, or is standard delegation to devkit-implementer fine for this one? Then ' +
    'wait. Asking after starting the work does not satisfy this gate - the point is that ' +
    'a human chooses the approach BEFORE anything is written, not that they are informed ' +
    'once it exists. This is a one-time gate for this milestone: once answered, proceed ' +
    'with strict TDD as normal and invoke devkit-reviewer when done.';
} else if (!specPath) {
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. No spec exists for it yet - ` +
    `draft one first: say "spec this feature: ${milestone.name}" to invoke devkit-specify ` +
    'and write specs/<kebab-case-feature>.md. Once the spec exists, implement it with ' +
    'strict TDD (red-green, one acceptance criterion at a time), then invoke the ' +
    'devkit-reviewer subagent against the diff. Once it returns a ship verdict, run ' +
    'the devkit-ship subagent as a preflight (CI, coverage, advisories, secrets, open ' +
    'follow-ups) before treating the milestone as done.';
} else {
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec already exists at ` +
    `${specPath} - implement it with strict TDD (red-green, one acceptance criterion at a ` +
    "time per this project's own testing conventions), then invoke the devkit-reviewer " +
    'subagent against the diff. Once it returns a ship verdict, run the devkit-ship ' +
    'subagent as a preflight (CI, coverage, advisories, secrets, open follow-ups) ' +
    'before treating the milestone as done.';
}

process.stderr.write(`${message}\n`);
process.exit(2);
