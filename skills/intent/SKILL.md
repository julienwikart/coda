---
name: intent
description: Write or revise the team's intent — purpose, objectives, non-negotiable constraints, out of scope, success criteria, regrowth signal. Use when the team has no intent yet, when the user wants to change direction or constraints, or when work keeps raising "why are we doing this".
---

# Write or revise the intent

The intent is what the humans hold and everything else derives from: cognitive agents steer by it, every execution brief carries its constraints, and the alignment of a decision is judged against it. It lives in `.coda/intent.md`. One intent is in force at a time.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

The intent belongs to the intent architect. Your part is to make it sharp, not to write it for them. Read the current `.coda/intent.md` and `.coda/config.json` (who holds which role), then work through the sections with the human:

- **Purpose** — one or two sentences on why this team and product exist. If it could be the purpose of any team, it is not done.
- **Objectives** — three to five, each with a measure and a horizon. Several strategic directions are several objectives, not several intents.
- **Non-negotiable constraints** — legal, ethical, business, technical. These are quoted to agents in every brief and checked in every review, so each must be concrete enough to tell whether a given change breaks it. "Respect privacy" cannot be checked; "no personal data leaves the EU region" can.
- **Out of scope** — what the team does not do. This is what lets an agent stop instead of drifting.
- **Success criteria** — how they will know.
- **Regrowth signal** — fixed in advance: the observable signal that means two humans are no longer enough and the team must grow. At this size each person is a single point of failure; a team that has not named its signal will notice too late.

Push back where it helps: an objective with no measure, a constraint nobody could verify, two objectives that pull against each other. Then let them decide.

When revising an existing intent, first ask the `coda:memory` agent which decisions in force rest on the parts being changed, and show them: changing a constraint can silently invalidate decisions. Those are then revisited one by one with `/coda:decide`, not rewritten in passing.

Write the result to `.coda/intent.md`, keeping the section headings exactly (the brief reads them). In the frontmatter set `status: active`, increment `version`, set `architect` and `updated`. Then record it: `coda journal add intent.updated --data '{"version": N, "by": "<name>", "summary": "<what changed>"}' --actor human:<name>`.

If the organisation has an intent above the team's, the team intent inherits its constraints and out-of-scope: copy them in, marked as inherited, and say where an objective here does not obviously serve one above.
