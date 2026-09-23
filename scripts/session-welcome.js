#!/usr/bin/env node
'use strict';

// SessionStart hook: prints a short "what do I do next" nudge, covering five
// states - the project has its own loop skill (defer), no PROGRESS.md yet
// (bootstrap guidance), an unstarted milestone whose spec flags something
// SENSITIVE, an unstarted milestone with no spec, or one with a spec ready.
// Never blocks anything; always exits 0.
//
// Also invoked directly (not just as a hook) by the devkit-help skill, which
// runs this same script and relays its output conversationally - so the
// automatic and on-demand paths can never drift out of sync.
//
// Whether SessionStart stdout is surfaced to the user the same way a
// Stop/PostToolUse hook's stderr is has NOT been verified against a live
// harness. If the automatic banner doesn't appear, `devkit-help` is the
// verified fallback: it runs this script and relays the result as a normal
// reply.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const lease = require('./lib/lease');
const arm = require('./lib/arm');
const { detectProvider, describeProvider } = require('./lib/provider');

const hookInput = d.readStdinJson();

// Only greet on a genuinely new session, not a --resume/--continue, a /clear,
// or a compaction - that would be repetitive noise mid-project. Defaults to
// showing the message when `source` is absent or unrecognised, erring toward
// being seen once rather than silently never firing.
if (hookInput && hookInput.source && hookInput.source !== 'startup') process.exit(0);

const dir = d.projectDir();
if (!dir) process.exit(0);

const config = d.readStageConfig(dir);
const provider = detectProvider();
const providerLine = describeProvider(provider);

// Appended to every banner below rather than printed on its own, so it rides
// along with something worth reading. Silent on a stock Claude session; see
// describeProvider.
function say(text) {
  const body = text.trim();
  process.stdout.write(`${providerLine ? `${body}\n\n${providerLine}` : body}\n`);
}

// This banner defers for the same reason continue-loop does, plus one of its
// own: without it, every session in such a project opened with advice
// pointing at devkit-* components it doesn't use, signing off "the Stop hook
// will nudge automatically" - false precisely BECAUSE continue-loop deferred.
// Say something short and true rather than nothing, since devkit-help invokes
// this script directly and silence there would look broken.
if (!d.devkitOwnsLoop(dir, config)) {
  say(`
rajesh-devkit: this project has its own spec-loop skill, so the Stop hook
defers to it and will not nudge between milestones - that project's loop owns
its own stop conditions. Use it as you normally would.

The report-only components still work on demand if you want them:
devkit-reviewer (review the diff), devkit-ship (pre-ship preflight),
devkit-dep-audit (dependency advisories), devkit-stats (timing and cost).

To hand the loop to this plugin instead, add "loop": "devkit" to
.claude/devkit.json - the project's own skill stays on disk as a fallback.
`);
  process.exit(0);
}

const progressPath = path.join(dir, 'PROGRESS.md');
if (!fs.existsSync(progressPath)) {
  say(`
rajesh-devkit is installed, but this project has no PROGRESS.md yet - the
one file the loop actually needs to have anything to nudge toward. Before
that:

  1. If you haven't already, talk through what this project actually is
     (the product intent, not conventions) and save it somewhere like
     docs/product_vision.md - a conversation, not a command.
  2. Run \`claude init\` to generate/update CLAUDE.md from the repo as it
     stands.
  3. Break the vision into milestones and write PROGRESS.md - a table per
     phase, every row starting unstarted, e.g.:

       | # | Milestone | Status |
       |---|---|---|
       | 1 | <name> | (unstarted glyph) |

  4. Optionally seed docs/adr/ if any big, hard-to-reverse decisions are
     already made.

Once PROGRESS.md exists with an unstarted row, this message will say what's
next instead of this.
`);
  process.exit(0);
}

const on = (stage) => d.stageEnabled(config, stage);
// Named, not blocked: a loop that implements without review, security or
// ship is legitimate, but the config file makes it look identical to one
// that simply has not been thought about. See skippedGates in lib/devkit.js.
const skipped = d.skippedGates(config);
const gateNote =
  skipped.length === 0
    ? ''
    : ` Note: implement is on but ${skipped.join(', ')} ${skipped.length === 1 ? 'is' : 'are'} off, ` +
      'so code this loop writes is called done without that check. If that is deliberate, ' +
      'ignore this; if not, add the stage to .claude/devkit.json.';
