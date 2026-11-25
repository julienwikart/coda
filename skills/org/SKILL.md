---
name: org
description: Set up or inspect the organisation several sandwich teams belong to — its intent and non-negotiable constraints, its humans, and the list of its teams. Use when the user wants several CODA teams to share an intent, asks to create an organisation, to attach a team to one, or asks what the organisation requires of this team.
---

# The organisation

When teams are two people each, there are more of them, and what links them matters more than what happens inside each. The organisation is what they share. In this version it carries an intent — a purpose, non-negotiable constraints, what is out of scope for everyone — its humans, and the list of its teams. Every team's sessions receive the organisation's constraints in their brief, read from the organisation itself: nobody copies them into each team.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below.

It lives in a `.coda-org/` directory, in one of two places. Ask which fits before creating anything:

- **Same repository as the teams.** `.coda-org/` sits at the root and each team has its own `.coda/` in its directory. Teams find the organisation by themselves; nothing to configure in each.
- **A repository of its own.** Each team references it by URL and keeps a read-only local copy, refreshed at the start of each session. Offline, the last copy serves, and the brief says how old it is.

## Create it

In the directory that will hold it: `coda org init --name "<organisation>" --by "<who decides>" --human "<name>=intent-architect" --human "<name>=ethical-guardian"`. Then write `.coda-org/intent.md` with the organisation's intent architect, the way `/coda:intent` does for a team: a purpose, objectives, and above all constraints concrete enough that anyone can tell whether a change breaks them, because they will bind every team.

Register each team: `coda org add-team --name "<team>" --path "<dir>" --by "<who>"`, or `--repo "<git url>"` for a team in its own repository. The name must be the team's own name in its `.coda/config.json`.

## Attach a team

A team in the same repository needs nothing. A team in another repository runs, from its root: `coda org join --repo "<git url of the organisation>" --by "<who>"`.

Each of these commands asks a human to approve it, and everything under `.coda-org/` is changed only with a human's approval, at every autonomy level: it defines what all teams are held to. When the organisation is in another repository, a team cannot change it from its own session at all; changes go to that repository by pull request.

## Say who carries what

Each team declares what it answers for, from its own directory: `coda scope set --by "<who>" --domain "<domain>" --component "<component>"` (several of each are fine). A domain is a part of the business the team owns the decisions for; a component is a piece of the system it maintains. Cut along the architecture: a scope that follows a real seam in the system can ship alone, one that follows the org chart cannot.

Together the declarations form the map, and every team's brief carries it. `coda org map` shows it; `coda org check` lists overlaps — two teams declaring the same domain or component, or one team's directory inside another's — and gaps, such as a team that has declared nothing. An overlap is reported the moment it is declared and stays in the briefs of the teams concerned until it is settled. It is a fact for the humans to settle; do not pick a side or edit either declaration to make it go away.

In a repository several teams share, the harness refuses any write in another team's directory, at every autonomy level. Across repositories there is no such wall: the map in the brief is what tells an agent it is about to reach into another team's scope.

## Inspect it

`coda org status` shows the organisation this team belongs to, its teams, whether this team is registered, and, for a remote organisation, when its copy was last refreshed. `coda org sync` refreshes it now. If the brief says the organisation could not be read, say so plainly: the team is then working without the organisation's constraints in front of it.

In a repository that holds several teams, start the session in the team's own directory to deliver for that team. A session started at the root of the repository belongs to no team: it gets the organisation's brief, each file it changes is judged by the rules of the team that carries it, and commands that act on the repository ask a human.
