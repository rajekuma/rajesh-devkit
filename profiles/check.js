#!/usr/bin/env node
'use strict';

// Checks that every model ID in profiles/openrouter.json still exists, and
// prints what each one costs.
//
// Run this BEFORE relying on a profile, and again whenever a run fails at the
// first request. Provider catalogues change under you - models get renamed,
// versioned, deprecated and pulled - and a stale ID does not fail at launch,
// it fails at the first message, which in this loop means halfway through a
// milestone. That is the one moment when finding out is most expensive, so
// finding out here instead costs one command.
//
// No dependencies and no key needed: the model catalogue is public.

const fs = require('fs');
const path = require('path');

// Any profile in this folder, by name: `node profiles/check.js openrouter-lean`.
// Defaults to the original one. A plain word only, never a path.
//
// `--new` lists instead the tool-capable models the gateway has added since
// this machine last looked, then records them as seen - see catalogue.js.
const argv = process.argv.slice(2);
const listNew = argv.includes('--new');
const profileName = argv.find((a) => a !== '--new') || 'openrouter';
if (!/^[a-z0-9][a-z0-9-]*$/.test(profileName)) {
  console.error('usage: node profiles/check.js [profile-name] [--new]');
  process.exit(1);
}
const profilePath = path.join(__dirname, `${profileName}.json`);

function loadTiers() {
  try {
    const cfg = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    return cfg.tiers || {};
  } catch (e) {
    console.error(`check: cannot read ${profilePath} - ${e.message}`);
    process.exit(1);
  }
}

// Per-token strings in the catalogue; per-million is what everyone quotes.
function perMillion(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?';
  return `$${(n * 1e6).toFixed(2)}/MTok`;
}

async function showNew() {
  const cat = require('./catalogue');
  let baseUrl = 'https://openrouter.ai/api';
  try {
    baseUrl = JSON.parse(fs.readFileSync(profilePath, 'utf8')).baseUrl || baseUrl;
  } catch {
    /* the default gateway is fine for a listing */
  }
  let catalogue;
  try {
    catalogue = await cat.fetchCatalogue(baseUrl);
  } catch (e) {
    console.error(`check: could not reach the model list - ${e.message}`);
    process.exit(1);
  }
  const state = cat.readState();
  const now = new Date().toISOString();
  if (!state.seen) {
    cat.writeState({ ...state, seen: catalogue.map((m) => m.id), seenAt: now, lastNotice: now });
    console.log(
      `First look: recorded ${catalogue.length} models as the baseline. From now on, ` +
        '`node profiles/check.js --new` lists only what the gateway adds after today.'
    );
    return;
  }
  const fresh = cat.newToolModels(catalogue, state.seen);
  if (fresh.length === 0) {
    console.log(`No new tool-capable models since ${state.seenAt}.`);
  } else {
    console.log(`${fresh.length} new tool-capable model(s) since ${state.seenAt}:\n`);
    for (const m of fresh) console.log(`  ${cat.describe(m)}`);
    console.log(
      '\nCandidates, not recommendations. To try one: copy a profile, put its id on the ' +
        '`sonnet` line, then `node tests/run-evals.js --case implementer-red-green --profile ' +
        '<name>`, and record the result in docs/model-learnings.md.'
    );
  }
  cat.writeState({ ...state, seen: catalogue.map((m) => m.id), seenAt: now, lastNotice: now });
}

async function main() {
  if (listNew) return showNew();
  const tiers = loadTiers();
  const wanted = Object.entries(tiers);
  if (wanted.length === 0) {
    console.error('check: no tiers configured');
    process.exit(1);
  }

  let catalogue;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalogue = (await res.json()).data || [];
  } catch (e) {
    console.error(`check: could not reach the OpenRouter model list - ${e.message}`);
    console.error('check: nothing was verified. Do not assume the profile is good.');
    process.exit(1);
  }

  const byId = new Map(catalogue.map((m) => [m.id, m]));
  let bad = 0;

  for (const [tier, id] of wanted) {
    const model = byId.get(id);
    if (!model) {
      bad += 1;
      console.log(`  MISSING  ${tier.padEnd(7)} ${id}`);
      // A near-miss is the usual cause (a version suffix moved), so point at
      // the candidates rather than just saying no.
      const stem = id.split('/').pop().split(/[:-]/)[0];
      const near = catalogue
        .map((m) => m.id)
        .filter((candidate) => candidate.includes(stem))
        .slice(0, 5);
      if (near.length > 0) console.log(`           did you mean: ${near.join(', ')}`);
      continue;
    }
    const p = model.pricing || {};
    const price = `in ${perMillion(p.prompt)} / out ${perMillion(p.completion)}`;
    // Claude Code sends tool definitions with every request, so a model
    // without tool calling fails at the first message. A suggestion to use
    // qwen/qwen-2.5-coder-32b-instruct for the implementer was exactly that
    // case: it exists, it is cheap, and the catalogue lists no tool support.
    if (!(model.supported_parameters || []).includes('tools')) {
      bad += 1;
      console.log(`  NO TOOLS ${tier.padEnd(7)} ${id}  ${price} - Claude Code cannot run on it`);
      continue;
    }
    console.log(`  ok       ${tier.padEnd(7)} ${id}  ${price}`);
  }

  console.log('');
  if (bad > 0) {
    console.log(
      `${bad} of ${wanted.length} models are missing or cannot call tools. Fix ${profilePath} ` +
        'before using this profile.'
    );
    process.exit(1);
  }
  console.log(
    `All ${wanted.length} model IDs exist and support tool calling. Prices above are ` +
      "OpenRouter's list prices today. That is necessary, not sufficient: send one pong " +
      `through it (node profiles/devkit.js ${profileName} -p "Reply with the single word: pong") ` +
      'before relying on it.'
  );
}

main();
