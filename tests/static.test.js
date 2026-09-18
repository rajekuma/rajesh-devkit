'use strict';

// Static checks: the plugin's own files are well-formed. These are the cheap
// ones - they catch a syntax error in a hook (which the harness would only
// ever see as an unexplained non-zero exit), a component the harness can't
// trigger because its frontmatter lost its trigger phrases, or a hooks.json
// pointing at a file that isn't in the repo.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PLUGIN_ROOT } = require('./helpers');

function scriptFiles() {
  const dir = path.join(PLUGIN_ROOT, 'scripts');
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

test('every script parses', () => {
  const files = scriptFiles();
  assert.ok(files.length >= 6, `expected at least 6 .js scripts, found ${files.length}`);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${path.basename(f)} failed node --check: ${r.stderr}`);
  }
});

test('script sources are pure ASCII', () => {
  // JS has no astral-parsing bug the way a BOM-less .ps1 did, but keeping
  // these files ASCII means no editor, codepage or transfer mishap can
  // corrupt a glyph the matchers depend on. That is not hypothetical: a raw
  // 4-byte emoji in a .ps1 here was a real parse error, and a second one sat
  // undetected in a comment until a test looked for it.
  for (const f of scriptFiles()) {
    const bytes = fs.readFileSync(f);
    const bad = bytes.findIndex((b) => b > 0x7f);
    assert.strictEqual(
      bad,
      -1,
      `${path.basename(f)} has a non-ASCII byte at offset ${bad} - use a \\u{...} escape`
    );
  }
});

test('no script hardcodes an absolute Windows path', () => {
  for (const f of scriptFiles()) {
    const text = fs.readFileSync(f, 'utf8');
    const m = text.match(/'[A-Za-z]:\\\\/);
    assert.strictEqual(m, null, `${path.basename(f)} has an absolute Windows path - use path.join`);
  }
});

test('the PowerShell hooks are gone, not shadowed', () => {
  // Two implementations of the same logic is the drift this plugin keeps
  // warning about. The port deleted the originals; this makes sure a stray
  // .ps1 hook never reappears alongside its .js replacement.
  const strays = fs
    .readdirSync(path.join(PLUGIN_ROOT, 'scripts'))
    .filter((f) => f.endsWith('.ps1'));
  assert.deepStrictEqual(strays, [], `unexpected PowerShell scripts: ${strays.join(', ')}`);
});

test('every hooks.json command is node, and points at a real file', () => {
  // Checked structurally, against parsed `command` values - NOT by grepping
  // for "powershell". The first version of this test did that and failed
  // three ways at once: hooks.json's own description, a comment in
  // lib/devkit.js, and run-verify.js, which invokes powershell.exe on purpose
  // to run a Windows project's verify.ps1. Matching prose is not measuring
  // behaviour.
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const entries = [];
  for (const event of Object.values(hooks.hooks)) {
    for (const group of event) {
      for (const h of group.hooks) entries.push(h);
    }
  }
  assert.ok(entries.length >= 4, `expected at least 4 hooks, found ${entries.length}`);
  for (const h of entries) {
    assert.strictEqual(h.command, 'node', `hook command is "${h.command}" - would not run off Windows`);
    const target = h.args.find((a) => a.includes('scripts/'));
    assert.ok(target, 'hook has no script argument');
    const rel = target.replace('${CLAUDE_PLUGIN_ROOT}/', '');
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, rel)), `hooks.json points at missing ${rel}`);
  }
});

test('every agent and skill has valid frontmatter', () => {
  const components = [];
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents'))) {
    if (f.endsWith('.md')) {
      components.push({ file: path.join(PLUGIN_ROOT, 'agents', f), expected: f.replace(/\.md$/, ''), kind: 'agent' });
    }
  }
  for (const d of fs.readdirSync(path.join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const skill = path.join(PLUGIN_ROOT, 'skills', d.name, 'SKILL.md');
    if (fs.existsSync(skill)) components.push({ file: skill, expected: d.name, kind: 'skill' });
  }
  assert.ok(components.length >= 10, `expected at least 10 components, found ${components.length}`);

  for (const c of components) {
    const text = fs.readFileSync(c.file, 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(fm, `${c.kind} ${c.expected} has no frontmatter block`);

    const name = fm[1].match(/^name:\s*(\S+)\s*$/m);
    assert.ok(name, `${c.kind} ${c.expected} declares no name`);
    assert.strictEqual(name[1], c.expected, `${c.kind} name does not match its file/folder`);

    assert.match(
      fm[1],
      /^description:\s*\S/m,
      `${c.kind} ${c.expected} has no description - the harness uses it to decide when to trigger`
    );

    // Every component is namespaced, so it can never collide with a host
    // project's own same-named skill or agent.
    assert.ok(
      c.expected.startsWith('devkit-'),
      `${c.kind} ${c.expected} is not devkit- prefixed`
    );
  }
});

test('skills declare model: inherit, agents pin a model', () => {
  // Measured, not assumed: a skill's `model:` is ignored on the
  // Skill-tool-in-session path - devkit-help declaring haiku ran all seven of
  // its turns on opus when the session was opus. Skills therefore say
  // `inherit` rather than naming a model that is silently discarded.
  // Subagents genuinely honour theirs.
  for (const d of fs.readdirSync(path.join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const file = path.join(PLUGIN_ROOT, 'skills', d.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const model = fs.readFileSync(file, 'utf8').match(/^model:\s*(\S+)\s*$/m);
    if (model) {
      assert.strictEqual(
        model[1],
        'inherit',
        `skill ${d.name} declares model: ${model[1]}, which is ignored - use inherit`
      );
    }
  }
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents'))) {
    if (!f.endsWith('.md')) continue;
    const model = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', f), 'utf8').match(/^model:\s*(\S+)\s*$/m);
    assert.ok(model, `agent ${f} pins no model`);
    assert.notStrictEqual(model[1], 'inherit', `agent ${f} says inherit, but subagents honour their own model`);
  }
});

test('every trigger phrase is namespaced to devkit', () => {
  // This plugin is a GUEST in someone else's repository. A phrase like
  // "write a spec" or "review the diff" is a plain-English description of a
  // universal dev activity, and is exactly what a project's own components
  // already answer to - MyHomeMaintenance's `specify`, `implementer` and
  // `reviewer` claimed all three verbatim. The harness resolves that
  // ambiguity silently, so the user never learns which one ran.
  //
  // The rule: every trigger contains "devkit". A bare generic phrase then
  // reaches the project's own component, and "devkit <thing>" unambiguously
  // reaches this plugin's. Namespacing the NAMES was never enough; the
  // phrases are what the harness actually matches on.
  const components = [];
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents'))) {
    if (f.endsWith('.md')) components.push(path.join(PLUGIN_ROOT, 'agents', f));
  }
  for (const d of fs.readdirSync(path.join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const s = path.join(PLUGIN_ROOT, 'skills', d.name, 'SKILL.md');
    if (fs.existsSync(s)) components.push(s);
  }

  let checked = 0;
  for (const file of components) {
    const text = fs.readFileSync(file, 'utf8');
    const name = text.match(/^name:\s*(\S+)\s*$/m)[1];
    const desc = text.match(/^description:\s*(.*)$/m)[1];
    const clause = desc.match(/Trigger phrases? [—-] (.*)$/);
    assert.ok(clause, `${name} declares no trigger phrases - the harness cannot reach it`);

    const phrases = [...clause[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(phrases.length > 0, `${name}'s trigger clause lists no quoted phrases`);
    for (const phrase of phrases) {
      assert.ok(
        phrase.toLowerCase().includes('devkit'),
        `${name} claims the un-namespaced phrase "${phrase}" - a host project's own component may answer to it too`
      );
      checked++;
    }
  }
  assert.ok(checked >= 40, `expected 40+ trigger phrases across the plugin, checked ${checked}`);
});

