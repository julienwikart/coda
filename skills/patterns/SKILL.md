---
name: patterns
description: Run a pattern review — find what keeps recurring in how the team and its agents work, and let the humans decide for each pattern whether to ignore it, correct it or run an experiment. Use weekly, when the user asks what keeps going wrong (or right), or after repeated verification failures.
---

# Pattern review

This replaces the retrospective held on a calendar: recurrences are read from what actually happened, and the humans spend their time on the decision, not on remembering.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

Delegate detection to the `coda:pattern` agent, giving it the period (30 days unless the user says otherwise) and the CLI line above. It reads the journal, the decisions, the knowledge graph (constraints and risks that recur across decisions), the known patterns and the git history, and returns at most five patterns with their evidence.

When the team belongs to an organisation, the agent also reports recurrences across teams. Those are the organisation's to act on: present them apart from the team's own, and do not record a review decision for them here on the other teams' behalf.

Present each one with its occurrences, so the human can check the evidence, and ask for a decision on each:

- **Ignore** — not a real pattern, or not worth acting on. Record why; a pattern ignored twice for the same reason should stop being raised.
- **Correct** — a change to the system: the perimeter, the verification commands, how briefs are written, a constraint in the intent. If it changes the autonomy level or the intent, it goes through `/coda:autonomy` or `/coda:intent`.
- **Experiment** — try something for a fixed duration, with the criterion that will decide whether it stays.

Record each reviewed pattern at the path given by `coda next-id patterns "<short title>"` (or update the existing record when the pattern was already known):

```markdown
---
id: P-0003
title: <what repeats>
date: <first detected>
polarity: negative | positive | neutral
severity: low | medium | high | critical
status: detected | experimenting | resolved | ignored
occurrences: <count>
entities: [<type:name, …>]
decisions: [<ids of the decisions it was observed in>]
reviewed: <YYYY-MM-DD> by <name>
---
# P-0003 <title>

## Evidence
The occurrences: dates, journal events, commits, records.

## Likely cause
Systemic, never personal.

## Review decision
Ignore, correct or experiment — what exactly, who acts, and for an experiment its duration and success criterion.
```

Then `coda journal add pattern.reviewed --data '{"id": "P-0003", "action": "ignore|correct|experiment"}' --actor human:<name>`. A pattern is about how the system works. If a finding reads as being about a person, drop it.
