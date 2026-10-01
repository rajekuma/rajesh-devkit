'use strict';

// The per-milestone receipt: what this plugin did for a milestone, next to
// what the milestone cost. Built from records the plugin keeps itself - the
// telemetry events the hooks log, the gate stamps, the transcript scan - so
// it costs no model tokens and does not depend on a model remembering.
//
// Why it exists: in real use the plugin's work was invisible. A user watching
// a milestone finish saw the model's summary and could not tell whether the
// loop, the gates and the specialist agents had done anything a bare session
// would not have. The receipt says it, line by line, and only says what the
// records show: activity, not a claim that the result would have been worse
// without it (that takes a with/without comparison, not a receipt).

const PLUGIN_AGENT = /^(rajesh-devkit:)?devkit-/;

// Telemetry events for one milestone (by number) inside its window. A small
// grace after the end, because the gate-missing warning is logged by the same
// hook run that ships the milestone, a moment after the ship event.
function eventsFor(events, keyOf, key, start, end) {
  const lo = new Date(start).getTime();
  const hi = new Date(end).getTime() + 60 * 1000;
  return events.filter((e) => {
    if (keyOf(e.milestone) !== key) return false;
    const t = new Date(e.timestamp).getTime();
    return Number.isFinite(t) && t >= lo && t <= hi;
  });
}

function activity(events, subagents) {
  const nudges = events.filter((e) => e.event === 'loop_nudge');
  const kinds = {};
  for (const n of nudges) kinds[n.kind || 'chain'] = (kinds[n.kind || 'chain'] || 0) + 1;
  const plugin = (subagents || []).filter((a) => a.type && PLUGIN_AGENT.test(a.type));
  const agentCosts = plugin.map((a) => a.costUsd);
  return {
    // Events older than 0.11.3 were never logged; a zero here then means
    // "unknown", and the receipt says so instead of claiming the loop idled.
    logged: nudges.length > 0 || events.some((e) => e.event !== 'milestone_started' && e.event !== 'milestone_shipped'),
    nudges: nudges.length,
    nudgeKinds: kinds,
    collisions: events.filter((e) => e.event === 'session_collision').length,
    staleGateWarnings: events.filter((e) => e.event === 'gates_stale').length,
    missingGateWarnings: events.filter((e) => e.event === 'gates_missing').length,
    agents: plugin.map((a) => ({ type: a.type.replace(/^rajesh-devkit:/, ''), model: a.model, costUsd: a.costUsd })),
    agentCostUsd: agentCosts.some((c) => c == null) ? null : Math.round(agentCosts.reduce((s, c) => s + c, 0) * 10000) / 10000,
  };
}

function money(v) {
  return v == null ? 'unknown' : `$${v.toFixed(2)}`;
}

function title(r) {
  const name = r.name ? ` ${r.name.replace(/\s*\([^)]*\)\s*$/, '')}` : '';
  return `DevKit | ${r.milestone}${name} | done`;
}

// ASCII only: it is printed by a hook into whatever terminal the user has.
function format(r, { enabledGates = [] } = {}) {
  const a = r.devkit || null;
  const lines = [title(r)];

  if (a && a.logged) {
    const bits = [`${a.nudges} stop${a.nudges === 1 ? '' : 's'} turned into the next step by devkit`];
    if (a.nudgeKinds['sensitive-question']) bits.push('asked the sensitive-milestone question');
    if (a.nudgeKinds['draft-blocked']) bits.push('held a Draft spec until approved');
    bits.push(`built by ${r.primaryModel || 'unknown model'}${r.approach ? ` (${r.approach})` : ''}`);
    lines.push(`  Loop    ${bits.join(' | ')}`);
  } else {
    lines.push(
      `  Loop    built by ${r.primaryModel || 'unknown model'}${r.approach ? ` (${r.approach})` : ''} | ` +
        'loop events not recorded for this window (before 0.11.3)'
    );
  }

  const verdicts = Object.entries(r.gates || {}).map(([g, v]) => `${g}: ${v}`);
  for (const g of enabledGates) {
    if (!(r.gates || {})[g]) verdicts.push(`${g}: NOT RUN`);
  }
  const agentTypes = a ? a.agents.map((x) => x.type) : [];
  if (agentTypes.includes('devkit-docs')) verdicts.push('docs: ran');
  lines.push(`  Gates   ${verdicts.length > 0 ? verdicts.join(' | ') : 'none recorded'}`);
  if (a && a.agents.length > 0) {
    const names = [...new Set(agentTypes.map((t) => t.replace(/^devkit-/, '')))];
    lines.push(`          ${a.agents.length} devkit agent run${a.agents.length === 1 ? '' : 's'} (${names.join(', ')}), ${money(a.agentCostUsd)}`);
  }

  if (a && a.logged) {
    lines.push(
      `  Caught  ${a.missingGateWarnings} missing-gate warning${a.missingGateWarnings === 1 ? '' : 's'} | ` +
        `${a.staleGateWarnings} stale-verdict warning${a.staleGateWarnings === 1 ? '' : 's'} | ` +
        `${a.collisions} session collision${a.collisions === 1 ? '' : 's'} stopped`
    );
  }

  const cost = [`${money(r.costUsd)} at API prices`, `${r.activeHours} active h`];
  if (r.criteria) cost.push(`${r.criteria} criteria${r.costUsd != null ? ` (${money(r.costUsd / r.criteria)} each)` : ''}`);
  if (r.diff) cost.push(`+${r.diff.insertions} / -${r.diff.deletions} lines`);
  lines.push(`  Cost    ${cost.join(' | ')}`);
  return lines.join('\n');
}

// One short cell for the summary table.
function cell(r) {
  const a = r.devkit;
  if (!a) return '-';
  const parts = [];
  if (a.logged) parts.push(`${a.nudges} nudges`);
  parts.push(`${a.agents.length} agents`);
  const gatesRun = Object.keys(r.gates || {}).length;
  parts.push(`${gatesRun} gates`);
  if (a.logged && a.missingGateWarnings + a.staleGateWarnings + a.collisions > 0) {
    parts.push(`${a.missingGateWarnings + a.staleGateWarnings + a.collisions} caught`);
  }
  return parts.join(', ');
}

module.exports = { PLUGIN_AGENT, eventsFor, activity, format, cell };
