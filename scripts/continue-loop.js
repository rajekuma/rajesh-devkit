#!/usr/bin/env node
'use strict';

// Stop hook: reads the JSON the harness pipes on stdin, looks for the first
// unfinished milestone in the host project's PROGRESS.md, and if found blocks
// the stop (exit 2) with a stderr instruction telling Claude what to do next
// - draft a spec first if none exists yet, otherwise implement it. Exits 0
// (allow the stop) in every other case: no PROGRESS.md, nothing unstarted
// left, the project has its own loop skill, or the nudge cap is hit.

const d = require('./lib/devkit');
const lease = require('./lib/lease');

const NUDGE_CAP = 8;

const hookInput = d.readStdinJson();

// The harness's own recursion guard: this Stop is already a continuation of a
// previous Stop-hook block. Don't stack another one on top of it.
if (hookInput && hookInput.stop_hook_active === true) process.exit(0);

const dir = d.projectDir();
if (!dir) process.exit(0);

const path = require('path');
const fs = require('fs');

const config = d.readStageConfig(dir);
const on = (stage) => d.stageEnabled(config, stage);

// See lib/devkit.js - a project with its own loop owns its stop conditions,
// unless it has explicitly handed them over with "loop": "devkit".
if (!d.devkitOwnsLoop(dir, config)) process.exit(0);

const progressPath = path.join(dir, 'PROGRESS.md');
if (!fs.existsSync(progressPath)) process.exit(0);

const milestone = d.findNextMilestone(progressPath, config.parked);
if (!milestone) process.exit(0);

const specPath = d.findSpecForMilestone(dir, milestone.number, milestone.name);

// A spec's own Status header, where the project keeps one. This is an
// approval gate, not decoration: a Draft spec is one nobody has signed off,
// and nudging toward implementing it walks straight past the review the
// project put there deliberately. No header means this project doesn't use
// the convention, and the loop behaves exactly as it did before.
const specStatus = d.readSpecStatus(specPath);

// Nothing to nudge toward if this loop doesn't own the spec stage and no spec
// exists yet - a UX-only or ship-only loop waits for someone else to write
// it rather than telling them to.
if (!specPath && !on('specify')) process.exit(0);

// Liveness, before anything that drives the loop forward.
//
// This hook has the same blind spot session-welcome had: it derives "what
// next" entirely from on-disk checkpoint state, none of which records whether
// a session is currently running against this tree. Left alone it will happily
// push a second session into a milestone another one is four files into.
//
// Placement is load-bearing in both directions. Below the guard above,
// because a loop with nothing to nudge toward says nothing at all today, and
// a collision warning about a milestone this hook would never have driven
// toward is noise in a loop that deliberately stays quiet - there is no
// forward motion here to suppress. Above the nudge counter and the telemetry
// append, because a collision is not a nudge toward the milestone: it must
// not burn one of the eight, and it must not log `milestone_started` for work
// this session is being told not to start.
const sessionId =
  hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
const ttl = lease.ttlMs(config);
const worktree = lease.worktreeId(dir);

let conflict = null;
try {
  conflict = lease.findConflict({ dir, sessionId, milestone: milestone.display, worktree, ttl });
} catch {
  // Fail open. A session that cannot read the lease file is a session that
  // carries on exactly as it did before any of this existed.
  conflict = null;
}

if (sessionId) {
  const { spawnSync } = require('child_process');
  const b = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
  lease.renew(
    dir,
    {
      sessionId,
      milestone: milestone.display,
      worktree,
      branch: !b.error && b.status === 0 ? (b.stdout ?? '').trim() || null : null,
      transcript:
        hookInput && typeof hookInput.transcript_path === 'string'
          ? hookInput.transcript_path
          : null,
    },
    { ttl }
  );
}

if (conflict) {
  // Exit 2, like every other gate here, because exit 0 would let the session
  // stop silently and the collision would go unsaid - the failure mode this
  // whole change exists to fix. What it blocks is the STOP, not the work: the
  // session is handed a question to put to the user, exactly as the SENSITIVE
  // gate does. The harness's own stop_hook_active guard above means this can
  // fire at most once per stop chain.
  //
  // Repeats on later stops while the conflict is still live, rather than being
  // remembered as shown-once like the escalation gate. That gate marks a
  // moment that passes; this one describes a condition that is either still
  // true or has cleared itself on the TTL.
  process.stderr.write(
    [
      `Another session appears to be working ${milestone.display} in this same working tree:`,
      ...lease.describeConflict(conflict),
      '',
      'Do NOT continue this milestone on that basis, and do not start or resume any ' +
        'criterion of it. Two sessions implementing one milestone from the same checkpoint ' +
        'is how the same file gets written twice and a test baseline goes stale unnoticed.',
      '',
      `Ask the user which session should own ${milestone.display}. If the other one is ` +
        `finished or dead its claim expires by itself within ${Math.round(ttl / 60000)} ` +
        `minutes; if both sessions are wanted, this one needs a different milestone. ` +
        'Reading, reviewing and answering questions here are all fine meanwhile.',
    ].join('\n')
  );
  process.exit(2);
}

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
// A Draft spec stops the loop short of implementation, whatever else is
// true. It outranks the escalation gate below - not because it matters more,
// but because it comes first in time: there is no point asking how to build
// something nobody has approved building. Kept separate from the escalation
// flag too, so a milestone that pauses here still gets its one escalation
// message later, once the spec is approved.
const draftBlocked = specStatus === 'draft' && on('implement');