test('devkit-security and devkit-dep-audit stay distinct', () => {
  // These answer different questions and it is easy for one to drift into
  // the other's territory: dep-audit covers vulnerable DEPENDENCIES, security
  // covers code YOU wrote. A project can have a spotless dependency tree and
  // still hand one tenant's data to another.
  const sec = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'devkit-security.md'), 'utf8');
  const dep = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'devkit-dep-audit.md'), 'utf8');
  assert.match(sec, /dep-audit/, 'devkit-security must say what it does NOT cover');
  assert.match(dep, /not a substitute/i, 'devkit-dep-audit must disclaim code-level review');

  // Both are report-only, and that must survive edits.
  for (const [name, text] of [['devkit-security', sec], ['devkit-dep-audit', dep]]) {
    assert.match(text, /[Rr]eport.only|do NOT (modify|edit)|never edits/, `${name} dropped its report-only boundary`);
  }
});

test('the integration-layer convention is stated in every component that acts on it', () => {
  // A criterion marked [integration] is written by devkit-specify, honoured by
  // devkit-implementer, and checked by devkit-reviewer. If any one of the
  // three loses it, the marker becomes decoration: the spec still asks, and
  // nothing enforces. That is the same fail-open shape as the SENSITIVE gate.
  const files = {
    'devkit-specify': path.join(PLUGIN_ROOT, 'skills', 'devkit-specify', 'SKILL.md'),
    'devkit-implementer': path.join(PLUGIN_ROOT, 'agents', 'devkit-implementer.md'),
    'devkit-reviewer': path.join(PLUGIN_ROOT, 'agents', 'devkit-reviewer.md'),
  };
  for (const [name, file] of Object.entries(files)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      text.includes('[integration]'),
      `${name} no longer mentions the [integration] layer marker - the convention is now fail-open`
    );
  }
});

