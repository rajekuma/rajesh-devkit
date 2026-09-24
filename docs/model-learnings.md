# Model learnings

Where the dollars went, what each model actually did, and what we'd do
differently. One row per measurement, newest last. Add to it every time you
try a model — a result nobody wrote down gets paid for twice.

**How to measure a model** (the only test that counts — "supports tools" and
a `pong` prove the wiring, not the work):

```bash
node profiles/check.js --new                    # what's new on the gateway since you last looked
node profiles/check.js <profile>                # ids exist, tools supported, today's prices
node tests/run-evals.js --case implementer-red-green --profile <profile>
```

The eval runs the loop's hardest step — `devkit-implementer` taking a spec
through RED-GREEN — on the profile's models, and grades it with your Claude
login. **Read the real cost from OpenRouter** (Activity page, or the key/credits
API): the eval summary prices a model Claude Code doesn't know as if it were
Claude, and has overstated a gateway run fifteen-fold.

## Results: `implementer-red-green` (9 graders)

| Date | Profile | Session / implementer model | Score | Real cost | What happened |
|---|---|---|---|---|---|
| 2026-09-23 | Claude login | Claude Opus / Sonnet | **9/9** | subscription | Reference. Invoked `devkit-implementer`, waited for it, RED before GREEN per criterion, reported the failures. |
| 2026-09-24 | Claude login, after the "show the RED" rule | Claude Opus / Sonnet | **9/9** | subscription | Produced the per-criterion RED table exactly as specified. |
| 2026-09-23 | `openrouter` | `qwen/qwen3-coder` | **8/9** | ~$0.21 | Real fail→pass for every criterion in the trace, runner cached, criteria ticked — but the report never *said* so. |
| 2026-09-24 | `openrouter` | `qwen/qwen3-coder` | **8/9** | ~$0.11 | Did the work right again (batched RED-GREEN this time) but ignored the reporting rules — no RED evidence, no batch disclosure, no performance snapshot — and created a `PROGRESS.md` the prompt says not to. |
| 2026-09-23 | `openrouter-lean` | `qwen/qwen3-coder-next` | **3/9** | ~$0.07 | Invoked the implementer but wouldn't wait for a background subagent: stopped it mid-work three times, then did the milestone itself. No ticks, no cached runner, no RED. |
| 2026-09-24 | `openrouter-nemotron-free` | `nvidia/nemotron-3-ultra-550b-a55b:free` | **8/9** | **$0** | Matches qwen3-coder at no cost: waited for the implementer, runner cached, criteria ticked, code right — and, like qwen, a report with no RED evidence. No 429s on this run, but free-tier limits (1,000 requests/day, 20/minute, provider throttling) still apply. |
| 2026-09-24 | `openrouter-luna` | `openai/gpt-6-luna` | **2/9** (misleading) | ~$0.02 | The session launched the implementer with `isolation: "worktree"` — a throwaway copy of the repo. The work in that copy was good: 4/4 criteria ticked, runner cached, and a proper RED-then-GREEN report (the one grader that reads the report passed). None of it reached the project, so every file-based grader failed. It also first tried to call the implementer as a *skill*. Cheapest per token by far; needs the orchestration fixed before it can be judged. |

## Real sessions

| Date | Profile | What happened | Cost | Lesson |
|---|---|---|---|---|
| 2026-09-23 | `openrouter` (`qwen/qwen3-coder`) | 26 min, open-ended "look at the app and suggest mobile UI work". 192 requests, **18.6M input tokens** (12.4M of them cache reads), **14k output**. Several background agents. A plugin bug re-asked a collision question at every stop, each time forcing another full-context turn. Ended in `402 … exceed your available credits`. | **~$8.50** — most of a $10 balance | Cost is context × turns, not output. Every request starts at ~45k tokens (Claude Code's instructions, tools, `CLAUDE.md`, plugin listings) and re-sends the whole conversation. qwen3-coder's cache discount is only 3× ($0.30 → $0.10). Scope a fallback session to one step; explore on the subscription. The collision bug is fixed in 0.7.4. |
| 2026-09-23 | free `:free` models | `qwen/qwen3.8-27b:free` — a 400 (`grammar rejected: tool "DesignSync" … "minLength"`) then 429s (`Provider returned error`) on every retry. Never answered through Claude Code. | $0 | "Free" costs time: 50 requests/day before any purchase, 20/minute, and providers throttle hard. Some free backends can't parse Claude Code's tool schemas at all. |

## Advice checked against the catalogue

An AI search summary recommended, for this loop:

| Claim | Reality (2026-09-23) |
|---|---|
| `qwen/qwen-2.5-coder-32b-instruct` for the implementer | Listed with **no tool calling** — Claude Code cannot run on it. `check.js` now fails such models. |
| `google/gemini-2.5-flash` is "completely free" | Paid: $0.30 in / $2.50 out. |
| GPT-6 Astra "within a $10 credit" | $10 in / $50 out per million. A single Claude Code request is 45k+ tokens; $10 is a handful of turns. |

## Price reference (per million tokens, 2026-09-24)

| Model | Fresh input | Cached input | Output | Notes |
|---|---|---|---|---|
| `qwen/qwen3-coder` | $0.30 | $0.10 | $1.00 | Default fallback. Only 3× cache discount. |
| `qwen/qwen3-coder-next` | $0.12 | $0.07 | $0.80 | 3/9 — won't wait for subagents. |
| `openai/gpt-6-luna` | $0.10 | $0.01 | $0.50 | `openrouter-luna`: 2/9 from worktree isolation, not bad code. |
| `openai/gpt-6-sol` | $2.00 | $0.20 | $10.00 | "Sonnet-class coder" is a claim, unmeasured. The $8.50 session would have cost ~$15+. |
| `openai/gpt-6-astra` | $10.00 | $1.00 | $50.00 | Not a fallback price. |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | free | — | free | `openrouter-nemotron-free`: 8/9. Rate-limited. |
| `anthropic/claude-sonnet-4.5` | $3.00 | $0.30 | $15.00 | The default profile's opus tier. |

## Standing lessons

1. **Measure before trusting.** Existence, tool support and a `pong` are
   necessary and not sufficient; only the eval says whether a model can
   drive the loop.
2. **Cost is context × turns.** Scope fallback sessions to one milestone —
   for a big milestone, one step — and relaunch; `resume.json` makes that
   free. The profiles cap context at 100k (`maxContextTokens`).
3. **The cache discount matters more than the list price** for long
   sessions: re-sent context is most of the bill.
4. **A 402 is the account balance**, not the key's limit; OpenRouter reserves
   each in-flight request's worst case up front.
5. **Weaker models follow the doing and skip the reporting.** On the
   fallback, check the code and the ticked criteria, not the prose.
6. **Orchestration is its own skill.** A model that codes well can still fail
   the loop by what it does *around* the subagent: not waiting for it
   (qwen3-coder-next), or running it in an isolated worktree whose changes
   never reach the project (gpt-6-luna). Read the trace, not just the score —
   Luna's 2/9 hides good work in the wrong place.
7. **Free can be competitive.** Nemotron-free matched qwen3-coder's 8/9 at $0
   on this case; its limits, not its quality, are what to watch.
