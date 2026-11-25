---
name: autonomy
description: Review or change how much execution agents may do without asking — the autonomy level (observed, supervised, bounded) and the perimeter — on the evidence in the journal. Use when the user wants to give agents more or less autonomy, asks whether the team is ready for bounded autonomy or to split, or after an incident.
---

# Autonomy level

Autonomy in a CODA team is a permission the harness enforces, raised on evidence and lowered without ceremony. The system orchestrator decides it.

| Level | Execution agents | Raised when |
|---|---|---|
| `observed` | read and propose; humans make every change | — |
| `supervised` | act; a human approves each change and command | the harness is in place: verification configured, journal recording |
| `bounded` | act freely inside the perimeter; outside it, ask; protected paths, never | supervised has held: approvals are routine, verification passes, agents stay in bounds |

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

## Show the evidence

Run `coda status` and read the journal for the period since the current level was set (`coda journal query --since <date> --type guard`, `--type verify`, `--type review`). Give the human the facts that bear on the level:

- how long the current level has held, and how many sessions and runs it covers — a few sessions are not a track record;
- verification: passed, failed, and above all `verify.unresolved` (work that ended unverified);
- the guard: what agents were denied, what needed approval, and whether approvals at `supervised` were almost always granted for the same kind of change — that is the evidence that a path belongs in the perimeter;
- anything in open patterns or the last audit that speaks against more autonomy.

Then your recommendation, with what you would want to see first if it is "not yet". Recommend lowering the level just as readily: unresolved verifications, a guard denial that repeats, or an incident are reasons to step down while the cause is fixed.

## Change it, if the human decides to

The level: `coda level <level> --by "<name>" --reason "<the evidence, in a sentence>"`. The harness asks the human to approve this command; that approval is the decision. The perimeter (`autonomy.perimeter` in `.coda/config.json`: `write`, `protected`, `askCommands`, `denyCommands`) is edited directly, also under human approval — widen it path by path on evidence, rather than opening everything at once.

## Ready to become a sandwich team — or to split?

When asked, go through the five entry conditions in `coda status` (`entryConditions`). Three can be read from the project: harness in place, autonomy held at `bounded` (for how long is the team's call — state the duration), ethical guardian outside the team. Two only the humans can assert: each person can judge an agent's output alone in their domain, and the product ships without daily dependence on another team. When the team belongs to an organisation, the map supplies part of the second: the status says whether the scope is declared and whether another team claims the same thing. An overlap means the condition is not met; no overlap is necessary, not sufficient. All five are required; name the ones that are missing. And remind them of the reverse door: the regrowth signal in the intent.
