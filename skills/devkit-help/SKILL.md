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
   node "${CLAUDE_PLUGIN_ROOT}/scripts/session-welcome.js"
   ```

   (No stdin is required for this direct invocation — the script only reads
   stdin to check `source`, which is a hook-only concern; running it
   without piping anything in is fine and behaves the same as `source`
   being absent.)

2. **Relay what it reports, in your own words**, as a short, friendly
   next-step suggestion — not a copy-pasted wall of text. If it reports
   there's no `PROGRESS.md` yet, walk the user through the bootstrap
   sequence conversationally (talk through product intent → `claude init` →
   write `PROGRESS.md` → optionally seed `docs/adr/`) rather than just
   dumping the raw checklist verbatim.

3. **If asked what the whole loop actually does, end to end**, give a short
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
   - The `Stop` hook automates the "what's next" nudge between milestones
     automatically; this skill is for checking status on demand instead of
     waiting for a session to pause.

   The usual order is onboard → specify → (ux) → implement → review → ship →
   docs, but nothing forces it; each piece is independently invokable.

4. **Do not edit anything.** Read-only, same as the other report-producing
   components in this plugin.
