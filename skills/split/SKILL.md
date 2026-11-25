---
name: split
description: Split a team into several sandwich teams of two — each with its own scope, a draft of its intent and the decisions in force that concern it — once the entry conditions hold. Use when the user wants to split a team, asks how to go from one larger team to several teams of two, or asks which decisions each new team would inherit.
---

# Split a team

A team does not shrink: it becomes several sandwich teams, each carrying a scope of its own. At equal headcount that is more teams and more scope, which is the point; nothing here is a way to do the same with fewer people, and this skill does not decide who goes where.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the directory of the team being split.

## 1. Is it time?

Run `coda status` and go through the entry conditions with the humans (`/coda:autonomy` details them). All five hold for the team as it is, and each new team will have to hold them alone: say plainly which are not met. Splitting before the agents' autonomy is proven produces several small teams that cannot ship.

## 2. Cut along the architecture

Ask what the new teams will carry, and check it against the code and the decisions: a scope is a part of the system that can ship without daily dependence on the others. Each scope goes to exactly one team. If two candidate teams would keep touching the same component, the cut is in the wrong place; say so rather than splitting.

## 3. Show who inherits what

`coda split --plan --into "<team>=<directory>:<what it carries, comma-separated>" --into "…"` writes nothing and shows, for each new team, the decisions in force it would inherit and why: those that name its scope, those that name no new scope and so concern every new team, and whatever those link to. Add `--keep "<what stays>"` when the present team continues with part of its scope instead of ending.

Go through the plan with the humans. Where a decision is going to the wrong team, correct it with `--assign <D-id>=<team,…>` and show the plan again. Superseded decisions are not inherited; open patterns go to every new team.

## 4. Split

The same command without `--plan`, with `--by "<who decides>"`. The harness asks a human to approve it. Each new team gets its `.coda/`: its scope, the present team's verification, perimeter and autonomy level (inherited, with the harness that earned it — never higher), the decisions and open patterns it inherits, each marked with where it came from, and the present intent as a draft.

The split is written in the journal of the team that was split, of each new team, and of the organisation. A team that keeps nothing stays in the repository as history: it carries nothing, and nothing can be delivered in it any more.

## 5. What the humans still have to do

Say this clearly, because the tool stops here:

- **Each new team's two humans are theirs to name.** The new teams start with none declared. Add them to each `.coda/config.json`, with their roles.
- **Each new team writes its own intent** (`/coda:intent`). The copy is a draft and is not in force: a team that has not made its intent its own has nothing to steer by.
- **The code is not moved.** Moving each scope's code into its team's directory is ordinary work, done after the split, by the teams.
- **Name each team's regrowth signal**, in its intent: at two, each person is a single point of failure.
- If the organisation lives in another repository, register the new teams there (`coda org add-team`).
