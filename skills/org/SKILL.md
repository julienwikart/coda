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

## What teams see of each other

Each team's decisions, patterns and declarations are readable by the others: `/coda:recall` searches every team's memory, each brief lists the decisions in force elsewhere that bear on the team, and a contradiction between two teams' decisions shows in both their briefs. Nobody maintains this by hand; it is read from the records each team already writes when it decides.

Two things follow. A decision is visible to other teams once it is committed and, across repositories, pushed and fetched: `coda org sync` refreshes the copies, and each session does it at start. And a decision is found across teams through its entities, so a record without entities is invisible next door (`coda graph --check`).

Journals never cross teams. What a team did day to day stays with that team.

## What is decided for several teams

A decision that binds more than one team is taken once, with `/coda:arbitrate`, by the human the organisation's rule names (`coda org rule`; the organisation's intent architect unless it says otherwise), and kept in `.coda-org/decisions/`. It reaches the brief of every team it binds. `coda org pending` shows what is waiting between teams.

The ethical guardian is declared once, among the organisation's humans, and is then every team's guardian — which is what puts the guardian outside each team. `coda org audit` gives that person the view across teams.

## Floors for every team's harness

Each team sets its own autonomy level, perimeter and verification. The organisation sets what none of them may go below: `coda org floors` shows it, and `coda org floors set --by "<who>" --protect "<glob>" --deny-command "<pattern>" --ask-command "<pattern>" --verify "<command>" --require-review --max-level <level>` states the whole set at once (what is left out is no longer a floor). Paths are relative to each team's own root.

The harness enforces a team's configuration tightened by the floors: protected paths and forbidden commands add up, the organisation's verification commands always run, and the level is the lower of the team's and the cap. A team can be stricter; nothing a team writes in its own configuration makes it laxer. Keep floors to what truly holds for everyone — secrets, releases, the checks no delivery may skip. A floor that only suits some teams will be asked away.

If a team's organisation cannot be read, its last floors read on that machine keep applying; a team that never read them drops to `observed` until it can. That is the one place where the organisation blocks rather than warns.

## The whole at a glance, and splitting a team

`/coda:overview` shows the scopes carried, what is open between teams and which teams have said they are too small; it stands in for a synchronisation meeting. `/coda:split` turns one team into several sandwich teams, each with its scope and the decisions that concern it.

## Inspect it

`coda org status` shows the organisation this team belongs to, its teams, whether this team is registered, and, for a remote organisation, when its copy was last refreshed. `coda org sync` refreshes it now. If the brief says the organisation could not be read, say so plainly: the team is then working without the organisation's constraints in front of it.

In a repository that holds several teams, start the session in the team's own directory to deliver for that team. A session started at the root of the repository belongs to no team: it gets the organisation's brief, each file it changes is judged by the rules of the team that carries it, and commands that act on the repository ask a human.
