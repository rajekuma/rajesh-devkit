---
name: devkit-vision
description: Interviews the owner, one question at a time, about what the product is — the problem, who it's for, what the first usable version must do, what it deliberately won't do, how success shows, the constraints — and writes docs/product_vision.md from their answers only, never from invention. Runs on the session's model; best on a strong one (Opus or Fable), because everything downstream is built on it. devkit-onboard hands over to it for a new project. Trigger phrases — "devkit vision", "devkit product vision", "devkit define the product".
model: inherit
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.js" *)
effort: high
---

# Write the product vision, from the owner's answers

Every milestone, spec and review in this loop is judged against the product
vision. A vague or invented vision doesn't fail loudly — it quietly
misdirects every spec that follows. So this is an interview, not a writing
exercise: you ask, the owner answers, and the document says only what they
said.

**On the model.** This step decides things, so it's the one worth a strong
model. If the session is not on Opus or Fable, say so once at the start and
suggest `/model opus` for this interview — then carry on either way. The
owner decides what their tokens are for.

## Steps

1. **Look for an existing vision first.** `docs/product_vision.md`, a vision
   or product section in `README.md`, a `docs/` page, or a file `CLAUDE.md`
   or `AGENTS.md` points to. If one exists, summarise it back in five lines
   and ask whether to refine it or start over — never silently replace it.

2. **Make sure the skeleton exists.** If there is no vision file yet, create
   it from the plugin's template:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.js" . --items vision`
   (it never overwrites). Its sections are the interview's order.

3. **Interview — one question per message, in this order.** Wait for each
   answer before asking the next. Use plain questions (not multiple choice)
   unless the answer really is a choice.

   1. *The problem* — "Who has what problem today, and what does it cost
      them?"
   2. *Who it's for* — the primary user; secondary users; who it is
      explicitly **not** for.
   3. *The first usable version* — "What must a real user be able to do,
      for them to choose this over what they do today?" Ask for
      **outcomes**, not features: if the answer is a feature list, ask what
      each one lets the user achieve.
   4. *What it won't do* — scope deliberately left out, and why. Offer
      examples from what they've said ("you mentioned X — is that in the
      first version, or later?").
   5. *How we'll know it works* — observable signs: a user completing
      something, a number moving.
   6. *Constraints* — budget, platforms, regulation, data residency, team
      size, deadlines.
   7. *Open questions* — what they don't know yet.

   **Follow up when an answer is vague** ("better experience", "for
   everyone"): one clarifying question, then accept what they give. **Never
   fill a gap yourself.** "We don't know yet" goes under Open questions —
   an honest unknown is worth more than a plausible guess, because a guess
   gets treated as a requirement from then on.

4. **Write the document from the answers.** Replace each `<placeholder>`
   with what the owner said, tightened but not embellished. Keep their
   words for anything that sounds like a commitment. Add nothing they didn't
   say — no features, no personas, no market claims.

5. **Show it and ask for corrections**, once, as a whole. Apply them.

6. **Hand off, then stop.** If `devkit-onboard` sent you here, say so and
   return to it: its next step turns this vision into phases and milestones
   in `PROGRESS.md`. Otherwise, suggest `devkit onboard` (new project) or
   `devkit roadmap` (existing tracker) as the next step. Do not write
   milestones, specs or code yourself.