test('README and docs/SDLC.md name every component and every stage', () => {
  // docs/SDLC.md is the file newcomers are pointed at, and it is the file
  // furthest from any change: five components landed in one morning and it
  // mentioned two of them, while still stating a property (nothing commits)
  // that one of the five had just made false. The README got updated because
  // it sits next to the code; the walkthrough did not. So the walkthrough is
  // now checked the same way the README is - a component or stage that
  // exists in the code but not in both documents fails here.
  const docs = {
    'README.md': fs.readFileSync(path.join(PLUGIN_ROOT, 'README.md'), 'utf8'),
    'docs/SDLC.md': fs.readFileSync(path.join(PLUGIN_ROOT, 'docs', 'SDLC.md'), 'utf8'),
  };
  const names = [];
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents'))) {
    if (f.endsWith('.md')) names.push(f.replace(/\.md$/, ''));
  }
  for (const d of fs.readdirSync(path.join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })) {
    if (d.isDirectory()) names.push(d.name);
  }
  const { ALL_STAGES } = require(path.join(PLUGIN_ROOT, 'scripts', 'lib', 'devkit.js'));

  for (const [doc, text] of Object.entries(docs)) {
    for (const name of names) {
      assert.ok(text.includes(name), `${doc} never mentions ${name}`);
    }
    for (const stage of ALL_STAGES) {
      assert.ok(
        new RegExp(`\`${stage}\``).test(text),
        `${doc} never names the \`${stage}\` stage - a project cannot enable what the docs do not list`
      );
    }
  }
});

test('no component runs git tag', () => {
  // Tagging is the one git operation that stays human in every
  // configuration - a tag is what registries and deploy pipelines act on
  // the moment it exists. devkit-release prints the command; nothing runs
  // it. This looks for "git tag" used as an instruction rather than shown
  // as output or forbidden in a sentence: any line containing it must also
  // contain "never", "not run", "for a human", or be inside a fenced block
  // (the printed command).
  const files = [];
  for (const f of fs.readdirSync(path.join(PLUGIN_ROOT, 'agents'))) files.push(path.join(PLUGIN_ROOT, 'agents', f));
  for (const d of fs.readdirSync(path.join(PLUGIN_ROOT, 'skills'))) {
    const s = path.join(PLUGIN_ROOT, 'skills', d, 'SKILL.md');
    if (fs.existsSync(s)) files.push(s);
  }
  files.push(...scriptFiles());
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    let fenced = false;
    lines.forEach((line, n) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      // `git tag --list` / `-l` only reads; that is how release finds the
      // current version. Everything else `git tag` does, writes.
      if (fenced || !/git tag(?! (--list|-l)\b)/.test(line)) return;
      assert.ok(
        /never|not run|did not run|for a human|do not run|stays human|human action/i.test(line),
        `${path.basename(f)}:${n + 1} mentions git tag as an instruction: ${line.trim()}`
      );
    });
  }
});
