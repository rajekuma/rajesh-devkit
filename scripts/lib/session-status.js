'use strict';

// Which session worked what, and when - told to the person, not the model.
//
// Why this exists. Reported in real use: a project worked milestone after
// milestone across several long-lived sessions, each compacted more than once.
// Coming back a week later, nothing in a session said when it was last worked
// or which milestone it was on, and the sidebar's generated titles still named
// whatever the session opened with. The only way to find the latest window was
// to open two or three and read them. Everything needed was already on disk;
// none of it was shown.
//
// So a session that has driven the loop gets three things, all from hooks and
// none needing a model turn:
//   - a dated line at the end of every turn (Stop `systemMessage`), which stays
//     in the transcript, so a week later the last one still says when;
//   - the same line on resume, plus a warning if another session is more recent;
//   - a title naming its milestone (`sessionTitle`), unless the user named it.
// `devkit sessions` prints the registry below, newest first.
//
// Only a session that drove the loop is ever mentioned. One opened for other
// work gets nothing (PRINCIPLES 4). `"sessionStatus": false` turns it all off.
//
// Why the registry lives in the git directory. A desktop or lane session often
// runs in its own worktree, and that worktree is deleted when the session is
// archived. `.claude/rajesh-devkit/` is per worktree, so a registry there could
// neither see the other windows nor outlive them. The common git directory is
// shared by all of them, is never tracked, and needs no .gitignore edit.
// Found without spawning git, because this runs on every prompt.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./devkit');
const arm = require('./arm');
const journeys = require('./journeys');

const REGISTRY_FILE = 'sessions.json';
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;
const MAX_LISTED = 10;
const MAX_TITLE = 60;

function registryPath(dir) {
  try {
    const dotGit = path.join(dir, '.git');
    const stat = fs.statSync(dotGit);
    if (stat.isDirectory()) return path.join(dotGit, 'rajesh-devkit', REGISTRY_FILE);
    if (stat.isFile()) {
      // A linked worktree: `.git` is a file naming its private git directory,
      // and `commondir` in there names the shared one.
      const match = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
      if (match) {
        const gitDir = path.resolve(dir, match[1]);
        const common = d.readFileOrNull(path.join(gitDir, 'commondir'));
        const shared = common ? path.resolve(gitDir, common.trim()) : gitDir;
        return path.join(shared, 'rajesh-devkit', REGISTRY_FILE);
      }
    }
  } catch {
    // No .git at all: a project that isn't a repository still has one tree.
  }
  return path.join(d.telemetryDir(dir), REGISTRY_FILE);
}

// Missing or corrupt reads as "no session has been here": the quiet direction.
function readAll(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(dir), 'utf8'));
    const sessions = parsed && parsed.sessions;
    return sessions && typeof sessions === 'object' && !Array.isArray(sessions) ? sessions : {};
  } catch {
    return {};
  }
}

function writeAll(dir, sessions, now) {
  const file = registryPath(dir);
  const tmp = `${file}.${process.pid}.tmp`;
  const kept = Object.entries(sessions)
    .filter(([, e]) => e && now - Date.parse(e.lastAt) < MAX_AGE_MS)
    .sort(([, a], [, b]) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
    .slice(0, MAX_SESSIONS);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, sessions: Object.fromEntries(kept) }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing left to clean */
    }
    return false;
  }
}

function update(dir, sessionId, patch, now = Date.now()) {
  if (!sessionId) return false;
  const sessions = readAll(dir);
  sessions[sessionId] = { ...sessions[sessionId], lastAt: new Date(now).toISOString(), ...patch };
  return writeAll(dir, sessions, now);
}

// A sign of life from an edit. A session killed by a usage limit never reaches
// Stop, so without this its registry entry would be older than its last work.
// Never creates an entry: an edit alone does not make a session a loop session.
function touch(dir, sessionId, now = Date.now()) {
  if (!sessionId || !readAll(dir)[sessionId]) return false;
  return update(dir, sessionId, {}, now);
}

function enabled(config) {
  return !config || config.sessionStatus !== false;
}

const pad = (n) => String(n).padStart(2, '0');

