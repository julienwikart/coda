---
name: arbitrate
description: Settle what two teams cannot settle between them — a contradiction between their decisions, an overlap of scope, a choice that binds several teams — by a decision of the organisation, taken by the human its rule names and delivered to the brief of every team concerned. Use when the brief shows an open contradiction or overlap between teams, when a decision would bind more than one team, or when the user asks to arbitrate between teams.
---

# Arbitrate between teams

A team decides for itself with `/coda:decide`. What reaches into another team is not one team's to decide: it is settled once, by a named human, and then it binds the teams concerned the way their own decisions do. You prepare the decision; you do not take it, and you do not lean towards the team whose session this is.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below.

## 1. See what is waiting

`coda org pending` lists the contradictions between teams' decisions, the overlaps of scope, and what recurs across teams. `coda org rule` says who arbitrates and on what criterion; unless the organisation's rule names someone else, it is the organisation's intent architect. If nobody is named, stop and say so: an arbitration nobody is entitled to take settles nothing.

## 2. Lay out both sides

Read the records involved in full, in each team: `coda org decisions --grep "<words>"` gives their paths, `coda graph --org --around <entity>` what else was decided about the same thing. For each team, state what it decided, why, and what it would cost that team to give way. Use each team's own words from its records. Then the organisation's intent and its rule: say what the criterion, applied to this case, points to — and where it does not decide the matter.

For a choice that is costly to reverse, ask the `coda:simulation` agent for scenarios covering every option, including "leave both as they are".

## 3. The named human decides

Present it to the arbiter and ask for the decision. If the person in the conversation is not the arbiter, say that the decision is theirs to take, give them what you prepared, and stop: do not record it on their behalf.

## 4. Record it with the organisation

Path from `coda org next-id "<short title>"`. The record lives in `.coda-org/decisions/`:

```markdown
---
id: X-0003
title: <the decision, as a statement>
date: <YYYY-MM-DD>
status: decided
maker: <the arbiter's name> (<role>)
teams: [<the teams it binds; leave empty to bind every team>]
settles: [<team/D-0001, team/D-0002 — the decisions whose contradiction it ends>]
entities: [<type:name, …>]
supersedes: <X-id, if any>
---
# X-0003 <title>

## Context
What the teams disagreed on, or what had to be the same for several of them.

## Decision
What is decided, in one or two sentences a team's agent can act on. This is what reaches the briefs.

## Why
The criterion that decided it, and how it serves the organisation's intent.

## What changes for each team
Per team: what it keeps, what it gives up, what it has to do.
```

Then `coda org record X-0003 --by "<the arbiter>"`. It is refused if the record does not exist, if its maker is not the human the rule names, or if it names a team the organisation does not list. Writing under `.coda-org/` and recording both ask a human to approve.

When the organisation lives in its own repository, a team's session only holds a read-only copy: write the record and run the command in the organisation's repository, by pull request. It reaches the teams when they next refresh.

## 5. Let the teams follow

The decision appears in the brief of each team it binds at their next session, and a contradiction it settles stops being reported. It does not rewrite the teams' own records: each team concerned marks its overruled decision `superseded` itself, with `/coda:decide`, and a team whose scope changes updates its declaration with `coda scope set`. Say which team has what to do.