// checkpointCommit's whole design assumes devkit-deliver squashes the `wip:`
// run into the milestone commit at ship. With deliver off, nothing does -
// the checkpoints simply accumulate on the branch, one per criterion, and
// whoever commits next inherits a history nobody wanted. The combination is
// still legitimate (someone may squash by hand, or want the trail), so this
// names it rather than refusing it - same rule as the gate note above.
const orphanCheckpointNote =
  config.checkpointCommit && !d.stageEnabled(config, 'deliver')
    ? ' Note: checkpointCommit is on but the deliver stage is off, so the per-criterion ' +
      '`wip:` commits it makes will pile up with nothing to squash them - devkit-deliver ' +
      'is what normally does that at ship. Squash them yourself before the milestone ' +
      'commit, or turn one of the two off.'
    : '';

const stageLine =
  config.source === 'default'
    ? ''
    : `\nLoop stages enabled here (${config.source}): ${config.stages.join(', ')}.` +
      gateNote +
      orphanCheckpointNote;

// How the loop gets going from here. Under the default keyword start the
// banner must not read as an instruction to begin - it once did ("Read that
// spec and continue from criterion N"), and a session opened for other work
// set off on the milestone. It says what is next and how to start it, and
// the session stays the user's until they do.
const loopHint =
  config.loopStart === 'always'
    ? 'Just keep working - the Stop hook will nudge toward whatever this loop does next when ' +
      'the session pauses.'
    : 'Nothing starts on its own: say "devkit continue" when you want the loop to take this ' +
      'milestone ("devkit continue all" to run the whole queue unattended), and "devkit pause" ' +
      'to stop it. Until then this session is free for anything else.';

const milestone = d.findNextMilestone(progressPath, config.parked);
if (!milestone) {
  // An empty queue used to be a dead end - "add a row when you have one".
  // It is the one moment the loop can close on itself: what shipped, what
  // was deferred and what production says are all in the repo, and
  // devkit-roadmap turns them into the next rows. Point there instead.
  say(
    'rajesh-devkit: no unstarted milestone found in PROGRESS.md - nothing queued right now. ' +
      'Say "devkit roadmap" to propose the next milestones from what shipped, the open ' +
      'Tracked follow-ups, the gap to the product vision and any production signal the ' +
      'repo records - it proposes rows and writes them only when you approve.'
  );
  process.exit(0);
}

// Is somebody else already holding this milestone in this tree?
//
// Checked here, before any of the branches below, because every one of them
// ends in an instruction to go and do the work - and "resume at criterion 4"
// aimed at a milestone another session is four files into is the single most
// expensive thing this banner can say. See lib/lease.js for the incident.
//
// Deliberately not a block. The session is told what was found and asked to
// settle it with the owner; it is not stopped, and this hook does not try to
// work out which of the two sessions has the better claim. It cannot know -
// a second window opened on purpose looks identical from here to a collision.
const sessionId = hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
const transcript =
  hookInput && typeof hookInput.transcript_path === 'string' ? hookInput.transcript_path : null;
const ttl = lease.ttlMs(config);
const worktree = lease.worktreeId(dir);

// Everything from here to the exit is best-effort: a lease that cannot be read
// or written leaves the banner exactly as it was before any of this existed.
let conflict = null;
try {
  conflict = lease.findConflict({ dir, sessionId, milestone: milestone.display, worktree, ttl });
} catch {
  conflict = null;
}

function branchName() {
  const r = spawnSync('git', ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? '').trim() || null;
}

// Claimed whether or not a conflict was found, but only by a session that is
// actually driving the loop. Standing down silently would make a driving
// session invisible to the next one to arrive; claiming from a session that
// merely opened in this tree is what made unrelated sessions report each
// other as collisions at every stop - see lib/arm.js. Under the default
// keyword start a brand-new session is never driving yet, so it claims
// nothing until `devkit continue`.
if (sessionId && arm.isDriving(dir, config, sessionId, milestone.display)) {
  lease.renew(
    dir,
    { sessionId, milestone: milestone.display, worktree, branch: branchName(), transcript },
    { ttl }
  );
}

if (conflict) {
  say(
    [
      `rajesh-devkit: another session appears to be working ${milestone.display} in this same`,
      `working tree right now.`,
      ``,
      ...lease.describeConflict(conflict),
      `  this tree   ${worktree}`,
      ``,
      `So the usual "resume at criterion N" instruction is being withheld: acting on it`,
      `would mean two sessions writing the same milestone from the same starting point,`,
      `which is how the same file gets created twice and a test baseline goes stale`,
      `without anyone noticing.`,
      ``,
      `Ask the owner which session should own ${milestone.display} before writing anything`,
      `for it. If that other session is finished or dead, its claim clears by itself`,
      `within ${Math.round(ttl / 60000)} minutes, or you can delete its entry from`,
      `.claude/rajesh-devkit/${lease.LEASE_FILE}. If both sessions are wanted, give this`,
      `one a different milestone - reading, reviewing and answering questions here are`,
      `all fine.`,
    ].join('\n')
  );
  process.exit(0);
}

