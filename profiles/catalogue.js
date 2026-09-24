'use strict';

// The gateway's model catalogue, and which models are new since you last
// looked. Used by `node profiles/check.js --new` (the full list) and by the
// launcher (at most one line a week). Nothing here runs during the loop:
// new models are a choice you make when picking a profile, not something to
// interrupt a milestone with.
//
// "New" means new to THIS machine's record, kept in ~/.devkit/ beside the
// key file - outside every repository, per machine, never committed.
//
// A new model is a candidate, not a recommendation. Only models that support
// tool calling are listed, because Claude Code cannot run on any other kind -
// and even those have to earn a place through an eval (see
// docs/model-learnings.md): "supports tools" has already been shown to be
// necessary and not sufficient.

const fs = require('fs');
const os = require('os');
const path = require('path');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function statePath() {
  return path.join(os.homedir(), '.devkit', 'model-catalogue.json');
}

// Missing or corrupt reads as "no record yet" - the quiet direction.
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      seen: Array.isArray(s.seen) ? s.seen : null,
      seenAt: typeof s.seenAt === 'string' ? s.seenAt : null,
      lastNotice: typeof s.lastNotice === 'string' ? s.lastNotice : null,
    };
  } catch {
    return { seen: null, seenAt: null, lastNotice: null };
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// The catalogue lives at <baseUrl>/v1/models for OpenRouter-style gateways.
// A timeout, because the launcher must never hang in front of a user who is
// trying to get back to work after a usage limit.
async function fetchCatalogue(baseUrl, timeoutMs = 10000) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const body = await res.json();
  return Array.isArray(body.data) ? body.data : [];
}

const supportsTools = (m) => (m.supported_parameters || []).includes('tools');

function newToolModels(catalogue, seen) {
  if (!seen) return [];
  const known = new Set(seen);
  return catalogue.filter((m) => !known.has(m.id) && supportsTools(m));
}

const perMillion = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${(n * 1e6).toFixed(2)}` : '?';
};

function describe(m) {
  const p = m.pricing || {};
  const cache = p.input_cache_read != null ? ` (cached ${perMillion(p.input_cache_read)})` : '';
  return `${m.id}  in ${perMillion(p.prompt)}${cache} / out ${perMillion(p.completion)} per M, ctx ${m.context_length ?? '?'}`;
}

module.exports = { WEEK_MS, statePath, readState, writeState, fetchCatalogue, supportsTools, newToolModels, describe };
