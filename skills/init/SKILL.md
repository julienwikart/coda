---
name: init
description: Set up CODA in a project — the team's humans and roles, the autonomy level agents start at, the verification every delivery must pass, and the .coda/ memory. Use when a team adopts CODA, or when the user asks to install, initialise or set up CODA in a repository.
---

# Set up CODA in this project

CODA lets two or three humans carry a product end to end: they hold the intent, cognitive agents turn it into steering, execution agents deliver. Setting it up means writing down four things the harness will then enforce: who the humans are, what agents may do without asking, what proves a delivery is good, and where the team's memory lives.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

## 1. Look before asking

Check whether `.coda/config.json` already exists; if it does, this project is set up — show `coda status` and stop. Otherwise read the project enough to propose sensible answers: how tests, lint and type checks are run (package scripts, Makefile, CI workflows), where source and tests live, which paths look sensitive (secrets, infrastructure, CI definitions, migrations).

## 2. Ask the humans what only they know

Ask, in as few rounds as possible, proposing what you found:

- **Who is on the team**, and who holds each of the four roles: *intent architect* (holds the why, can veto what contradicts it), *ethical guardian* (audits decisions and agents, can veto on ethical grounds), *system orchestrator* (owns the harness: autonomy level, perimeter, verification), *sovereign maker* (accountable for what ships; accepts or refuses on feasibility). With two or three humans, roles are cumulated — that is expected. One rule: the ethical guardian should be someone outside the team, shared with other teams, because nobody audits their own decisions. If they have nobody yet, record a team member and say plainly that this entry condition is not met.
- **The verification commands** — what must pass before any delivery is accepted. Propose the ones you found. If the project has none, say that this is the first thing to build: without a verification loop, there is nothing safe to delegate.
- **The autonomy level to start at.** `observed`: agents read and propose, humans make every change. `supervised` (the default, and the right start for most teams): agents act, a human approves each change and command. `bounded`: agents act freely inside a declared perimeter. Recommend `supervised`; a team earns `bounded` with evidence (`/coda:autonomy`).
- **The perimeter** — which paths execution agents may write in under bounded autonomy, and which are protected at every level. Propose from what you saw.

## 3. Write it down

Run `coda init --name "<team>" --level <level> --verify "<cmd>" [--verify "<cmd>"]`. Then edit `.coda/config.json` to add the humans and adjust the perimeter — the harness will ask the human to approve that edit, which is intended: this file defines what agents are allowed to do.

```json
"team": { "name": "…", "humans": [
  { "name": "Ana", "roles": ["intent-architect", "sovereign-maker"] },
  { "name": "Karim", "roles": ["system-orchestrator", "sovereign-maker"] },
  { "name": "Lou", "roles": ["ethical-guardian"], "external": true }
] }
```

## 4. Hand over

Run `coda doctor` and show what is in place and what is not. Tell them what happens from now on — every session starts from the team's brief, the harness enforces the level, every run lands in the journal, nothing is accepted until verification passes — and that `.coda/` is meant to be committed: it is the team's shared memory. The next step is the intent: offer to run `/coda:intent` now.
