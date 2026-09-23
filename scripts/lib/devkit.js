'use strict';

// Shared helpers for this plugin's hooks.
//
// The PowerShell originals duplicated all of this by copy-paste: the
// spec-loop deference check lived in three files, the sensitive-marker
// pattern and the PROGRESS.md parser in two each. That cost real bugs -
// session-welcome and track-milestones kept nudging and writing after
// continue-loop had already learned to stand down, because "the same check"
// was three separate checks. One module, one definition.
//
// CommonJS on purpose: no package.json, no build step, no dependencies. Node
// is already present wherever Claude Code runs, since Claude Code is a Node
// program.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Status glyphs, written as escapes rather than literals. The PowerShell
// version built these from codepoints because a raw astral character in a
// BOM-less .ps1 was a genuine parse error; JS has no such bug, but escapes
// still keep this file pure ASCII, which survives any editor or codepage
// mishandling on the way to a contributor's disk.
const GLYPH = {
  notStarted: '\u{2B1C}', // WHITE LARGE SQUARE
  hourglass: '\u{23F3}',  // HOURGLASS FLOWING SAND
  inProgress: '\u{1F7E8}', // LARGE YELLOW SQUARE (astral - 4 bytes in UTF-8)
  blocked: '\u{23F8}',    // DOUBLE VERTICAL BAR
  done: '\u{2705}',       // WHITE HEAVY CHECK MARK
};

// The sensitive-requirement marker, matched on its ASCII keyword alone - the
// lock glyph devkit-specify writes in front of it is deliberately NOT
// required. This gate fails OPEN (a missed marker means a milestone that
// should have paused for a human gets auto-delegated instead), so it has to
// tolerate every way a probabilistic writer might render the prefix: no space
// after the glyph, a variation selector (U+FE0F) appended, the glyph dropped
// entirely, or the file read back through the wrong encoding. All of those
// mangle the emoji; none touch the ASCII word. Case stays significant so
// ordinary prose ("sensitive: no") can't trip it, and over-matching is the
// safe direction - a false positive costs one question, a false negative
// costs the whole gate.
const SENSITIVE_MARKER = /SENSITIVE\s*:/;

const TELEMETRY_SUBDIR = path.join('.claude', 'rajesh-devkit');
const GITIGNORE_ENTRY = '.claude/rajesh-devkit/';

// Which stages of the loop this project actually runs. Not everyone wants the
// whole chain: a product owner wants to write specs and document what
// shipped; a UX designer wants the design stage and nothing downstream of it;
// a project that already has its own spec/implement/review wants only the
// parts it lacks. A stage that isn't listed is never nudged toward - and when
// no enabled stage applies, the loop stops rather than pushing on, which is
// what makes a two-stage loop a real loop instead of a crippled one.
const ALL_STAGES = [
  'specify', 'ux', 'datamodel', 'implement', 'ui-verify',
  'review', 'quality', 'security', 'ship', 'docs', 'release', 'pipeline', 'deliver',
];

// 'deliver' is the one stage that is NOT on by default. Every other component
// here is read-only or writes only to the working tree; deliver commits,
// pushes and opens PRs, so a project has to ask for it explicitly rather than
// inheriting it by installing the plugin.
const DEFAULT_STAGES = ALL_STAGES.filter((s) => s !== 'deliver');

// Committed, so a project's declared process is visible and reviewable; the
// local file is gitignored, so one person can run a narrower loop than the
// repo's default without changing it for everyone.
const CONFIG_PROJECT = path.join('.claude', 'devkit.json');
const CONFIG_LOCAL = path.join('.claude', 'rajesh-devkit', 'devkit.local.json');

