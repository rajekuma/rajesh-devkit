'use strict';

// Which model provider this session is actually talking to, derived from the
// environment Claude Code itself reads.
//
// Nothing here changes a model. It cannot: the provider and the alias
// mappings are fixed when the CLI process starts, and a hook is a child
// process of that - it can no more re-point the session than it can change
// its own parent's arguments. (A Stop hook writing "/model X" to stderr does
// not switch anything either; stderr on exit 2 is text handed back to Claude,
// not a command the harness runs.)
//
// What it can do is SAY which provider is live, which is the part that was
// missing. The components here already ask for tiers rather than model names
// - every subagent says `model: sonnet` or `model: haiku`, never a model ID -
// so pointing ANTHROPIC_BASE_URL at a gateway and remapping the four
// ANTHROPIC_DEFAULT_*_MODEL variables re-targets the whole loop without
// touching a single file in this plugin. That is what makes it portable
// across providers; this module makes it visible, so a session run on a
// cheap open model is never mistaken for one run on Claude.

const TIER_VARS = {
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
};

// Host substring -> friendly name. Deliberately a short list: anything else
// is reported as its own hostname rather than guessed at, since a wrong
// provider name is worse than an unfamiliar one.
const KNOWN = [
  ['openrouter.ai', 'openrouter'],
  ['api.anthropic.com', 'anthropic'],
  ['localhost', 'local'],
  ['127.0.0.1', 'local'],
  ['bedrock', 'bedrock'],
  ['googleapis.com', 'vertex'],
];

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function detectProvider(env = process.env) {
  const baseUrl = env.ANTHROPIC_BASE_URL || null;
  const host = baseUrl ? hostOf(baseUrl) : null;

  let name = 'anthropic';
  if (host) {
    const hit = KNOWN.find(([needle]) => host.includes(needle));
    name = hit ? hit[1] : host;
  }

  // A gateway credential replaces the subscription for the whole session and
  // bills per token to whoever owns that credential. Worth stating plainly,
  // because it is the difference between "this run is included in my plan"
  // and "this run has a bill attached", and nothing else on screen says so.
  const usesGatewayCredential = Boolean(env.ANTHROPIC_AUTH_TOKEN);

  const tiers = {};
  for (const [tier, varName] of Object.entries(TIER_VARS)) {
    if (env[varName]) tiers[tier] = env[varName];
  }

  // "Default" means nothing worth mentioning has changed, NOT that the
  // environment is empty. Found by running this in the desktop app, which
  // sets ANTHROPIC_BASE_URL=https://api.anthropic.com itself: treating the
  // mere presence of that variable as a signal meant announcing a provider
  // switch in every ordinary session, which is how a line earns being
  // ignored. What actually matters is a host that isn't Anthropic's, a
  // gateway credential, or a remapped tier - each of which is something
  // somebody did on purpose.
  const isDefault = name === 'anthropic' && !usesGatewayCredential && Object.keys(tiers).length === 0;

  return { name, baseUrl, tiers, usesGatewayCredential, isDefault };
}

// One line for a banner. Says nothing at all on a stock Claude session -
// there is no news in "you are using the thing you always use", and a hook
// that prints a line every session earns being ignored.
function describeProvider(provider = detectProvider()) {
  if (provider.isDefault) return null;
  const tiers = Object.entries(provider.tiers)
    .map(([tier, model]) => `${tier}->${model}`)
    .join(', ');
  const billing = provider.usesGatewayCredential
    ? 'billed per token to the gateway credential, not your subscription'
    : 'subscription credential';
  return `Models: ${provider.name}${tiers ? ` (${tiers})` : ''} - ${billing}.`;
}

module.exports = { TIER_VARS, detectProvider, describeProvider };
