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

const profilePath = path.join(__dirname, 'openrouter.json');

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

async function main() {
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
    console.log(
      `  ok       ${tier.padEnd(7)} ${id}  in ${perMillion(p.prompt)} / out ${perMillion(p.completion)}`
    );
  }

  console.log('');
  if (bad > 0) {
    console.log(`${bad} of ${wanted.length} model IDs do not exist. Fix ${profilePath} before using this profile.`);
    process.exit(1);
  }
  console.log(`All ${wanted.length} model IDs exist. Prices above are OpenRouter's list prices today.`);
}

main();
