---
name: deliver
description: Deliver a piece of work the CODA way — the cognitive layer plans and briefs, execution agents build inside the delegated perimeter, an independent verifier reviews, and nothing is accepted until verification passes. Use when the user asks to build, implement, fix or ship something in a project that has .coda/.
---

# Deliver

The humans hold the intent; they do not drive execution agents directly. This skill is the path from one to the other: memory, then a plan and briefs from coordination, then builders, then verification.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

## 1. Ground the request

Read `coda brief` if it is not already in context. If the intent is still a draft, stop and say so: there is nothing to steer by yet (`/coda:intent`). Ask the `coda:memory` agent what the team has decided that bears on this request.

If the request contradicts the intent or a decision in force, tell the human before anything is built. They either adjust the request or revisit the decision with `/coda:decide`. Delivering around a decision silently is the one thing this framework exists to prevent.

## 2. Plan

Delegate to the `coda:coordination` agent: the request, the memory's findings, and the CLI line above. It returns what done means, the work packages, a brief for each, and what falls outside the perimeter. For anything larger than a small change, show the plan to the human and wait for their go — especially the part that needs a human to act.

## 3. Build

Launch one `coda:builder` agent per work package, with its brief passed whole and unedited; packages marked parallel go out together. The builders work under the team's autonomy level: at `supervised` the human approves each change, at `bounded` builders act freely inside the perimeter, at `observed` they can only propose — in that case collect their proposed changes and present them for the human to apply.

When a builder reports that a constraint or a permission stopped it, bring that to the human as it is. Do not do in the main session what the builder was not allowed to do.

## 4. Verify

Run `coda verify`, then delegate a review to the `coda:verifier` agent with the original brief(s). If either fails, send the findings back to a builder and verify again; a check is fixed at its cause, never weakened. The harness records both results in the journal and will refuse to let the session end on changes that have not passed.

## 5. Report

Tell the human what was delivered and what proves it (verification output, the verifier's verdict), what was not done and why, what now needs a human (a push, a protected file, a deploy), and anything the builders noticed outside their packages. If the work embodied a choice the team will want to remember, suggest recording it with `/coda:decide`.

Record the delivery once, when it is finished or given up, not at each attempt: `coda journal add delivery.completed --data '{"request": "<one line>", "packages": <n>}'`. The harness adds whether the delivered state passed verification and review; you cannot assert it.
