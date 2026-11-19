---
name: recall
description: Ask the team's memory — what was decided about a subject, why, by whom, and what happened since. Use when the user asks "what did we decide about…", "why did we…", "have we tried…", or before starting work in an area with history.
---

# Ask the memory

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

Delegate the question to the `coda:memory` agent, passing the user's words and any names of systems, files or people role-holders that could help the search. If the question is about what actually happened rather than what was decided ("when did verification start failing?", "how often were agents stopped by the guard?"), also query the journal: `coda journal query --since 30d --type <prefix>` with prefixes such as `verify`, `guard`, `run`, `decision`, `autonomy`.

Answer the question directly, citing decision ids so the human can open the records. If the memory holds nothing, say so — and if the subject clearly deserves a decision, suggest `/coda:decide`.

Record the use: `coda journal add memory.recall --data '{"query": "<short form of the question>", "hits": <number of records found>}'`. This is how the team sees whether its memory is actually reused.
