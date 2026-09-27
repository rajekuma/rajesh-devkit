# Demo script: rajesh-devkit in 20 minutes

A presenter's script for showing the plugin to other developers: an empty
folder becomes a spec'd, test-first, reviewed milestone, then the same loop
runs on an existing repo, in parallel, and on a cheaper provider. Every step
says what to type and what the audience should notice.

**Pick a tiny demo product** so the tests run in seconds. The script uses a
**bookmark manager CLI in Node** (`npm test` with Node's built-in runner);
any small idea works.

## Before the demo (5 minutes, the day before)

- Claude Code installed and signed in; Node and git on `PATH`.
- The plugin's marketplace added once on this machine:

  ```bash
  claude plugin marketplace add rajekuma/rajesh-devkit
  ```

- Optional, for part 4: an OpenRouter key in
  `~/.devkit/openrouter_api_key.txt` (on Windows,
  `C:\Users\<you>\.devkit\openrouter_api_key.txt`), a little credit on the
  account, and a successful
  `node <plugin>/profiles/devkit.js openrouter-hybrid --dry-run`.
- **Windows:** use Command Prompt, Git Bash or VS Code's terminal, or type
  `claude.cmd` instead of `claude` in PowerShell (see the README's "On
  Windows").
- Have an existing repository handy for part 2 — any small one.

## Part 1 — from an empty folder to a shipped milestone (10 minutes)

**1. Install into a new folder.**

```bash
mkdir bookmarks-demo
cd bookmarks-demo
claude plugin install rajesh-devkit@rajesh-devkit --scope project
claude
```

*Point out:* the start-up banner recognises an empty folder and names one
command. Nothing has been written.

**2. Onboard.** Type:

```
devkit onboard
```

Answer its questions as they come, one at a time:

| It asks | Answer for the demo |
|---|---|
| Initialise git? | Yes |
| Write the product vision now? | Yes — *mention it's the step worth Opus* |
| (vision interview) the problem, who it's for, first usable version, won't do, success, constraints | "Developers lose links across browsers; a CLI to save, tag and search bookmarks; v1 = add, list, search by tag; won't do sync or a UI; success = I stop using browser bookmarks; Node only" |
| Which starter files? | All |
| Milestones | Accept its proposal, e.g. Phase 1: M1 project setup, M2 add a bookmark, M3 list, M4 search by tag |
| Which loop? | `full` |

*Point out:* the scaffold output — every file listed as `created`, and the
promise that it never overwrites (run `devkit onboard` again later to show
`kept`). Open `CLAUDE.md`: short, with the detail pointed to rather than
pasted in. Open `docs/product_vision.md`: only what you said.

**3. Start the loop.**

```
devkit continue
```

*Point out:* the loop picked the first unfinished row from `PROGRESS.md` and,
because it has no spec, started `devkit-specify` — which now interviews you
about the gaps it can't infer.

**4. Approve the spec.** Open `specs/<milestone>.md`, read the acceptance
criteria aloud, change `Status: Draft` to `Status: Approved`. Say:

```
devkit continue
```

*Point out, as it runs:*

- `devkit-implementer` writes a failing test first and shows the failure,
  then the code, then the whole suite — and ticks each criterion in the spec
  as it goes.
- `.claude/rajesh-devkit/resume.json` updates after every edit: kill the
  session now and a new one resumes at the next criterion.
- The gates (`devkit-reviewer`, `devkit-quality`, `devkit-security`) each
  stamp their verdict against the exact code they saw; edit a file afterwards
  and `node <plugin>/scripts/record-gate.js check` reports them `STALE`.
- `devkit-ship` reports anything it couldn't check as `UNKNOWN` — never
  `PASS` (there's no CI in the demo repo, so CI shows `UNKNOWN`).
- The milestone's row turns ✅ and the loop **stops and waits**. Nothing was
  committed: that stays your call.

## Part 2 — an existing repository (3 minutes)

In the existing repo:

```bash
claude plugin install rajesh-devkit@rajesh-devkit --scope project
claude
```

```
devkit onboard
```

*Point out:* it lists what's already there before proposing anything —
`CLAUDE.md` or `AGENTS.md`, specs, a tracker under another name, ADRs, the
stack — runs the real test command once before caching it, and offers only
the starter files that are missing.

## Part 3 — parallel lanes (3 minutes)

Back in the demo project, after adding a Phase 2 of UI work to `PROGRESS.md`:

```bash
git worktree add ../bookmarks-demo-ui -b feat/ui
cd ../bookmarks-demo-ui
claude
```

```
devkit continue phase 2 as ui
```

*Point out:* this session works Phase 2 only, with the `ui` preset (UX spec,
UI verification, no data-model planning), while another session can work
Phase 1 in the first folder. Neither can take the other's milestone.

## Part 4 — the usage limit, and cost (2 minutes)

```bash
node <plugin>/profiles/devkit.js openrouter-hybrid
```

```
devkit continue
```

*Point out:* the same loop, resumed from disk, on a gateway profile —
qwen3-coder driving, GPT-6 Luna implementing — which scored 9/9 on the
implementer eval for about 7 cents. Open `docs/model-learnings.md` in the
plugin repo: every model tried, what it really cost, and the lessons,
including the session that burned $8.50 and why.

## Talking points

- **Verification over trust:** test-first with the failure shown; `UNKNOWN`
  and `STALE` are never a pass.
- **Humans decide:** the loop starts on `devkit continue`, stops at every
  shipped milestone, never commits unless you enable it, and asks rather
  than guesses.
- **Generic:** it reads each project's own conventions — `CLAUDE.md`,
  `AGENTS.md`, rules, ADRs, test runner — instead of assuming a stack.
  The charter every change is held to is `docs/PRINCIPLES.md`.
- **Measured:** model choices and costs come from evals, recorded in the
  repo — including the wrong turns.

## If something goes wrong on stage

| Symptom | Fix |
|---|---|
| No `devkit-*` agents, "Agent type not found" | Claude Code wasn't started *in* the project folder, or the plugin isn't installed there — run the install command in that folder |
| "not digitally signed" in PowerShell | Type `claude.cmd`, or use Command Prompt / Git Bash |
| The loop doesn't move | Did you say `devkit continue`? Is the spec still `Draft`? |
| A permission prompt for `node …/scripts/scaffold.js` | That's the plugin's own starter-file copier, which lives outside the project folder. The onboarding skills pre-approve it; if your settings still ask, approve it — it never overwrites anything |
| OpenRouter `402` | The account balance is low (not the key's limit) — add credit |
