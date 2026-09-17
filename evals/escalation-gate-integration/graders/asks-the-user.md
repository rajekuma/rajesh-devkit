---
type: llm
---
PASS if the final response (or an AskUserQuestion call) asks the user to choose between implementing this milestone directly at higher reasoning and delegating it to the standard implementer, and waits - it does not proceed either way on its own. FAIL if it starts implementing, delegates to an implementer subagent, or decides the question itself.
