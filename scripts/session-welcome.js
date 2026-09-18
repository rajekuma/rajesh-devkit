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
const d = require('./lib/devkit');

const hookInput = d.readStdinJson();

// Only greet on a genuinely new session, not a --resume/--continue, a /clear,
// or a compaction - that would be repetitive noise mid-project. Defaults to
// showing the message when `source` is absent or unrecognised, erring toward
// being seen once rather than silently never firing.
if (hookInput && hookInput.source && hookInput.source !== 'startup') process.exit(0);

const dir = d.projectDir();
if (!dir) process.exit(0);

function say(text) {
  process.stdout.write(`${text.trim()}\n`);
}

// This banner defers for the same reason continue-loop does, plus one of its
// own: without it, every session in such a project opened with advice
// pointing at devkit-* components it doesn't use, signing off "the Stop hook
// will nudge automatically" - false precisely BECAUSE continue-loop deferred.
// Say something short and true rather than nothing, since devkit-help invokes
// this script directly and silence there would look broken.
if (d.hasOwnLoopSkill(dir)) {
  say(`
rajesh-devkit: this project has its own spec-loop skill, so the Stop hook
defers to it and will not nudge between milestones - that project's loop owns
its own stop conditions. Use it as you normally would.

The report-only components still work on demand if you want them:
devkit-reviewer (review the diff), devkit-ship (pre-ship preflight),
devkit-dep-audit (dependency advisories), devkit-stats (timing and cost).
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

const config = d.readStageConfig(dir);
const on = (stage) => d.stageEnabled(config, stage);
const stageLine =
  config.source === 'default'
    ? ''
    : `\nLoop stages enabled here (${config.source}): ${config.stages.join(', ')}.`;

const milestone = d.findNextMilestone(progressPath);
if (!milestone) {
  say(
    'rajesh-devkit: no unstarted milestone found in PROGRESS.md - nothing queued right now. ' +
      "Add a new row when there's a next milestone to work on."
  );
  process.exit(0);
}

const specPath = d.findSpecForMilestone(dir, milestone.number, milestone.name);

const relSpec = specPath ? path.relative(dir, specPath).split(path.sep).join('/') : null;
const uxMissing = specPath && on('ux') && !fs.existsSync(specPath.replace(/\.md$/, '.ux.md'));

if (d.isSensitiveSpec(specPath) && on('implement')) {
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
to draft one with devkit-specify. Once it exists, just keep working - the
Stop hook will nudge toward whatever this loop does next when the session
pauses.${stageLine}
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
are decided deliberately rather than mid-build.${stageLine}
`);
} else {
  say(`
rajesh-devkit: next milestone is ${milestone.display} - spec ready at ${relSpec}.
Just keep working - the Stop hook will nudge toward whatever this loop does
next when the session pauses.${stageLine}
`);
}

process.exit(0);
