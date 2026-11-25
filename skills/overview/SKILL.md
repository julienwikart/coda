---
name: overview
description: Show where the whole organisation stands — which scopes are carried and by which team, what is open between teams, what waits for an arbitration, which teams say they are too small. Use when the user asks for the state of the organisation, of all teams, for what needs their attention across teams, or instead of a synchronisation meeting between teams.
---

# The organisation at a glance

This replaces the meeting where teams tell each other where they are. The facts are already in what each team declares and decides; nobody has to report.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below.

Run `coda org view` (`--format md` for a page a human can read as is; `coda org sync` first when the teams live in other repositories, and say how old the copies are). Present, in this order:

1. **What needs a human now.** Contradictions between two teams' decisions and overlaps of scope, with who arbitrates (`/coda:arbitrate`); teams that have raised their regrowth signal, with what they observed; decisions of the organisation taken by someone other than the arbiter. If there is nothing, say so in one line.
2. **Scopes carried.** How many, and which team carries what. This number is the measure of the organisation: more scopes carried at equal headcount is the framework working. Never report or derive a headcount.
3. **What recurs across teams** — a constraint or a risk met three times in more than one team — as a matter for the organisation.
4. **Gaps**: a team with no intent in force, with nothing declared, with no regrowth signal named, or that could not be read.

The view lists teams in the order the organisation lists them and shows only what each declares. Keep it that way: do not sort teams by anything, do not set one team's figures beside another's, do not comment on how active a team is. A team that has raised its regrowth signal has done what the framework asks; report it as a request to answer, never as a weakness.

A regrowth signal is raised by the team's own humans, when the signal named in their intent has fired: `coda regrowth raise --by "<who>" --note "<what was observed>"`, and cleared with `coda regrowth clear --by "<who>"`.
