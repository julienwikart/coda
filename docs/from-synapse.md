# Coming from SYNAPSE

CODA is the second version of the SYNAPSE framework ([synapse-origin/synapse-fr](https://github.com/synapse-origin/synapse-fr)). The ideas carried over; the way it reaches people changed completely.

## Why the distribution changed

SYNAPSE shipped as a framework to read plus a reference platform to deploy: an API gateway (Fastify, PostgreSQL, Redis, an LLM provider key) and a web application with dashboards. Adopting it meant standing up infrastructure, then moving the team's decisions into a new tool beside the place where work happens.

CODA goes where the work already is. The coding agent a team uses every day is the runtime; the repository is the database; git is the synchronisation. Installing it is two commands, and nothing has to be operated.

| SYNAPSE platform | CODA |
|---|---|
| PostgreSQL models (decisions, intents, patterns, events) | Markdown records and a JSONL journal in `.coda/` |
| Agents as server code calling an LLM API | Agents as prompts run by the user's own coding agent |
| Scheduled jobs (pattern scan, intent sync, bias detection) | Skills run on demand: `/coda:patterns`, `/coda:sync`, `/coda:audit` |
| Web dashboards per role | `/coda:status`, and the files themselves |
| JWT, API keys, role permissions on API routes | The harness's permissions, set by autonomy level |
| Event log table | Append-only, hash-chained journal |
| Embedding search over decisions | The memory agent reading and searching records |

## What carried over

- The three layers — intention, cognition, execution — now the three floors.
- The four human roles and their vetoes.
- The four cognitive agents, with their missions and their limits (three occurrences for a pattern, no comparison of individuals, simulations that state their assumptions, agents propose and humans decide).
- The three loops: Decision Moment (`/coda:decide`), Pattern Review (`/coda:patterns`), Intent Sync (`/coda:sync`).
- The intent, with one in force at a time and organisation and team levels.
- The ethical charter's non-negotiables, as the frame of `/coda:audit`.

## What is new

- The sandwich team as the unit, with entry conditions and a path to get there.
- Execution agents as a floor of their own, steered by the cognitive floor.
- The harness contract: five guarantees, enforced rather than recommended.
- Autonomy levels applied as permissions.

## What was dropped

- The subtitle "Cognitive Agility Framework" and the "post-agile" label.
- The comparison table with Scrum and Kanban.
- The 5-to-50-people target.
- Numeric scores computed by a model (alignment score, health score). CODA reports counts from the journal and leaves judgement to humans.
- Multi-tenant hosting. A shared cognition service across teams may return for the company level; it is not part of 0.1.

## Moving existing data

There is no automatic migration in 0.1. Decisions and intents exported from a SYNAPSE instance map directly onto the record formats described in `/coda:decide` and `/coda:intent`; write them into `.coda/decisions/` and `.coda/intent.md` and commit.
