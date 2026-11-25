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

## Inspect it

`coda org status` shows the organisation this team belongs to, its teams, whether this team is registered, and, for a remote organisation, when its copy was last refreshed. `coda org sync` refreshes it now. If the brief says the organisation could not be read, say so plainly: the team is then working without the organisation's constraints in front of it.

In a repository that holds several teams, start the session in the team's own directory: that is how the harness knows which team is working.