// Local time, because this is read by the person who sat there. It stays in the
// transcript, so it has to be an absolute date: "2 hours ago" is wrong by the
// time anyone needs it.
function when(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'unknown time';
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown';
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'under an hour';
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

function stageOf(dir, milestone) {
  const spec = d.findSpecForMilestone(dir, milestone.number, milestone.name);
  if (!spec) return 'no spec yet';
  if (d.readSpecStatus(spec) === 'draft') return 'spec is Draft, awaiting approval';
  const c = d.countCriteria(spec);
  if (!c) return 'spec ready';
  if (c.done === c.total) return `all ${c.total} criteria ticked, gates and close-out next`;
  return c.done === 0 ? `not started, ${c.total} criteria` : `implementing, ${c.done}/${c.total} criteria`;
}

// Where this session stands, read from the tracker and the spec rather than from
// anything the session said. `state` is working, done or paused.
function snapshot(dir, config, sessionId, entry) {
  const progress = path.join(dir, 'PROGRESS.md');
  const next = d.findNextMilestone(progress, config.parked);
  const mine = d.findNextMilestone(progress, config.parked, arm.scopeOf(dir, sessionId));
  if (mine && arm.isDriving(dir, config, sessionId, mine)) {
    return { state: 'working', milestone: mine.display, stage: stageOf(dir, mine), next: null };
  }
  const last = entry && entry.milestone;
  if (!last) return null;
  const row = Object.values(d.readMilestoneStatuses(progress)).find((s) => s.display === last);
  // A row that is gone or renamed is not proof of anything finished.
  const state = row && row.done ? 'done' : 'paused';
  const other = next && next.display !== last ? next.display : null;
  return { state, milestone: last, stage: null, next: state === 'done' ? other : null };
}

function summaryOf(s) {
  if (s.state === 'working') return `${s.milestone} | ${s.stage}`;
  if (s.state === 'paused') return `${s.milestone} | paused, say "devkit continue" to resume`;
  return `${s.milestone} | done${s.next ? ` | next: ${s.next}, say "devkit continue"` : ' | queue empty'}`;
}

function titleOf(s) {
  const short = (display) => display.replace(/^(M\S+) - /, '$1 ');
  const id = (display) => (display.match(/^M\S+/) || [short(display)])[0];
  let title = short(s.milestone);
  if (s.state === 'paused') title = `${title} (paused)`;
  if (s.state === 'done') title = `${id(s.milestone)} done${s.next ? `, next ${id(s.next)}` : ''}`;
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 3)}...` : title;
}

function gitBits(dir) {
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000 });
    return r.error || r.status !== 0 ? null : (r.stdout ?? '').trim();
  };
  const status = git('status', '--porcelain');
  return { branch: git('branch', '--show-current') || null, dirty: status === null ? null : status.length > 0 };
}

function treeOf({ branch, dirty }) {
  const parts = [];
  if (branch) parts.push(`branch ${branch}`);
  if (dirty === true) parts.push('uncommitted changes');
  if (dirty === false) parts.push('clean');
  return parts.join(', ');
}

// Null unless this session has actually been on the loop. An arm counts, so a
// session armed before this registry existed is recognised on its first stop.
function trackedEntry(dir, config, sessionId) {
  if (!sessionId || !enabled(config) || !d.devkitOwnsLoop(dir, config)) return null;
  if (!fs.existsSync(path.join(dir, 'PROGRESS.md'))) return null;
  const entry = readAll(dir)[sessionId];
  if (entry) return entry;
  const mine = d.findNextMilestone(path.join(dir, 'PROGRESS.md'), config.parked, arm.scopeOf(dir, sessionId));
  const armed = Boolean(arm.readArms(dir)[sessionId]);
  return armed || (mine && arm.isDriving(dir, config, sessionId, mine)) ? {} : null;
}

// The end-of-turn line. Written with writeSync because this runs from an exit
// handler, where an asynchronous stdout write on a Windows pipe can be lost.
function stopFooter(hookInput, now = Date.now()) {
  try {
    if (!hookInput || hookInput.hook_event_name !== 'Stop') return;
    const dir = d.projectDir();
    if (!dir) return;
    const sessionId = typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
    const config = d.readStageConfig(dir);
    const entry = trackedEntry(dir, config, sessionId);
    if (!entry) return;
    const s = snapshot(dir, config, sessionId, entry);
    if (!s) return;
    const bits = gitBits(dir);
    const summary = summaryOf(s);
    update(dir, sessionId, { milestone: s.milestone, summary, branch: bits.branch }, now);
    const tree = treeOf(bits);
    const journeyBit = journeys.lastRunSummary(dir, config);
    const line =
      `DevKit | last worked ${when(new Date(now).toISOString())} | ${summary}` +
      `${tree ? ` | ${tree}` : ''}${journeyBit ? ` | ${journeyBit}` : ''}`;
    fs.writeSync(1, `${JSON.stringify({ systemMessage: line })}\n`);
  } catch {
    // A status line is never worth a failed stop.
  }
}

function newerSession(dir, sessionId, entry) {
  const mine = Date.parse(entry.lastAt);
  const newer = Object.entries(readAll(dir))
    .filter(([id, e]) => id !== sessionId && e && Date.parse(e.lastAt) > mine)
    .sort(([, a], [, b]) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  return newer.length > 0 ? newer[0][1] : null;
}

function nameOf(entry) {
  return entry.customTitle || entry.titleSet || entry.milestone || 'unnamed';
}

// A session coming back: resumed, or compacted mid-work. Null when there is
// nothing to say, so the caller stays silent as it always did.
function returnReport(hookInput, now = Date.now()) {
  try {
    const dir = d.projectDir();
    if (!dir || !hookInput) return null;
    const sessionId = typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
    const config = d.readStageConfig(dir);
    const entry = trackedEntry(dir, config, sessionId);
    if (!entry || !entry.lastAt) return null;
    const s = snapshot(dir, config, sessionId, entry);
    if (!s) return null;
    const summary = summaryOf(s);
    const out = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `rajesh-devkit status of this session: ${summary}.`,
      },
    };
    // The user is shown it on a resume only. A compaction happens mid-work, and
    // the end-of-turn line is about to say the same thing.
    if (hookInput.source === 'resume') {
      const newer = newerSession(dir, sessionId, entry);
      const lines = [`DevKit | back after ${ago(entry.lastAt, now)} | last worked ${when(entry.lastAt)} | ${summary}`];
      if (newer) {
        lines.push(
          `This is not the latest window: "${nameOf(newer)}" worked ${newer.milestone || 'a milestone'} on ` +
            `${when(newer.lastAt)}. Say "devkit sessions" to list them.`
        );
      }
      out.systemMessage = lines.join('\n');
      const title = nextTitle(dir, config, sessionId, hookInput, entry, s, now);
      if (title) out.hookSpecificOutput.sessionTitle = title;
    }
    return out;
  } catch {
    return null;
  }
}

// What to retitle this session to, or null to leave it. `session_title` is only
// present for a custom title, which also covers one this hook set, so a value
// differing from ours means the user named the session and it stays theirs.
function nextTitle(dir, config, sessionId, hookInput, entry, s, now = Date.now()) {
  const current = typeof hookInput.session_title === 'string' ? hookInput.session_title : null;
  if (current && current !== entry.titleSet) {
    if (entry.customTitle !== current) update(dir, sessionId, { customTitle: current, lastAt: entry.lastAt }, now);
    return null;
  }
  const title = titleOf(s);
  if (title === entry.titleSet) return null;
  update(dir, sessionId, { titleSet: title, customTitle: undefined, lastAt: entry.lastAt }, now);
  return title;
}

// For a UserPromptSubmit that is not a loop command. A title that catches up
// with a milestone finished since the last prompt; Stop cannot set one.
function promptTitle(hookInput, now = Date.now()) {
  try {
    const dir = d.projectDir();
    if (!dir || !hookInput) return null;
    const sessionId = typeof hookInput.session_id === 'string' ? hookInput.session_id : null;
    const config = d.readStageConfig(dir);
    const entry = trackedEntry(dir, config, sessionId);
    if (!entry || !entry.lastAt) return null;
    const s = snapshot(dir, config, sessionId, entry);
    return s ? nextTitle(dir, config, sessionId, hookInput, entry, s, now) : null;
  } catch {
    return null;
  }
}

// `devkit continue` or `devkit pause` just changed this session's state. Records
// it and returns the title to set, if any.
function recordCommand(dir, config, sessionId, hookInput, now = Date.now()) {
  try {
    if (!sessionId || !enabled(config)) return null;
    const previous = readAll(dir)[sessionId] || {};
    const s = snapshot(dir, config, sessionId, previous);
    if (!s) return null;
    const summary = summaryOf(s);
    update(dir, sessionId, { milestone: s.milestone, summary }, now);
    const entry = readAll(dir)[sessionId] || previous;
    return nextTitle(dir, config, sessionId, hookInput, { ...entry, lastAt: new Date(now).toISOString() }, s, now);
  } catch {
    return null;
  }
}

// `devkit sessions`. From what each session recorded at its last stop, because
// another worktree's tracker is not readable from here. Dated, so it never reads
// as more current than it is.
function listReport(dir, sessionId, now = Date.now()) {
  const rows = Object.entries(readAll(dir))
    .filter(([, e]) => e && Number.isFinite(Date.parse(e.lastAt)))
    .sort(([, a], [, b]) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  if (rows.length === 0) {
    return 'DevKit sessions: none recorded yet. A session appears here once it has run "devkit continue".';
  }
  const lines = ['DevKit sessions in this project, most recent first:', ''];
  for (const [id, e] of rows.slice(0, MAX_LISTED)) {
    const mark = id === sessionId ? '  <- this session' : '';
    lines.push(`${when(e.lastAt)} (${ago(e.lastAt, now)} ago)  "${nameOf(e)}"  [${id.slice(0, 8)}]${mark}`);
    lines.push(`  as of then: ${e.summary || e.milestone || 'no status recorded'}${e.branch ? ` | branch ${e.branch}` : ''}`);
  }
  if (rows.length > MAX_LISTED) lines.push('', `(${rows.length - MAX_LISTED} older not shown)`);
  return lines.join('\n');
}

module.exports = {
  REGISTRY_FILE,
  registryPath,
  readAll,
  touch,
  enabled,
  stopFooter,
  returnReport,
  promptTitle,
  recordCommand,
  listReport,
};