function readJsonOrNull(file) {
  const text = readFileOrNull(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The default for a project that parks rows without saying how. Matches the
// phrasing a tracker actually uses ("not spec'd", "not specced", "not
// specified") rather than inventing a marker nobody would write.
const DEFAULT_PARKED_PATTERN = "not spec(?:'?d|ced|ified)";

// A regex from config is user input in a hook that must never crash: a bad
// pattern disables itself and says so on stderr, it does not take the loop
// down with it. Same failure direction as every other config read here.
function compilePattern(source, label) {
  if (typeof source !== 'string' || source.length === 0) return null;
  try {
    return new RegExp(source, 'u');
  } catch (e) {
    process.stderr.write(`devkit: ignoring malformed ${label} /${source}/ - ${e.message}\n`);
    return null;
  }
}

// The settings that are not the stage list, read from whichever config file
// won. Split out so readStageConfig stays about stages and this stays about
// everything else a project can say.
function readExtras(cfg) {
  const patterns = Array.isArray(cfg.sensitivePatterns)
    ? cfg.sensitivePatterns.map((p) => compilePattern(p, 'sensitivePattern')).filter(Boolean)
    : [];
  return {
    role: typeof cfg.role === 'string' ? cfg.role : null,
    // Which loop owns this project's stop conditions. "devkit" means this
    // plugin drives, even where a project-local loop skill exists - see
    // ownsLoop.
    loop: cfg.loop === 'devkit' || cfg.loop === 'project' ? cfg.loop : null,
    checkpointCommit: cfg.checkpointCommit === true,
    // Whether a session drives the loop only after `devkit continue`
    // ("keyword", the default) or from the moment it starts ("always", the
    // pre-0.7 behaviour, for a project that runs unattended on purpose).
    // Anything unrecognised is the default - see lib/arm.js.
    loopStart: cfg.loopStart === 'always' ? 'always' : 'keyword',
    // How long another session's lease stays believable without a fresh sign
    // of life. Left raw here and clamped in lib/lease.js, so the bounds live
    // next to the reasoning about what a sane TTL is.
    sessionLeaseTtlMinutes:
      typeof cfg.sessionLeaseTtlMinutes === 'number' && Number.isFinite(cfg.sessionLeaseTtlMinutes)
        ? cfg.sessionLeaseTtlMinutes
        : null,
    parked: compilePattern(
      typeof cfg.parkedPattern === 'string' ? cfg.parkedPattern : DEFAULT_PARKED_PATTERN,
      'parkedPattern'
    ),
    sensitivePatterns: patterns,
    prices: cfg.prices && typeof cfg.prices === 'object' ? cfg.prices : {},
  };
}

// Local overrides project, project overrides "everything on". An unreadable
// or malformed file is treated as absent rather than fatal: a hook that
// crashes on a typo in a config file is worse than one that runs the full
// loop, which is the behaviour every project had before this existed.
//
// The stage list and the rest of the settings are read independently on
// purpose: a config that only sets `loop` or `sensitivePatterns`, with no
// `stages` key at all, used to be discarded wholesale because the stage
// filter rejected it first. Saying one thing should not mean losing the
// others.
function readStageConfig(dir) {
  let stageResult = null;
  let extras = null;

  for (const [file, source] of [[CONFIG_LOCAL, 'local'], [CONFIG_PROJECT, 'project']]) {
    const cfg = readJsonOrNull(path.join(dir, file));
    if (!cfg) continue;
    if (!extras) extras = readExtras(cfg);
    if (stageResult) continue;
    if (!Array.isArray(cfg.stages)) continue;
    const stages = cfg.stages.filter((s) => ALL_STAGES.includes(s));
    if (stages.length === 0) continue;
    stageResult = { stages, source };
  }

  return {
    stages: stageResult ? stageResult.stages : [...DEFAULT_STAGES],
    source: stageResult ? stageResult.source : 'default',
    ...(extras ?? readExtras({})),
  };
}

function stageEnabled(config, stage) {
  return config.stages.includes(stage);
}

// The stages that look at code before it is called done. A loop can switch
// any of them off - that is the point of stage config - but a loop that
// implements and gates nothing is a different thing from a loop that only
// writes specs, and the config file makes the two look identical. Worse, the
// "UNKNOWN, never PASS" discipline lives inside devkit-ship, so switching
// ship off removes the one place an unrun check would have been reported.
// This names what was switched off so the omission is a choice, not an
// oversight. It never blocks anything.
const GATE_STAGES = ['review', 'security', 'ship'];

function skippedGates(config) {
  if (!stageEnabled(config, 'implement')) return [];
  return GATE_STAGES.filter((s) => !stageEnabled(config, s));
}

// The harness pipes a JSON payload and closes the stream, so a blocking read
// is correct there. It is NOT correct on the other path these scripts are
// used: devkit-help runs session-welcome.js directly, and devkit-eval runs
// hooks by hand. If the invoking shell leaves stdin open - an interactive
// terminal, or a tool whose child inherits its pipe - readFileSync(0) waits
// for an EOF that never comes, and the hook hangs until something times it
// out. Measured, not theorised: a direct invocation sat there for the full
// two minutes and was killed.
//
// A TTY can be answered immediately - nothing is ever arriving - so that case
// returns empty rather than hanging. An inherited pipe is indistinguishable
// from a slow harness at this level, so callers on the direct path redirect
// from /dev/null; see the devkit-help skill.
function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// The harness pipes a JSON payload on stdin. Absent or malformed input is a
// normal case, not an error - every hook here has a sane default without it.
function readStdinJson() {
  const raw = readStdin();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function projectDir() {
  const dir = process.env.CLAUDE_PROJECT_DIR;
  if (!dir) return null;
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  return dir;
}

// A project with its own loop skill owns its stop conditions deliberately.
// An unconditional hook would fight them - nudging past a reviewer "discuss"
// verdict or a Phase-boundary pause the skill chose on purpose. Every hook
// that nudges or writes defers on this; see each caller for why it matters
// there specifically.
function hasOwnLoopSkill(dir) {
  return fs.existsSync(path.join(dir, '.claude', 'skills', 'spec-loop', 'SKILL.md'));
}

// Whether THIS plugin drives the loop here. Detection alone was too blunt:
// the project this toolkit was extracted from still carries the spec-loop
// skill it grew out of, so installing the plugin there did nothing at all -
// every hook stood down and there was no way to say "drive anyway" short of
// deleting the old skill and losing the fallback. `"loop": "devkit"` in
// devkit.json is that switch, and it is opt-in: with no config, detection
// wins exactly as before, so no existing project changes behaviour.
function devkitOwnsLoop(dir, config) {
  if (config && config.loop === 'devkit') return true;
  if (config && config.loop === 'project') return false;
  return !hasOwnLoopSkill(dir);
}

function readFileOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readLines(file) {
  const text = readFileOrNull(file);
  if (text === null) return null;
  return text.split(/\r?\n/);
}

// Matches a milestone table row against a set of status glyphs:
//   | 13 | Blocks | <glyph> | ...
//
// The status cell is the glyph PLUS whatever annotation the project writes
// after it. Requiring the glyph to stand alone was a real bug, not a nicety:
// a tracker that writes "| 28 | Expense Categories | <glyph> spec Approved
// 2026-09-18 (seeded system + custom) |" had half its rows silently
// invisible to every hook here, and the loop nudged toward a milestone forty
// rows further down. The annotation is captured (group 4) rather than
// discarded, because "not spec'd" written there is how a project parks a row
// the loop should skip - see findNextMilestone.
function milestoneRowPattern(glyphs) {
  const alt = glyphs.map((g) => g).join('|');
  return new RegExp(
    `^\\s*\\|\\s*([\\w.]+)\\s*\\|\\s*(.+?)\\s*\\|\\s*(${alt})\\s*([^|]*?)\\s*(\\||$)`,
    'u'
  );
}

// The first milestone that isn't finished: a table row marked not-started or
// in-progress, or a plain `- [ ]` task line, whichever appears first.
// Returns null when there's nothing queued, which is a normal outcome.
//
// `parked` skips rows whose status annotation matches it. A tracker that
// doubles as an idea list - "| 29a | Expense Drafting Assistant | <glyph>
// not spec'd - see product_vision.md |" - has rows that are genuinely
// unstarted and genuinely not next: nobody has decided to build them. The
// loop would otherwise stall on the first such row forever, nudging toward a
// spec for something the owner deliberately parked. They are skipped here
// and reported by devkit-help instead, so parked is not the same as hidden.
function findNextMilestone(progressPath, parked = null) {
  const lines = readLines(progressPath);
  if (!lines) return null;
  const rowRe = milestoneRowPattern([GLYPH.notStarted, GLYPH.hourglass]);
  const taskRe = /^\s*-\s*\[\s*\]\s*(.+)$/;

  for (const line of lines) {
    const row = line.match(rowRe);
    if (row) {
      const note = (row[4] ?? '').trim();
      if (parked && note && parked.test(note)) continue;
      const number = row[1];
      const name = row[2].trim();
      return { number, name, note, display: `M${number} - ${name}` };
    }
    const task = line.match(taskRe);
    if (task) {
      const name = task[1].trim();
      if (parked && parked.test(name)) continue;
      return { number: null, name, note: '', display: name };
    }
  }
  return null;
}

// Every parked row, in tracker order - what findNextMilestone skipped and
// why. Nothing acts on these; devkit-help reports them so a row that is
// being passed over stays visible rather than becoming invisible debt.
function findParkedMilestones(progressPath, parked) {
  if (!parked) return [];
  const lines = readLines(progressPath);
  if (!lines) return [];
  const rowRe = milestoneRowPattern([GLYPH.notStarted, GLYPH.hourglass]);
  const out = [];
  for (const line of lines) {
    const row = line.match(rowRe);
    if (!row) continue;
    const note = (row[4] ?? '').trim();
    if (note && parked.test(note)) {
      out.push({ number: row[1], name: row[2].trim(), note, display: `M${row[1]} - ${row[2].trim()}` });
    }
  }
  return out;
}

// Every milestone/task line with its done state, keyed so the same item is
// recognised run to run.
function readMilestoneStatuses(progressPath) {
  const lines = readLines(progressPath);
  if (!lines) return {};
  const rowRe = milestoneRowPattern(Object.values(GLYPH));
  const taskRe = /^\s*-\s*\[( |x|X)\]\s*(.+)$/;
  const statuses = {};

  for (const line of lines) {
    const row = line.match(rowRe);
    if (row) {
      const key = `M${row[1]}`;
      statuses[key] = { display: `M${row[1]} - ${row[2].trim()}`, done: row[3] === GLYPH.done };
      continue;
    }
    const task = line.match(taskRe);
    if (task) {
      const text = task[2].trim();
      statuses[text] = { display: text, done: task[1] !== ' ' };
    }
  }
  return statuses;
}

// Finds a spec for a milestone, matching devkit-specify's own
// specs/<kebab-case-feature>.md convention. Tries the kebab-case guess first
// (name with any trailing "(...)" qualifier stripped), then scans each spec's
// header lines for this milestone's number, in case the filename doesn't
// follow the convention. null is a normal outcome - the milestone simply
// hasn't been spec'd yet.
function findSpecForMilestone(dir, milestoneNumber, milestoneName) {
  const specsDir = path.join(dir, 'specs');
  if (!fs.existsSync(specsDir)) return null;

  const core = String(milestoneName).replace(/\s*\([^)]*\)\s*$/, '');
  const kebab = core.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (kebab) {
    const guess = path.join(specsDir, `${kebab}.md`);
    if (fs.existsSync(guess)) return guess;
  }

  if (milestoneNumber) {
    const escaped = String(milestoneNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`Milestone:.*\\bM?${escaped}\\b`);
    let entries = [];
    try {
      entries = fs.readdirSync(specsDir).filter((f) => f.endsWith('.md')).sort();
    } catch {
      return null;
    }
    for (const name of entries) {
      const file = path.join(specsDir, name);
      const lines = readLines(file);
      if (!lines) continue;
      for (const line of lines.slice(0, 5)) {
        if (re.test(line)) return file;
      }
    }
  }
  return null;
}

// The canonical marker, plus whatever else this project's specs use to say
// the same thing. devkit-specify writes "SENSITIVE:", but a project with its
// own spec template predating this plugin flags the same five categories in
// prose - "Money is `decimal`", "multi-tenancy", "an existing invariant" -
// and the gate silently never fired on any of it. Configured patterns are
// ORed in rather than replacing the marker, so adding one can only make the
// gate fire more often, never less. That is the safe direction: this gate
// fails open, and a false positive costs one question.
function isSensitiveSpec(specPath, config = null) {
  if (!specPath) return false;
  const text = readFileOrNull(specPath);
  if (text === null) return false;
  if (SENSITIVE_MARKER.test(text)) return true;
  const extra = (config && config.sensitivePatterns) || [];
  return extra.some((re) => re.test(text));
}

// A spec's own `Status: Draft | Approved | Implemented` header, if it has
// one. Returns null when the spec uses no such convention, which is not an
// error - most projects don't, and a loop that demanded one would refuse to
// run in them. Only the first few lines are read, because that is where the
// convention puts it and scanning the body would match prose.
function readSpecStatus(specPath) {
  const lines = specPath ? readLines(specPath) : null;
  if (!lines) return null;
  for (const line of lines.slice(0, 6)) {
    const m = line.match(/\bStatus:\s*\**\s*(Draft|Approved|Implemented)\b/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// How far through its acceptance criteria a spec is, counted from the
// checkbox ticks the implementer writes as it goes. Returns null when the
// spec has no checkbox list at all. This is the honest measure of progress
// on disk: it survives a session dying mid-criterion, because the tick was
// written the moment the test went green, not at the end.
function countCriteria(specPath) {
  const lines = specPath ? readLines(specPath) : null;
  if (!lines) return null;
  let total = 0;
  let done = 0;
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[( |x|X)\]\s+\S/);
    if (!m) continue;
    total += 1;
    if (m[1] !== ' ') done += 1;
  }
  return total === 0 ? null : { done, total };
}

// Idempotently ensures one line exists in the host project's .gitignore, so
// the local telemetry folder never gets swept into a commit. Creates the file
// if absent; preserves whatever is there, including a missing trailing
// newline.
function ensureGitignoreEntry(dir, entry = GITIGNORE_ENTRY) {
  const gitignorePath = path.join(dir, '.gitignore');
  const existing = readFileOrNull(gitignorePath) ?? '';
  if (existing.split(/\r?\n/).includes(entry)) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}\n# rajesh-devkit: per-machine dev-loop telemetry, not shared history\n${entry}\n`;
  fs.appendFileSync(gitignorePath, block, 'utf8');
}

// Telemetry lives inside the project rather than a machine-global path, so
// it's discoverable without knowing a hash formula - and is gitignored
// automatically, since it's per-machine data rather than shared history.
function telemetryDir(dir) {
  return path.join(dir, TELEMETRY_SUBDIR);
}

// Best-effort, like every other write this plugin makes to its own state
// directory. It was not, and a test written for the session-lease work found
// it: with a file sitting where `.claude/rajesh-devkit/` belongs, the
// unguarded mkdir threw straight out of continue-loop, which exited 1 with a
// Node stack trace instead of 2 with its nudge - so a state-directory problem
// silently cost the project its entire Stop loop. A dropped telemetry line
// costs devkit-stats one data point.
function appendTelemetry(dir, event, milestone, timestamp = new Date().toISOString()) {
  try {
    const outDir = telemetryDir(dir);
    fs.mkdirSync(outDir, { recursive: true });
    ensureGitignoreEntry(dir);
    const line = JSON.stringify({ event, milestone, timestamp });
    fs.appendFileSync(path.join(outDir, 'telemetry.jsonl'), `${line}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// Nudge-counter state lives outside the repo (OS temp) so it never gets
// committed and never leaks between projects sharing this plugin. The hash is
// uppercase hex to stay byte-identical with the PowerShell implementation's
// BitConverter.ToString output - so an existing state file keeps being found
// after the port, rather than silently resetting someone's nudge count.
function nudgeStatePath(dir) {
  const hash = crypto.createHash('md5').update(dir, 'utf8').digest('hex').toUpperCase();
  const stateDir = path.join(os.tmpdir(), 'rajesh-devkit-continue-loop');
  fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, `${hash}.json`);
}

function readNudgeState(statePath) {
  const text = readFileOrNull(statePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeNudgeState(statePath, state) {
  fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
}

module.exports = {
  GLYPH,
  SENSITIVE_MARKER,
  GITIGNORE_ENTRY,
  ALL_STAGES,
  DEFAULT_STAGES,
  CONFIG_PROJECT,
  CONFIG_LOCAL,
  readStageConfig,
  stageEnabled,
  GATE_STAGES,
  skippedGates,
  readStdin,
  readStdinJson,
  projectDir,
  hasOwnLoopSkill,
  devkitOwnsLoop,
  readFileOrNull,
  readLines,
  findNextMilestone,
  findParkedMilestones,
  readMilestoneStatuses,
  findSpecForMilestone,
  readSpecStatus,
  countCriteria,
  isSensitiveSpec,
  ensureGitignoreEntry,
  telemetryDir,
  appendTelemetry,
  nudgeStatePath,
  readNudgeState,
  writeNudgeState,
};
