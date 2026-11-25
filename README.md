# CODA

**Two humans, one intent, agents that deliver.**

CODA (Cognitive Orchestration for Delivery Agents) is a way to run a product with a *sandwich team*: two humans who carry it end to end, with agents for everything else. It installs into your coding agent as a plugin. There is no server, no database and no API key: your agent is the runtime, your repository is the memory.

[Français](README.fr.md)

## Install

In Claude Code (terminal, VS Code, JetBrains or desktop):

```
/plugin marketplace add julienwikart/coda
/plugin install coda@coda
```

Then, in the project you want to run this way:

```
/coda:init
```

It asks who is on the team, what must pass before a delivery is accepted, and how much agents may do without asking. It writes a `.coda/` directory that you commit. Requires Node 18 or newer on the machine. Other agents and harnesses: see [the harness contract](docs/harness-contract.md).

## What changes once it is installed

A harness is everything around the model in an agent. CODA does not replace yours; it makes it guarantee five things, so that a team this small can actually delegate.

| Layer | What CODA makes the harness do |
|---|---|
| Context and memory | Every session starts from the team's brief: the intent, its non-negotiable constraints, the decisions in force, the open patterns. |
| Guardrails | The autonomy level is a permission, not an instruction. Writes and commands outside what the team delegated are denied or sent to a human, whatever the model was told. |
| Verification loops | A session cannot end on changed code until the team's verification commands pass — and, if you require it, until an independent verifier agent has reviewed that exact state of the tree. |
| Tool orchestration | Cognitive agents plan and brief; execution agents build. Cognitive agents cannot write code; builders cannot approve themselves. |
| Observability | Every run, write, command, denial and verification lands in an append-only, hash-chained journal in the repository. |

Three floors, each talking only to its neighbour:

```
 HUMANS          hold the intent           intent architect · ethical guardian
                                           system orchestrator · sovereign maker
     │ intent, decisions
     ▼
 COGNITIVE       turn it into steering     memory · pattern · simulation · coordination
 AGENTS                                    (read-only)
     │ briefs                ▲ journal
     ▼                       │
 EXECUTION       deliver                   builder · verifier
 AGENTS                                    (inside the delegated perimeter)
```

Where spec-driven development lets the spec drive, here cognition drives: what the team intends, what it already decided, and what keeps recurring.

## Day to day

| Command | When |
|---|---|
| `/coda:intent` | Write or revise what the team is for, and what it will not trade away. |
| `/coda:deliver <request>` | Build something: memory → plan and briefs → builders → verification. |
| `/coda:decide <question>` | A choice that is costly to reverse: memory, simulation, a human decides, it is recorded. |
| `/coda:recall <question>` | "What did we decide about…?" |
| `/coda:graph <thing>` | What touches a component, a constraint, a risk; how decisions depend on or contradict each other. |
| `/coda:patterns` | What keeps recurring; ignore, correct or experiment. Replaces the retrospective. |
| `/coda:sync` | Are we still serving the intent? Replaces the status meeting. |
| `/coda:audit` | Evidence for the ethical guardian: how decisions were made, whether agents stayed in bounds. |
| `/coda:autonomy` | Raise or lower what agents may do, on the journal's evidence. |
| `/coda:status` | Where the team stands, and whether the harness is really in place. |
| `/coda:org` | Several teams: the organisation's intent and constraints, declared once and delivered to every team. |

You do not have to use the commands for the harness to work. Once `.coda/` exists, any session in the project gets the brief, the guardrails, the journal and the verification gate.

## Autonomy levels

| Level | Execution agents | 
|---|---|
| `observed` | read and propose; humans make every change |
| `supervised` (default) | act; a human approves each change and each command |
| `bounded` | act freely inside a declared perimeter; outside it they ask; protected paths, never |

A team earns the next level with evidence from its own journal, and a named human records the change. The journal, the verification state and the autonomy level cannot be written by the model: the harness writes them.

## What is in `.coda/`

```
.coda/
├── config.json      team, roles, autonomy level and perimeter, verification commands
├── intent.md        purpose, objectives, constraints, out of scope, regrowth signal
├── decisions/       D-0001-….md — one record per decision, never rewritten;
│                    their entities and links form the knowledge graph
├── patterns/        P-0001-….md — reviewed recurrences
├── audits/          the ethical guardian's reports
└── journal/         append-only events, one stream per session, hash-chained
```

Plain files in git: the memory is shared by pull request, readable without CODA, and survives any tool.

## The framework

The plugin is the reference implementation of a framework. Read it before reorganising a team around it:

- [The framework](docs/framework.md) — the sandwich team, the three floors, the four roles, entry conditions, the path from a team of eight to teams of two, and what holds at company scale.
- [The harness contract](docs/harness-contract.md) — what any harness must guarantee, and how to adapt one that is not Claude Code.
- [Coming from SYNAPSE](docs/from-synapse.md) — what carried over and what was dropped.

One position is not negotiable: at equal headcount, more teams and more scope. People freed by a split form new sandwich teams. Headcount reduction is never an objective of this framework.

## Status

Version 0.1. The harness adapter is tested (`npm test`) and has been exercised end to end in Claude Code. The framework's thresholds — how long bounded autonomy must hold before a split, which roles may be cumulated — are proposals awaiting field evidence; see the open questions in [the framework](docs/framework.md).

## License

Code: MIT. Framework text and documentation: CC BY-SA 4.0. See [LICENSE](LICENSE).
