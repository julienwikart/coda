# The CODA framework

A sandwich team is two humans who carry a product end to end, with agents for everything else. The framework exists to make that format possible, and then to bring a whole company to it.

| What it is | What it is not |
|---|---|
| Two humans, one shared intent | A pizza team with people removed |
| The scope of a former team of six to nine | A headcount reduction plan |
| Cognitive agents steering execution agents | Yesterday's team going faster with assistants |

## Three floors

Humans hold the intent. Cognitive agents turn it into steering. Execution agents deliver. Where spec-driven development lets the spec drive, here cognition drives.

Each floor talks only to its neighbour: humans do not drive execution agents directly, and execution agents report upward through the journal.

**Humans — four roles.** With two people, roles are cumulated: each holds two, and the ethical guardian sits outside the team.

| Role | Holds | Power |
|---|---|---|
| Intent architect | the why: purpose, objectives, constraints | veto on what contradicts the intent |
| Ethical guardian | ethics and integrity; audits decisions and agents | veto on ethical grounds |
| System orchestrator | the harness: autonomy level, perimeter, verification | configures the system |
| Sovereign maker | what ships | accepts or refuses on feasibility |

**Cognitive agents — four, read-only.** They propose; humans decide.

| Agent | Does |
|---|---|
| Memory | retrieves what was decided and why; detects contradictions |
| Pattern | finds what recurs, from three occurrences up, in what actually happened |
| Simulation | lays out scenarios, assumptions and reversibility before a costly decision |
| Coordination | turns intent and request into work packages and self-contained briefs |

**Execution agents.** A builder delivers one work package inside the delegated perimeter. A verifier reviews it independently, without write access. The list beyond development and testing is an open question.

## The harness

The framework does not ship a harness. It states what any harness must guarantee for a sandwich team to be able to delegate; the harness is everything around the model in an agent ("Agent = Model + Harness", in the formulation used by [Faros AI](https://www.faros.ai/blog/harness-engineering), from which the five layers below are taken). This keeps the framework independent of the tool.

| Harness layer | What the framework requires |
|---|---|
| Tool orchestration | Cognitive agents trigger and sequence execution agents |
| Verification loops | No output accepted without passing tests and review |
| Context and memory | Intent, decisions and patterns arrive from the cognitive layer |
| Guardrails | Autonomy levels are applied by permissions, not by instructions |
| Observability | Every run feeds an append-only event journal |

The precise guarantees are in [the harness contract](harness-contract.md). What a harness does not do is say which team organises around it. Harness engineering makes an agent reliable; the framework changes the team.

## Autonomy levels

| Level | Execution agents | Signal to move up |
|---|---|---|
| Observed | read and propose; humans make every change | the harness is in place |
| Supervised execution | act; a human approves each change and command | approvals have become routine, verification passes, agents stay in bounds |
| Bounded autonomy | act freely inside a declared perimeter; ask outside it | — |

A named human moves the level, with a reason, and it is journaled. Moving down needs no justification beyond an incident.

## Entry conditions

A team becomes a sandwich team when all five hold; one missing blocks the move. These are proposals to validate in the field.

1. **Seniority.** Each human can judge an agent's output alone in their domain.
2. **Independent scope.** The product ships without daily dependence on another team.
3. **Harness in place.** Automatic tests, mandatory verification and the journal already work.
4. **Autonomy held.** The execution layer has worked at bounded autonomy for a duration to be fixed.
5. **Ethical guardian outside the team.** Nobody audits their own decisions.

`/coda:autonomy` reads conditions 3 to 5 from the project and asks the humans to assert 1 and 2.

The weak point, faced head-on: at two, each person is a single point of failure. A synthesis on sizing teams with agents keeps four to five humans as the prudent reference and asks for at least three people able to deliver alone ([Agility at Scale](https://agility-at-scale.com/safe/ai-enabled-safe/from-two-pizza-to-two-slice-ai-team-sizing-in-safe-arts/)). What compensates in this framework is the shared memory — the decisions, the intent and the journal live in the repository, not in someone's head — and the possibility for another sandwich team to take the scope over. The same source recommends fixing in advance the signal that makes the team grow again; the intent has a section for it.

## From eight to two

A team of eight does not lose six people. It splits into four sandwich teams once the agents' autonomy is proven.

1. **Equip.** The team keeps its size and installs the harness and the execution layer. *Move on when* agents hold supervised execution.
2. **Connect cognition.** Memory, patterns and coordination take over from synchronisation meetings. *Move on when* decisions are found in the memory without being asked for again.
3. **Widen autonomy.** The execution layer moves to bounded autonomy. *Move on when* all entry conditions hold.
4. **Split.** The team becomes four sandwich teams, each with its scope and its intent. *Move on when* each new team ships alone.
5. **Stabilise.** Human measures — cognitive load, perceived autonomy, trust in the system — decide whether the format holds. *Go back when* the regrowth signal fixed in advance fires.

## At company scale

Smaller teams means more teams, so the transformation is decided by what links them. Four things are shared between sandwich teams:

- **Intent.** An organisation intent declines into team intents.
- **Cognition.** Memory and pattern detection are common, which replaces coordination by meetings.
- **Harness.** It becomes a platform maintained once, under the system orchestrator.
- **Ethics.** The ethical guardian is shared across teams.

This is where the gain is expected: coding alone may improve by 30 to 40%, but the team often gains under 10% if planning, testing and release stay manual ([Forrester, June 2026](https://forrester.com/blogs/agentic-software-development-takes-the-lead-from-code-assistants-to-orchestrated-sdlc-agents)).

What the plugin implements of this today: the organisation's intent, declared once in `.coda-org/` and delivered into the brief of every team's sessions, whether the teams share a repository or each have their own. Shared memory and patterns, the map of scopes, arbitration between teams, a guardian declared once and floors for the harness are not built yet.

## Position on people

At equal headcount: more teams and more scope.

- People freed by a split form new sandwich teams.
- The measure of success is the number of scopes carried, not headcount.
- Headcount reduction is never an objective of the framework.

The agents carry the same position: patterns and audits are about the system, never about a person; no agent compares individuals or derives a productivity measure from the journal.

## Open questions

- Final name: CODA is a working name; availability not checked.
- Four roles for two humans: which cumulations are allowed?
- Does the sovereign maker remain a human role when agents execute?
- The list of execution agents beyond development and testing.
- How long bounded autonomy must hold before a split.
- What becomes of middle management.
- The signal that makes a team grow again.
