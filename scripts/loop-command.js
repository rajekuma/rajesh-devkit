#!/usr/bin/env node
'use strict';

// UserPromptSubmit hook: the two words that start and stop the loop.
//
//   devkit continue       this session takes the next milestone; the Stop hook
//                         drives it until it ships, then waits to be asked again
//   devkit continue all   the same, for the whole queue - an unattended run
//   devkit pause          this session stops being driven, and drops its claim
//
// Matched only at the start of a prompt (see lib/arm.js), so talking ABOUT
// the loop never arms or pauses it. Anything else passes straight through.
//
// Why a prompt hook rather than a skill. A skill is the model deciding to do
// something; this has to be a fact the Stop hook can read on the next stop,
// in a later process, with no model in between. The user's own words are
// the only signal that means "yes, this session, now" - so they are read
// where the harness hands them over, and recorded on disk.
//
// stdout on exit 0 is added to the conversation as context, which is how the
// session learns what was just armed and what to do first. Always exits 0: a
// broken state directory must never swallow what the user typed.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const arm = require('./lib/arm');
const lease = require('./lib/lease');

const hookInput = d.readStdinJson();
const command = arm.parseCommand(hookInput && hookInput.prompt);
if (!command) process.exit(0);

const dir = d.projectDir();
if (!dir) process.exit(0);
const config = d.readStageConfig(dir);

function say(text) {
  process.stdout.write(`${text.trim()}\n`);
  process.exit(0);
}

if (!d.devkitOwnsLoop(dir, config)) {
  say(
    'rajesh-devkit: this project runs its own loop skill, so "devkit continue" and "devkit ' +
      'pause" do nothing here. Add "loop": "devkit" to .claude/devkit.json to hand the loop ' +
      'to this plugin.'
  );
}

const sessionId = hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
if (!sessionId) {
  say('rajesh-devkit: no session id in the hook payload, so the loop state cannot be changed.');
}

if (command.action === 'pause') {
  arm.disarm(dir, sessionId);
  // The claim goes too. A paused session that still held its milestone would
  // be reported to the next session as "another session is working this",
  // which is the false alarm this whole mechanism exists to end.
  lease.release(dir, sessionId);
  say(
    'rajesh-devkit: loop paused for this session. The Stop hook will not push toward any ' +
      'milestone, and this session no longer claims one. Finish or park the current step ' +
      'safely - leave the suite in a known state and say where you stopped - then do whatever ' +
      'the user asks next. Say "devkit continue" to resume; the ticks and resume.json keep ' +
      'the place.'
  );
}

// continue. Under "loopStart": "always" every session already drives, but the
// arm is still recorded and the reply says so, so the keyword is never a
// silent no-op that leaves someone wondering whether it worked.
const progressPath = path.join(dir, 'PROGRESS.md');
const milestone = fs.existsSync(progressPath) ? d.findNextMilestone(progressPath, config.parked) : null;
if (!milestone) {
  say(
    'rajesh-devkit: there is no unstarted milestone in PROGRESS.md, so there is nothing for ' +
      'the loop to take. Say "devkit roadmap" to propose the next milestones.'
  );
}

// Refuse to start on a milestone another live session already holds. Found
// in real use: `devkit continue` armed a fallback session for M29 while a
// Claude session was already working it, so every stop raised the collision
// question; the user answered "other work", the hook could not hear it, and
// asked again at the next stop - each time forcing another 100k-token turn
// through a paid gateway. Nothing is armed here, so there is nothing to
// repeat: the user decides, and says `devkit continue` again when it's free.
let conflict = null;
try {
  conflict = lease.findConflict({
    dir,
    sessionId,
    milestone: milestone.display,
    worktree: lease.worktreeId(dir),
    ttl: lease.ttlMs(config),
  });
} catch {
  conflict = null;
}
if (conflict) {
  say(
    [
      `rajesh-devkit: loop NOT started - another session is already working ${milestone.display} ` +
        'in this working tree:',
      ...lease.describeConflict(conflict),
      '',
      'Nothing was started in this session, and it claims nothing, so you will not be asked ' +
        'about this again. Tell the user, then do whatever else they want. To hand the ' +
        `milestone to this session instead: say "devkit pause" (or /exit) in the other one, ` +
        'then "devkit continue" here. A session that died frees its claim by itself within ' +
        `${Math.round(lease.ttlMs(config) / 60000)} minutes.`,
    ].join('\n')
  );
}

arm.arm(dir, sessionId, command.all ? arm.ALL : milestone.display);

// What to do first is exactly what the Stop hook would say at this moment,
// so ask it rather than keeping a second copy of the chain here to drift.
// The session is now armed, so it answers as it would for a driving session
// - including a collision with another live session, which then decides
// what happens next instead of a start instruction.
const nudge = spawnSync(process.execPath, [path.join(__dirname, 'continue-loop.js')], {
  input: JSON.stringify({
    session_id: sessionId,
    transcript_path: typeof hookInput.transcript_path === 'string' ? hookInput.transcript_path : undefined,
  }),
  encoding: 'utf8',
  env: process.env,
});
const next = nudge.status === 2 ? (nudge.stderr ?? '').trim() : '';

const scope = command.all
  ? 'for every milestone in the queue, starting with'
  : 'for';
say(
  [
    `rajesh-devkit: loop started in this session ${scope} ${milestone.display}. ` +
      (command.all
        ? 'It carries on to each next milestone until the queue is empty or you say "devkit pause".'
        : 'It stops when this milestone ships; say "devkit continue" again for the next one, ' +
          'or "devkit pause" to stop sooner.') +
      (config.loopStart === 'always'
        ? ' (This project uses "loopStart": "always", so the loop drives every session anyway.)'
        : ''),
    '',
    next || 'The Stop hook has nothing to nudge toward for this milestone right now.',
  ].join('\n')
);
