#!/usr/bin/env node
'use strict';

// PostToolUse hook (matched on Edit|Write): rewrites
// .claude/rajesh-devkit/resume.json with where this loop actually is, derived
// entirely from the repo - milestone, spec, spec status, criteria ticked,
// branch, whether the tree is dirty, and which provider is serving the
// session. Never blocks anything; always exits 0.
//
// Why a hook rather than an instruction. A usage-limit block gives the
// session no turn at all: no Stop hook, no chance to tidy up, no chance to
// refresh a prose checkpoint. Until now the only record of "where we were"
// was PROGRESS.md's `## In flight` block, which the MODEL writes because it
// was told to - so its freshness depended on nothing having gone wrong,
// which is exactly the assumption a hard stop breaks. Worse, resumption in
// practice leaned on the session's own context surviving, and that
// disappears the moment work continues in a new session (a different
// machine, or a different provider after a limit).
//
// PostToolUse is the one event that has already fired by then: it runs after
// every single edit, so whatever is on disk when the session dies was
// described a moment earlier. This file is therefore never more than one
// edit stale, needs no cooperation from the model, and lets a cold session
// resume from one read instead of a rediscovery pass.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');
const lease = require('./lib/lease');
const arm = require('./lib/arm');
const { detectProvider } = require('./lib/provider');

// Drains the harness payload, and reads the session identity out of it. This
// hook fires after every single edit, which makes it the most frequent sign of
// life this plugin can publish - see lib/lease.js.
const hookInput = d.readStdinJson();

const dir = d.projectDir();
if (!dir) {
  // Said out loud, where every other hook here stays silent, because this
  // one's silence is misleading: a hand-run with no harness environment
  // writes nothing, and the resume.json already on disk keeps reading as if
  // it were current. That nearly produced a reading of "4/36" for a
  // milestone that was 36/36 - `updatedAt` was the only clue, and nobody
  // looks at a timestamp when the file looks plausible. The harness always
  // sets CLAUDE_PROJECT_DIR, so this can only ever print on a manual run:
  // no noise in the loop itself.
  const lines = [
    'write-resume: CLAUDE_PROJECT_DIR is not set (or not a directory), so nothing was written. ' +
      'This hook is meant to run under the harness; set CLAUDE_PROJECT_DIR to run it by hand.',
  ];
  const guess = d.readFileOrNull(path.join(process.cwd(), '.claude', 'rajesh-devkit', 'resume.json'));
  if (guess !== null) {
    let when = 'an unknown time';
    try {
      const at = JSON.parse(guess).updatedAt;
      if (typeof at === 'string') when = at;
    } catch {
      /* a corrupt checkpoint is still worth pointing at */
    }
    lines.push(
      `The resume.json in this directory was NOT refreshed - it describes the tree as of ${when}, ` +
        'not as it is now.'
    );
  }
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

const config = d.readStageConfig(dir);

// Same deferral as every other writing hook: in a project whose own loop
// owns the stop conditions, this file would be state nothing reads.
if (!d.devkitOwnsLoop(dir, config)) process.exit(0);

const progressPath = path.join(dir, 'PROGRESS.md');
if (!fs.existsSync(progressPath)) process.exit(0);

// The milestone THIS session is working: within its lane, if it was started
// with `devkit continue phase N` or `devkit continue M<n>`. Each worktree keeps
// its own resume.json, so in parallel lanes each checkpoint describes its own
// lane's milestone rather than whichever row happens to be first.
const earlySession = hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
const milestone = d.findNextMilestone(progressPath, config.parked, arm.scopeOf(dir, earlySession));
if (!milestone) process.exit(0);

function git(...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? '').trim();
}

const specPath = d.findSpecForMilestone(dir, milestone.number, milestone.name);
const relSpec = specPath ? path.relative(dir, specPath).split(path.sep).join('/') : null;
const uxSpecPath = specPath ? specPath.replace(/\.md$/, '.ux.md') : null;

// The furthest stage whose OUTPUT exists on disk. Deliberately derived from
// artifacts rather than from what the session said it was doing: a claim of
// having reviewed something leaves no trace, a written spec does. An
// artifact that exists is evidence; anything else would be a guess wearing a
// field name.
function derivedStage() {
  if (!specPath) return 'specify';
  if (d.stageEnabled(config, 'ux') && uxSpecPath && !fs.existsSync(uxSpecPath)) return 'ux';
  const criteria = d.countCriteria(specPath);
  if (criteria && criteria.done < criteria.total) return 'implement';
  if (criteria && criteria.done === criteria.total) return 'review';
  return 'implement';
}

const criteria = d.countCriteria(specPath);
const status = d.readSpecStatus(specPath);
const provider = detectProvider();
const dirtyOut = git('status', '--porcelain');

const resume = {
  milestone: milestone.display,
  milestoneNumber: milestone.number,
  spec: relSpec,
  specStatus: status,
  sensitive: d.isSensitiveSpec(specPath, config),
  stage: derivedStage(),
  criteria: criteria ? `${criteria.done}/${criteria.total}` : null,
  nextCriterion: criteria && criteria.done < criteria.total ? criteria.done + 1 : null,
  // Whether there is anything to resume TO. A milestone with 0 of 36
  // criteria ticked has a perfectly good "next criterion" - the first one -
  // and is not mid-flight by any useful definition. Without this the banner
  // greeted an untouched milestone with "picking up M28, mid-flight",
  // which is both false and the wrong instruction: it says carry on where
  // the session should be running the gates that come before the first
  // line of code.
  started: Boolean(criteria && criteria.done > 0),
  branch: git('branch', '--show-current'),
  dirty: dirtyOut === null ? null : dirtyOut.length > 0,
  provider: provider.name,
  checkpointCommit: config.checkpointCommit,
  updatedAt: new Date().toISOString(),
};

// Republished on every edit, next to the checkpoint that says where the work
// got to. The two are the same story told twice: resume.json is "how far", the
// lease is "by whom, and are they still here". Renewing here rather than only
// on Stop matters because an edit is proof of activity that a stop is not -
// a session can sit at a stop for an hour waiting on a human.
//
// Never guarded by its own try/catch here: lease.renew swallows its own
// failures and returns false, so an unwritable state directory cannot take
// this edit down with it.
const sessionId = hookInput && typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
// Only a session actually driving this milestone claims it. An edit in a
// session doing other work is not a sign of life on the milestone, and
// publishing it as one is what made unrelated sessions report each other as
// collisions - see lib/arm.js. The checkpoint below is still written: where
// the work got to is true whoever is in the tree.
if (sessionId && arm.isDriving(dir, config, sessionId, milestone)) {
  lease.renew(
    dir,
    {
      sessionId,
      milestone: milestone.display,
      worktree: lease.worktreeId(dir),
      branch: resume.branch,
      transcript:
        hookInput && typeof hookInput.transcript_path === 'string' ? hookInput.transcript_path : null,
    },
    { ttl: lease.ttlMs(config) }
  );
}

const outDir = d.telemetryDir(dir);
try {
  fs.mkdirSync(outDir, { recursive: true });
  d.ensureGitignoreEntry(dir);
  // Written whole, every time, rather than merged: a half-updated resume
  // file is worse than none, because the next session trusts it.
  fs.writeFileSync(path.join(outDir, 'resume.json'), `${JSON.stringify(resume, null, 2)}\n`, 'utf8');
} catch {
  // A checkpoint that cannot be written must not take the edit down with it.
}

process.exit(0);