// The tracker says unfinished, the spec says Implemented. One of them is
// stale, and it is nearly always the tracker - the spec header is written at
// the moment of shipping, the row is updated by hand afterwards. Re-running
// the whole chain over a bookkeeping slip would be the expensive way to find
// that out.
const trackerStale = specStatus === 'implemented';

// Work that has visibly started cannot be gated on a decision about how to
// start it. The "shown once per milestone" memory lives in OS temp, keyed by
// project path - which means it does NOT survive the two cases this loop now
// explicitly supports: picking the work up on another machine, or in a fresh
// session after a usage limit. Found in a resume drill: a session resuming a
// milestone with 7 of 36 criteria already green was told "WRITE NO CODE YET,
// ask the user how to approach this" - about work a human had already
// approved and seven tests already proved. The gate exists to put a human in
// front of the *first* line of code; a ticked criterion is proof that moment
// has passed. The ticks are in the repo, so unlike the temp file they travel
// with the work.
const started = (() => {
  const c = d.countCriteria(specPath);
  return Boolean(c && c.done > 0);
})();

const isSensitive =
  d.isSensitiveSpec(specPath, config) &&
  on('implement') &&
  !draftBlocked &&
  !trackerStale &&
  !started;

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
  if (on('quality')) {
    steps.push(
      'invoke the devkit-quality subagent against the diff (design and performance - ' +
        'layering drift, duplication, N+1 and unbounded reads, checked against this ' +
        "project's own architecture rules; the reviewer checks the spec, not the shape);"
    );
  }
  if (on('security')) {
    steps.push(
      'invoke the devkit-security subagent against the diff (it checks code you wrote for ' +
        'authorization, tenant-isolation and injection gaps - devkit-dep-audit covers ' +
        'dependencies, which is a different question);'
    );
  }
  if (on('ship')) {
    steps.push(
      'once review returns a ship verdict, run the devkit-ship subagent as a preflight ' +
        '(CI, coverage, advisories, secrets, open follow-ups, and a row for every other ' +
        "gate's verdict - one it has not seen is UNKNOWN, not a pass);"
    );
  }
  if (on('docs')) {
    steps.push(
      'then invoke the devkit-docs subagent to record what shipped and fix the ' +
        'documentation the change just made wrong;'
    );
  }
  if (on('release')) {
    steps.push(
      'if this milestone closes a Phase, invoke the devkit-release subagent to decide the ' +
        'version bump from what shipped, roll the changelog into a versioned section and ' +
        'draft release notes (it never tags - it ends with the tag command for a human);'
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
    // "Treat the milestone as done" was the whole closing instruction, and it
    // named nobody. Every other step here hands work to a component that owns
    // it; this one assumed the orchestrator would update the tracker on its
    // own initiative. When it doesn't, nothing fails - the row stays
    // unfinished, so findNextMilestone keeps returning this same milestone,
    // the Stop hook re-nudges work that is already finished, and
    // track-milestones never logs the "shipped" half of the telemetry pair,
    // so devkit-stats can never report this milestone at all. Say what "done"
    // actually means, in files.
    steps.push(
      'then close the milestone out: mark its row done in PROGRESS.md (matching the ' +
        'glyph and inline-note style the other rows already use), add an entry to the ' +
        "session log if this project keeps one, set the spec's own `Status:` header to " +
        'Implemented if it has one, and clear the `## In flight` block if it has one.'
    );
    if (!on('deliver')) {
      // Deliver is off by default, so for most projects this is the normal
      // path, not an edge case: the loop leaves finished work uncommitted and
      // the human decides when it lands. Worth saying out loud, because the
      // failure it prevents is assuming a milestone shipped when it is
      // sitting in the working tree.
      steps.push(
        'This loop does not commit - the `deliver` stage is off - so stop there and say ' +
          'the work is complete but uncommitted, rather than committing on your own ' +
          'initiative.'
      );
    }
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
} else if (trackerStale) {
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec (${specPath}) is already ` +
    'marked `Status: Implemented`, so what is out of date is the tracker row, not the work. ' +
    'Do NOT re-implement it. Check that spec\'s acceptance criteria against the repo: if the ' +
    'work really did ship, mark the PROGRESS.md row done (and add a session-log entry if this ' +
    'project keeps one); if it did not, the spec header is wrong and that is what needs ' +
    'correcting. Say which of the two you found.';
} else if (draftBlocked) {
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec (${specPath}) is ` +
    'marked `Status: Draft` - nobody has approved it, so nothing should be built from it ' +
    'yet. WRITE NO CODE for this milestone. Walk the user through what the spec says (its ' +
    'behaviour, its edge cases, and what it leaves out), and ask whether to mark it ' +
    '`Status: Approved` or what to change first. Once the header says Approved, this loop ' +
    'continues on its own.';
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
  // Where the spec's own ticks say the work has got to. Said out loud
  // because this nudge is also what a RESUMED session sees first - after a
  // usage limit, a crash, or a move to another machine - and "carry on from
  // criterion 8 of 24" is a different instruction from "implement this
  // spec", even though the chain that follows is identical.
  const criteria = d.countCriteria(specPath);
  const progress =
    criteria && criteria.done > 0 && criteria.done < criteria.total
      ? ` ${criteria.done} of its ${criteria.total} acceptance criteria are already ticked - ` +
        `resume at criterion ${criteria.done + 1} rather than starting over, and check the ` +
        'working tree for the one that was in progress.'
      : '';
  message =
    `Next milestone from PROGRESS.md: ${milestone.display}. Its spec is at ${specPath}.` +
    `${progress} ` +
    next.join(' ');
}

process.stderr.write(`${message}\n`);
process.exit(2);
