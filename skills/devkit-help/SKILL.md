---
name: devkit-help
description: Explains what to do next with this plugin right now — reports setup status (whether PROGRESS.md exists, the next milestone, whether it has a spec yet) and the exact thing to say to move forward. This is the verified, on-demand fallback for the automatic SessionStart banner, which runs the identical check. Trigger phrases — "devkit help", "how do I use devkit", "getting started with devkit".
model: inherit
---

# devkit-help

Run the exact same state check the `SessionStart` hook uses, so this and
the automatic banner never drift out of sync, and relay it conversationally
rather than as a terse dump.

## Steps

1. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/session-welcome.js" < /dev/null
   ```

   **The `< /dev/null` is load-bearing — do not drop it.** The script reads
   stdin because the harness pipes a JSON payload there and closes it. On
   this direct path nothing is going to arrive, but if the invoking shell
   leaves stdin open the read waits for an EOF that never comes and the
   command hangs until something kills it. (This is not hypothetical: it was
   found by running exactly this command, which then sat for a full two
   minutes and was timed out. The instruction here used to claim stdin was
   not required, which was wrong.) An interactive terminal is handled inside
   the script; an inherited pipe is not distinguishable from a slow harness,
   so the redirect is how this path stays safe.

   The payload only carries `source`, which is a hook-only concern, so
   supplying nothing behaves exactly as `source` being absent.

2. **Relay what it reports, in your own words**, as a short, friendly
   next-step suggestion — not a copy-pasted wall of text. If it reports
   there's no `PROGRESS.md` yet, walk the user through the bootstrap
   sequence conversationally (talk through product intent → `claude init` →
   write `PROGRESS.md` → optionally seed `docs/adr/`) rather than just
   dumping the raw checklist verbatim.

3. **Name what the loop is stepping over, if anything.** The banner reports
   the next milestone and deliberately says nothing about *parked* rows —
   ones whose tracker note matches this project's `parkedPattern` (by
   default "not spec'd" and its spellings), which the loop skips because
   nobody has decided to build them yet. That silence is right for a nudge
   and wrong for a status report: parked is not the same as hidden, and a
   row skipped forever becomes invisible debt. Run:

   ```bash
   node -e "const d=require(process.env.CLAUDE_PLUGIN_ROOT+'/scripts/lib/devkit');const dir=process.env.CLAUDE_PROJECT_DIR;const c=d.readStageConfig(dir);console.log(d.findParkedMilestones(dir+'/PROGRESS.md',c.parked).map(p=>p.display).join(', '))"
   ```

   If it returns any, mention them in one line — "3 rows are parked as not
   spec'd (M11a, M29a, M39a); say so if you want one of them next" — then
   move on. Not a list to recite every time someone asks a question.

4. **If asked what the whole loop actually does, end to end**, give a short
   overview rather than reading component descriptions verbatim:
   - `devkit-onboard` gets a project — new or existing — to the state the
     loop needs, without clobbering what's already there. Start here.
   - `devkit-specify` drafts a spec, acting as product owner, interviewing
     for anything it can't infer.
   - `devkit-ux` turns that spec into screens, states, tokens and
     accessibility criteria — run it on anything with a user interface,
     before implementation.
   - `devkit-implementer` implements it test-first, one acceptance
     criterion at a time.
   - `devkit-reviewer` reviews the diff against the spec and gives a
     ship/needs-changes/discuss verdict.
   - `devkit-ship` is the preflight after that: CI, coverage, dependency
     advisories, secrets, and open follow-ups, with a clear/blocked verdict.
   - `devkit-docs` writes the changelog entry and finds documentation the
     change just made wrong.
   - `devkit-adr` records an architecture decision when one gets made.
   - `devkit-dep-audit` checks the project's dependencies for known CVEs.
   - `devkit-stats` reports how long each milestone took, what it cost in
     real tokens/USD, and a heuristic manual-effort comparison.
   - The loop runs only when the user starts it: **`devkit continue`** takes
     the next milestone and the `Stop` hook drives it until it ships, then
     waits; **`devkit continue all`** runs the whole queue; **`devkit
     continue phase N`** works one phase as a lane (for parallel sessions,
     usually one per git worktree); **`devkit continue M<n>`** takes one
     named milestone; **`devkit pause`** stops it. Always tell the user these three, because a session
     that never said `devkit continue` is never nudged - by design, since
     sessions opened for other work used to be driven (and asked about
     collisions) at every stop. This skill is for checking status on demand.

   The usual order is onboard → specify → (ux) → implement → review → ship →
   docs, but nothing forces it; each piece is independently invokable.

5. **Do not edit anything.** Read-only, same as the other report-producing
   components in this plugin.
