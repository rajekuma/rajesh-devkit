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

const config = d.readStageConfig(dir);
const on = (stage) => d.stageEnabled(config, stage);

const specPath = d.findSpecForMilestone(dir, milestone.number, milestone.name);

// Nothing to nudge toward if this loop doesn't own the spec stage and no spec
// exists yet - a UX-only or ship-only loop waits for someone else to write
// it rather than telling them to.
if (!specPath && !on('specify')) process.exit(0);

// devkit-ux writes specs/<name>.ux.md alongside the feature spec.
const uxSpecPath = specPath ? specPath.replace(/\.md$/, '.ux.md') : null;
const uxDone = uxSpecPath ? fs.existsSync(uxSpecPath) : false;

// Sensitive-milestone escalation gate: devkit-specify marks a requirement
// "SENSITIVE:" when it touches an existing invariant, a security/auth
// boundary, a data-model change, an external integration, or a
// backward-compatibility break. If the spec has one, this milestone
// shouldn't be nudged toward standard delegation the way an ordinary one is -
// the escalation message below asks the orchestrator to stop and ask the user
// whether to implement it directly at higher reasoning instead. Shown once
// per milestone, not on every repeat nudge: once surfaced, a human has had
// the chance to act on it.
// Only gate when this loop is actually the thing that would cause the
// implementation. If `implement` isn't an enabled stage, the escalation
// message - which is entirely about whether to delegate to
// devkit-implementer - has nothing to ask about.
const isSensitive = d.isSensitiveSpec(specPath) && on('implement');

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

// The instruction for each stage after design, in chain order, filtered to
// the ones this project enabled. Built rather than hardcoded so a loop never
// names a stage its owner switched off - the whole point of stage config.
function downstream() {
  const steps = [];
  if (on('datamodel')) {
    steps.push(
      'invoke the devkit-datamodel subagent for the schema and migration plan (a ' +
        'data-model change without a backfill and rollback story is how a migration ships ' +
        'broken);'
    );
  }
  if (on('implement')) {
    steps.push(
      'implement it with strict TDD (red-green, one acceptance criterion at a time, per ' +
        "this project's own testing conventions);"
    );
  }
  if (on('ui-verify')) {
    steps.push(
      'invoke the devkit-ui-verify subagent to run the built UI through every state the ' +
        'UX spec named - a passing suite and a broken screen coexist comfortably;'
    );
  }
  if (on('review')) {
    steps.push('invoke the devkit-reviewer subagent against the diff;');
  }
  if (on('ship')) {
    steps.push(
      'once review returns a ship verdict, run the devkit-ship subagent as a preflight ' +
        '(CI, coverage, advisories, secrets, open follow-ups);'
    );
  }
  if (on('docs')) {
    steps.push(
      'then invoke the devkit-docs subagent to record what shipped and fix the ' +
        'documentation the change just made wrong;'
    );
  }
  if (on('pipeline')) {
    steps.push(
      'and check the delivery pipeline with the devkit-pipeline subagent if this ' +
        "milestone changed how the project builds, deploys or is scanned;"
    );
  }
  if (on('deliver')) {
    steps.push(
      'and hand it to the devkit-deliver subagent to branch, commit, push and - at a Phase ' +
        'boundary only - open the PR;'
    );
  }
  if (steps.length > 0) {
    steps.push('then treat the milestone as done.');
  }
  return steps;
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
    `draft one first: say "devkit spec this feature: ${milestone.name}" to invoke ` +
    'devkit-specify and write specs/<kebab-case-feature>.md.' +
    (downstream().length > 0 ? ` Once the spec exists: ${downstream().join(' ')}` : '');
} else if (on('ux') && !uxDone) {
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec is at ${specPath}, but ` +
    'it has no UX spec yet - invoke the devkit-ux subagent to produce ' +
    `${uxSpecPath}: the screens and the states that actually break interfaces (empty, ` +
    'loading, error, permission-denied), reusing this project\'s existing components and ' +
    'tokens, and appending accessibility criteria to the feature spec\'s own acceptance ' +
    'list so the later stages gate on them.' +
    (downstream().length > 0 ? ` After that: ${downstream().join(' ')}` : '');
} else {
  const next = downstream();
  // Every stage this loop owns is either done or not its business. Stop
  // rather than inventing work - this is what lets a two-stage loop (a
  // product owner's specify-and-document, say) end cleanly instead of
  // nagging toward stages nobody enabled.
  if (next.length === 0) process.exit(0);
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec is at ${specPath}. ` +
    next.join(' ');
}

process.stderr.write(`${message}\n`);
process.exit(2);
