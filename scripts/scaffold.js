#!/usr/bin/env node
'use strict';

// Not a hook. devkit-onboard runs this, after asking the user, to lay down
// the starter files a project needs for the loop:
//
//   node scaffold.js <project-dir> [--items a,b,...] [--preset <name>] [--git-init] [--dry-run]
//   node scaffold.js --list
//
// Why a script and not the model writing files. Starter files are the same
// every time; a model re-typing a template drifts, truncates or "improves"
// it, and nothing checks. A copy is exact, is tested, and can promise the one
// thing that matters most in someone's project: it never overwrites a file
// that already exists. Filling in the placeholders is the conversation's job
// (devkit-vision, devkit-onboard); copying the skeletons is this script's.
//
// The templates live in <plugin>/templates/ under neutral names: a file
// named CLAUDE.md, or a .claude/rules/ folder, inside the plugin's own tree
// would be loaded by Claude Code as live instructions whenever someone works
// on the plugin itself.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const d = require('./lib/devkit');

const TEMPLATES = path.join(__dirname, '..', 'templates');

// item -> [template file, destination relative to the project], in the order
// they are offered.
const ITEMS = {
  gitattributes: [['gitattributes.txt', '.gitattributes']],
  'claude-md': [['project-CLAUDE.md', 'CLAUDE.md']],
  vision: [['product_vision.md', path.join('docs', 'product_vision.md')]],
  progress: [['PROGRESS.md', 'PROGRESS.md']],
  rules: [
    ['rules-testing.md', path.join('.claude', 'rules', 'testing.md')],
    ['rules-architecture.md', path.join('.claude', 'rules', 'architecture.md')],
    ['rules-conventions.md', path.join('.claude', 'rules', 'conventions.md')],
    ['rules-workflow.md', path.join('.claude', 'rules', 'workflow.md')],
  ],
  adr: [
    ['adr-template.md', path.join('docs', 'adr', '0000-template.md')],
    ['adr-0001-record-architecture-decisions.md', path.join('docs', 'adr', '0001-record-architecture-decisions.md')],
  ],
  'spec-template': [['spec-template.md', path.join('specs', '_template.md')]],
};

const DESCRIPTIONS = {
  gitattributes: 'LF line endings on every OS',
  'claude-md': 'CLAUDE.md - short, always-loaded project context',
  vision: 'docs/product_vision.md - skeleton for the product intent',
  progress: 'PROGRESS.md - the milestone tracker the loop reads',
  rules: '.claude/rules/ - testing, architecture, conventions, workflow',
  adr: 'docs/adr/ - ADR template and ADR-0001',
  'spec-template': 'specs/_template.md - the spec format devkit-specify writes',
};

function usage(code) {
  process.stderr.write(
    'usage: node scaffold.js <project-dir> [--items a,b,...] [--preset <name>] [--git-init] [--dry-run]\n' +
      '       node scaffold.js --list\n'
  );
  process.exit(code);
}

function list() {
  process.stdout.write('Starter items (all by default):\n');
  for (const [k, v] of Object.entries(DESCRIPTIONS)) process.stdout.write(`  ${k.padEnd(14)} ${v}\n`);
  process.stdout.write(`Presets for .claude/devkit.json: ${Object.keys(d.STAGE_PRESETS).join(', ')}\n`);
}

function parseArgs(argv) {
  const opts = { target: null, items: null, preset: null, gitInit: false, dryRun: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--git-init') opts.gitInit = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--items') opts.items = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--preset') opts.preset = argv[++i] || '';
    else if (a.startsWith('--')) usage(1);
    else if (!opts.target) opts.target = a;
    else usage(1);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) return list();
  if (!opts.target) usage(1);
  const dir = path.resolve(opts.target);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    process.stderr.write(`scaffold: ${dir} is not a directory\n`);
    process.exit(1);
  }
  const dryRun = opts.dryRun;
  const wanted = opts.items || Object.keys(ITEMS);
  const unknown = wanted.filter((w) => !ITEMS[w]);
  if (unknown.length) {
    process.stderr.write(`scaffold: unknown item(s): ${unknown.join(', ')}. Run with --list.\n`);
    process.exit(1);
  }
  const presetName = opts.preset;
  if (presetName && !d.presetStages(presetName)) {
    process.stderr.write(`scaffold: unknown preset "${presetName}" - one of ${Object.keys(d.STAGE_PRESETS).join(', ')}\n`);
    process.exit(1);
  }

  const out = [];
  const verb = dryRun ? 'would create' : 'created';

  if (opts.gitInit) {
    const isRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf8' });
    if (!isRepo.error && isRepo.status === 0) {
      out.push('kept     git repository (already initialised)');
    } else if (dryRun) {
      out.push('would run git init');
    } else {
      const r = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
      out.push(r.status === 0 ? 'ran      git init' : `FAILED   git init: ${(r.stderr || '').trim()}`);
    }
  }

  for (const item of wanted) {
    for (const [src, rel] of ITEMS[item]) {
      const dest = path.join(dir, rel);
      const shown = rel.split(path.sep).join('/');
      if (fs.existsSync(dest)) {
        out.push(`kept     ${shown} (already exists - never overwritten)`);
        continue;
      }
      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(TEMPLATES, src), dest);
      }
      out.push(`${verb.padEnd(8)} ${shown}`);
    }
  }

  if (presetName) {
    const dest = path.join(dir, d.CONFIG_PROJECT);
    if (fs.existsSync(dest)) {
      out.push(`kept     .claude/devkit.json (already exists - set "preset": "${presetName}" in it by hand)`);
    } else {
      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, `${JSON.stringify({ preset: presetName, loopStart: 'keyword' }, null, 2)}\n`, 'utf8');
      }
      out.push(`${verb.padEnd(8)} .claude/devkit.json (preset "${presetName}": ${d.presetStages(presetName).join(', ')})`);
    }
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

main();
