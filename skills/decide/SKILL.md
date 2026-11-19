---
name: decide
description: Run a decision moment — retrieve what the team already decided, simulate the options, let a human decide, and record the decision in the team's memory. Use for any significant or hard-to-reverse choice (architecture, dependency, scope, process), when the user says "let's decide", or when work is about to contradict a past decision.
---

# Decision moment

A decision in a CODA team is taken by a human, informed by memory and simulation, and written down so that it never has to be rediscovered. You run the moment; you do not take the decision.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

## 1. Frame it

State the decision to take in one sentence and get the human to confirm it. Collect the options already on the table — theirs first. Name the type: *strategic* (changes direction or a constraint), *tactical* (how an objective is pursued), *operational* (day-to-day, cheap to reverse). Operational decisions rarely need simulation; say so and offer to go straight to recording.

## 2. Ask the memory

Delegate to the `coda:memory` agent: the decision, the options, and the question "what have we decided that bears on this, and does any option contradict a decision in force or the intent? Which entities and links would place this decision in the graph?". Pass it the CLI line above. Show the human what came back, contradictions first. If an option contradicts a decision in force, that is not a blocker — it means this decision would supersede the old one, and the human should know it is doing so.

## 3. Simulate

For strategic and tactical decisions, delegate to the `coda:simulation` agent with the decision, every option, the memory's findings and the horizon. Present the scenarios as they are — assumptions, risks, reversibility — and the recommendation as what it is: a judgement, with its confidence. Invite the human to challenge assumptions or add a scenario, and re-run if they do.

## 4. The human decides

Ask who decides and what they choose. Do not infer a decision from enthusiasm, and do not choose for them if they ask you to — give your recommendation and let them say the word. If a role holder with a veto (intent architect, ethical guardian) is not the one deciding and the decision touches the intent's constraints or people's rights, say that their view is needed before this is final.

## 5. Record it

Get the path with `coda next-id decisions "<short title>"` and write the record there:

```markdown
---
id: D-0007
title: <the decision, as a statement>
date: <YYYY-MM-DD>
type: strategic | tactical | operational
status: decided
maker: <name> (<role>)
tags: [<free words someone would search for>]
entities: [<type:name, …> — what this decision is about]
depends-on: [<ids of decisions this one relies on>]
contradicts: [<ids of decisions in force it conflicts with, if the human chose to leave both standing>]
related: [<ids>]
supersedes: <id, if any>
simulated: true | false
---
# D-0007 <title>

## Context
Why this had to be decided now.

## Options considered
Each option, with what spoke for and against it.

## Simulation
The scenarios in brief, the assumptions that mattered, the recommendation and its confidence. Omit if not simulated.

## Decision
What was chosen, in the human's terms.

## Why
The criteria that decided it, and how it serves the intent.

## Trade-offs accepted
What is knowingly given up, and the risks taken.

## Review
When or on what signal this decision should be looked at again.
```

The `entities` and the links are what place this decision in the team's knowledge graph. Take the ones the memory agent proposed, show them to the human with the record, and keep what they confirm. Entity types are `team`, `technology`, `tool`, `component`, `concept`, `process`, `metric`, `constraint`, `risk`, `opportunity`; reuse existing names (`coda graph --format entities`) rather than coining a second name for the same thing. People are never entities.

If it supersedes an earlier decision, set that record's `status: superseded` and add a line pointing to the new one; change nothing else in it — the history stays as it was. Then `coda journal add decision.recorded --data '{"id": "D-0007", "type": "…", "maker": "<name>", "simulated": true}' --actor human:<name>`.

The journal entry is refused if the record file does not exist. If writing the record was not approved, the decision is not in the team's memory: say so plainly rather than reporting it as recorded.

Finish by saying what the decision changes for work in progress, if anything.
