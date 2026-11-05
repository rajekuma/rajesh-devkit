---
name: devkit-journeys
description: Drafts JOURNEYS.md for the current repo — the outcomes a real person must be able to achieve end to end, each with the milestones it needs and a check that can fail — from the product vision, the tracker and the code. Writes nothing until the user approves. Trigger phrases — "devkit journeys draft", "devkit draft journeys". For the current state of existing journeys, say "devkit journeys" instead, which a hook answers without this skill.
argument-hint: "[what the first release must do]"
model: inherit
effort: high
---

# Draft user journeys

Every gate in this loop judges one milestone's diff, so a project can pass them all
and still not be usable. A journey says what a person must be able to do, and its
check proves it. This skill proposes them. **The user decides what they are.**

## Steps

1. **Check first.** If `JOURNEYS.md` exists, read it and propose only additions or
   changes. Never overwrite it wholesale.

2. **Read what the project wants and what exists.** The vision document, or whatever
   `CLAUDE.md` points to; `PROGRESS.md`; any release or pilot goal; then the code, for
   what a person can reach today and how the project already runs itself end to end. If
   there is no statement of what the product is for, say so and ask. Do not invent one.

3. **Draft 5-10 candidates. Fewer is better.** Each is one outcome for a named kind of
   person, written the way they would say it, crossing every part it depends on. Fit it
   to what the project is: a library's journey is a consumer installing it and calling
   it, and a CLI's is a new user running it and getting the result. Prefer outcomes that
   would make someone choose this product. A milestone's feature restated is not a
   journey.

4. **Map each to its tracker rows.** `Needs` lists only rows it truly cannot work
   without. If something it needs has no row, say so: that is a finding, not something
   to hide by leaving it out.

5. **Say how each could be checked, honestly.**
   - Look for what the project already has. If it has an end-to-end command that can
     exercise the journey, propose it, and only after reading what it does.
   - If nothing can yet, say the check does not exist and propose adding it as an
     ordinary tracker row through the normal loop. **Never invent a command**, and
     never write the check here.
   - A check must drive the real thing and be able to fail. A unit test run, a health
     ping or a script that exits 0 is not a journey check.
   - If no command could ever prove it, such as a camera flow on a real device, propose
     `Check: manual`. The user accepts it by saying `devkit journey J3 passed`.

6. **Show the draft and ask.** Show the proposed file, name which rows have no journey
   and which journeys have no check, and ask which to keep. Ask one question at a time.
   Then **stop and wait**. Writing before approval is a failure of this skill.

7. **Write only what was approved** to `JOURNEYS.md` at the project root, in this
   format, because hooks parse it:

   ```markdown
   # Journeys

   What a person must be able to do. `devkit journeys` shows the state of each.

   ## J1 <short title>
   For: <who>
   Outcome: <what they can now do, in their words>
   Needs: M12, M15
   Check: <the command, or manual>
   Timeout: 300
   ```

   Ids are `J` then a number. `For`, `Outcome` and `Check` are required. A journey with
   no check yet needs `Check: not-built-yet`, a command that does not exist, so running it
   reports `unknown` until a real one replaces it and the gap stays visible. Say which
   rows you would add for the missing checks, and add them to `PROGRESS.md` only if the
   user approves.

8. **Hand off.** Say `devkit journeys` shows the state at no token cost, and name the
   closest journey and what it needs. Then stop. Do not start building it.

## What this is not

Not a test generator, not a roadmap and not a reordering of the tracker. What gets
built next stays the user's call.
