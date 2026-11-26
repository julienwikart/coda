---
name: sync
description: Run an intent sync — check whether what the team actually decided and delivered over the period still serves its intent, and surface drift. Use weekly, or when the user asks whether the team is still aligned or on course.
---

# Intent sync

A short, regular check that the team is still doing what it said it was for. The facts are already in the memory and the journal; this reads them.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

Gather, for the period (the last 7 days unless told otherwise): the intent (`.coda/intent.md`), the organisation's intent when the team has one (it is in the brief; `coda org status` says where it is read from and how fresh it is), the decisions recorded in the period (`coda list decisions`, then read them), the journal's account of what was delivered and how it went (`coda journal query --since 7d`: deliveries, verification results, guard events, unresolved verifications), open patterns, and `coda status`.

Then give the humans a brief they can read in two minutes:

- **The organisation, if there is one.** Whether what the team decided and delivered still serves the organisation's intent, and whether anything moved against one of its constraints — quote the constraint and the evidence. A team can be faithful to its own intent while drifting from the organisation's; that is the case this line exists for. If the brief says the organisation could not be read, say so instead of assessing it.
- **Alignment.** For each objective of the intent: what in this period served it, and whether nothing did. Decisions or deliveries that serve no objective are named — they are either drift or a sign the intent is missing something.
- **Drift.** Anything that moved against a constraint or into what the intent declares out of scope. Quote the constraint and the evidence. If there is none, say there is none.
- **Health of the system.** Verification failing or left unresolved, agents repeatedly stopped by the guard on the same thing, decisions taken without consulting the memory, decisions marked `decided` that have not moved.
- **The regrowth signal.** State the signal the intent names and what the evidence says about it. If the evidence says it has fired, say so first: raising it is the humans' call — `coda regrowth raise --by "<who>" --note "<what was observed>"` — and it is how the rest of the organisation learns that this team is too small for what it carries. If the intent names none, say that this is the gap to close first.
- **One focus** for the coming period, as a proposal.

Do not compute an alignment score: a number here would look like measurement and is not one. Separate what the records show from what you infer.

The humans decide what follows — usually nothing, sometimes a `/coda:decide` or a revision of the intent. Record the sync: `coda journal add intent.sync --data '{"period": "7d", "drift": true|false, "focus": "<one line>"}'`.