const specPath = d.findSpecForMilestone(dir, milestone.number, milestone.name);

const relSpec = specPath ? path.relative(dir, specPath).split(path.sep).join('/') : null;
const uxMissing = specPath && on('ux') && !fs.existsSync(specPath.replace(/\.md$/, '.ux.md'));
const specStatus = d.readSpecStatus(specPath);

// The resume path, and the reason write-resume.js exists.
//
// A session killed by a usage limit gets no turn: no Stop hook, no summary,
// no chance to write down where it was. The session that picks the work up
// afterwards is a NEW one - a fresh window, another machine, or the same
// work continued on a different provider - and it starts with no memory of
// any of it. Resumption therefore cannot be a matter of remembering; it has
// to be a matter of reading. This banner is that read: one file, written by
// a hook after the last edit that actually happened, printed before anything
// else is decided.
const resume = (() => {
  const raw = d.readFileOrNull(path.join(d.telemetryDir(dir), 'resume.json'));
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw);
    // Only a checkpoint for the milestone that is actually next. A stale
    // file describing something already shipped would send the session
    // backwards, which is worse than having no checkpoint at all.
    return r && r.milestone === milestone.display ? r : null;
  } catch {
    return null;
  }
})();

if (resume && resume.started && resume.nextCriterion) {
  const parts = [
    `rajesh-devkit: ${resume.milestone} is mid-flight.`,
    ``,
    `  spec        ${resume.spec ?? '(none)'}${resume.specStatus ? ` (${resume.specStatus})` : ''}`,
    `  criteria    ${resume.criteria} ticked - resume at criterion ${resume.nextCriterion}`,
    resume.branch ? `  branch      ${resume.branch}` : null,
    `  tree        ${resume.dirty === null ? 'unknown' : resume.dirty ? 'dirty - uncommitted work from the last run' : 'clean'}`,
    `  checkpoint  ${resume.updatedAt}, on ${resume.provider}`,
    ``,
    `When the loop picks it up, it continues from criterion ${resume.nextCriterion}: do not`,
    `restart the milestone or re-run finished criteria - the ticks and the working`,
    `tree are the record of what is already done.`,
    ``,
    `${loopHint}${stageLine}`,
  ].filter((l) => l !== null);
  say(parts.join('\n'));
  process.exit(0);
}

if (specStatus === 'draft' && on('implement')) {
  say(`
rajesh-devkit: next milestone is ${milestone.display} - its spec (${relSpec}) is
still Status: Draft, so nothing should be built from it yet. Go through the
spec with the owner and get it marked Approved (or changed) first; the loop
can take it once the header says Approved.${stageLine}
`);
} else if (specStatus === 'implemented') {
  say(`
rajesh-devkit: next milestone is ${milestone.display}, but its spec (${relSpec})
already says Status: Implemented - so the tracker row is stale, not the work.
Check the spec's criteria against the repo and fix whichever of the two is
wrong. Do not re-implement it.${stageLine}
`);
} else if (d.isSensitiveSpec(specPath, config) && on('implement')) {
  say(`
rajesh-devkit: next milestone is ${milestone.display} - its spec (${relSpec}) flags
one or more requirements as SENSITIVE (an existing invariant, a
security/authorization boundary, a data-model change, an external
integration, or a backward-compatibility break).

Nothing should be written for this milestone until you decide the approach:
implement it yourself at higher reasoning, or delegate to
devkit-implementer as normal. That choice is yours to make before the work
starts, not after - being shown finished code and asked to bless it is not
the same decision.${stageLine}
`);
} else if (!specPath && on('specify')) {
  say(`
rajesh-devkit: next milestone is ${milestone.display} - no spec yet.
Let's start creating the first spec: say "devkit spec this feature: ${milestone.name}"
to draft one with devkit-specify.

${loopHint}${stageLine}
`);
} else if (!specPath) {
  // This loop doesn't own the spec stage, so there's nothing to suggest
  // until somebody else writes one. Say so rather than nudging them to do
  // work their role explicitly excluded.
  say(`
rajesh-devkit: next milestone is ${milestone.display}, and it has no spec yet.
This project's loop doesn't include the spec stage, so there's nothing
queued here until one exists.${stageLine}
`);
} else if (uxMissing) {
  say(`
rajesh-devkit: next milestone is ${milestone.display} - spec ready at ${relSpec},
but there's no UX spec for it yet. Say "devkit ux spec" to invoke devkit-ux before
implementation starts, so the screens and their empty/loading/error states
are decided deliberately rather than mid-build.

${loopHint}${stageLine}
`);
} else {
  say(`
rajesh-devkit: next milestone is ${milestone.display} - spec ready at ${relSpec}.

${loopHint}${stageLine}
`);
}

process.exit(0);
