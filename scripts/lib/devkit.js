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

function readStdin() {
  try {
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
function milestoneRowPattern(glyphs) {
  const alt = glyphs.map((g) => g).join('|');
  return new RegExp(`^\\s*\\|\\s*([\\w.]+)\\s*\\|\\s*(.+?)\\s*\\|\\s*(${alt})\\s*(\\||$)`, 'u');
}

// The first milestone that isn't finished: a table row marked not-started or
// in-progress, or a plain `- [ ]` task line, whichever appears first.
// Returns null when there's nothing queued, which is a normal outcome.
function findNextMilestone(progressPath) {
  const lines = readLines(progressPath);
  if (!lines) return null;
  const rowRe = milestoneRowPattern([GLYPH.notStarted, GLYPH.hourglass]);
  const taskRe = /^\s*-\s*\[\s*\]\s*(.+)$/;

  for (const line of lines) {
    const row = line.match(rowRe);
    if (row) {
      const number = row[1];
      const name = row[2].trim();
      return { number, name, display: `M${number} - ${name}` };
    }
    const task = line.match(taskRe);
    if (task) {
      const name = task[1].trim();
      return { number: null, name, display: name };
    }
  }
  return null;
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

function isSensitiveSpec(specPath) {
  if (!specPath) return false;
  const text = readFileOrNull(specPath);
  return text !== null && SENSITIVE_MARKER.test(text);
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

function appendTelemetry(dir, event, milestone, timestamp = new Date().toISOString()) {
  const outDir = telemetryDir(dir);
  fs.mkdirSync(outDir, { recursive: true });
  ensureGitignoreEntry(dir);
  const line = JSON.stringify({ event, milestone, timestamp });
  fs.appendFileSync(path.join(outDir, 'telemetry.jsonl'), `${line}\n`, 'utf8');
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
  readStdin,
  readStdinJson,
  projectDir,
  hasOwnLoopSkill,
  readFileOrNull,
  readLines,
  findNextMilestone,
  readMilestoneStatuses,
  findSpecForMilestone,
  isSensitiveSpec,
  ensureGitignoreEntry,
  telemetryDir,
  appendTelemetry,
  nudgeStatePath,
  readNudgeState,
  writeNudgeState,
};
