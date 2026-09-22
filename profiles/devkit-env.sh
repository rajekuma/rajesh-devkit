# Switches which provider the NEXT `claude` launch talks to. macOS/Linux
# counterpart of devkit-env.ps1 - see that file for the reasoning; it is the
# same design and the same warnings.
#
#   source <plugin>/profiles/devkit-env.sh   # once per shell
#   devkit_profile openrouter                # then launch: claude
#   devkit_profile claude                    # back to the subscription
#
# The provider is fixed when the CLI process starts, so switching is always
# "set the environment, then start a NEW session". The loop's position lives
# in .claude/rajesh-devkit/resume.json, rewritten by a hook after every edit,
# so a new session picks up where the old one died without needing its
# context. Do not use `claude --continue` across a switch: it replays the
# whole transcript to the new provider as uncached input tokens.

devkit_profile() {
  local name="$1"
  local here
  # Works under both bash and zsh, sourced or not.
  here="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"

  unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY \
    ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL \
    ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_FABLE_MODEL

  case "$name" in
    claude)
      echo "devkit profile: claude - subscription credential, Anthropic models."
      echo "Start a new 'claude' session for this to take effect."
      return 0
      ;;
    openrouter) ;;
    *)
      echo "usage: devkit_profile [claude|openrouter]" >&2
      return 1
      ;;
  esac

  if [ -z "${OPENROUTER_API_KEY:-}" ]; then
    cat >&2 <<'MSG'
OPENROUTER_API_KEY is not set, so this profile would launch unauthenticated.

Set it for this shell only:
    export OPENROUTER_API_KEY='<your key>'

Or keep it in a file you will not commit, e.g. ~/.devkit/secrets.sh, and
source that from your shell rc. Nothing here writes a key to disk.
MSG
    return 1
  fi

  local cfg="$here/openrouter.json"
  # node rather than jq: node is guaranteed present (Claude Code is a node
  # program), jq is not.
  local vals
  vals="$(node -e '
    const cfg = require(process.argv[1]);
    const t = cfg.tiers;
    process.stdout.write([cfg.baseUrl, t.opus, t.sonnet, t.haiku, t.fable].join("\n"));
  ' "$cfg")" || { echo "devkit profile: cannot read $cfg" >&2; return 1; }

  # Base URL is the bare /api on purpose: Claude Code appends /v1/messages
  # itself, so a base ending in /v1 yields /v1/v1/messages and a 404 that
  # reads like an auth failure.
  export ANTHROPIC_BASE_URL="$(echo "$vals" | sed -n 1p)"
  # Credential in AUTH_TOKEN, API_KEY explicitly blanked so a stray key from
  # an earlier experiment cannot win.
  export ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY"
  export ANTHROPIC_API_KEY=""
  export ANTHROPIC_DEFAULT_OPUS_MODEL="$(echo "$vals" | sed -n 2p)"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="$(echo "$vals" | sed -n 3p)"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="$(echo "$vals" | sed -n 4p)"
  export ANTHROPIC_DEFAULT_FABLE_MODEL="$(echo "$vals" | sed -n 5p)"

  echo "devkit profile: openrouter"
  echo "  opus   -> $ANTHROPIC_DEFAULT_OPUS_MODEL"
  echo "  sonnet -> $ANTHROPIC_DEFAULT_SONNET_MODEL"
  echo "  haiku  -> $ANTHROPIC_DEFAULT_HAIKU_MODEL"
  echo ""
  echo "This session bills per token to your OpenRouter credit, NOT to your"
  echo "Claude subscription. Set a hard spend cap in the OpenRouter dashboard."
  echo "Start a new 'claude' session for this to take effect."
}
