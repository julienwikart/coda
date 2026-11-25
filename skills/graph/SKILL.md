---
name: graph
description: Explore or maintain the team's knowledge graph — which decisions touch a given technology, component, constraint or risk, how decisions depend on, contradict or supersede each other, and which constraints keep coming back. Use when the user asks "what touches…", "what depends on…", "show the graph", wants to see how decisions connect, or when records lack entities and links.
---

# Knowledge graph

The graph connects the team's decisions and patterns through what they are about (typed entities) and through how they relate to each other (typed links). It is not stored anywhere: it is derived, each time, from the frontmatter of the records in `.coda/decisions/` and `.coda/patterns/`. To change the graph, change a record.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

```yaml
entities: [technology:postgres, component:billing-api, constraint:integer-cents, risk:rounding]
depends-on: [D-0003]
contradicts: []
related: [D-0005]
supersedes: D-0001
```

Entity types: `team`, `technology`, `tool`, `component`, `concept`, `process`, `metric`, `constraint`, `risk`, `opportunity`. There is no `person` type, on purpose: the graph maps what the team works on, never who did what. Pattern records take `entities` and `decisions: [D-…]` (the decisions the pattern was observed in).

## Answer a question

- "What touches X?" — `coda graph --around <entity or record id> --format mermaid` gives the neighbourhood; read the records it names before answering. `coda graph --format entities` lists every entity with its decisions.
- "How do these decisions relate?" — `coda graph --around D-0007`.
- "What keeps coming back?" — the `recurring` list in `coda graph`: constraints and risks that three or more decisions ran into. Each is a candidate for `/coda:patterns`.
- "Is the memory consistent?" — `coda graph --check` reports links to records that do not exist, decisions with no entities, the same name used under two types, and open contradictions: two decisions that contradict each other and are both in force. An open contradiction is for the humans to resolve with `/coda:decide`; do not resolve it by editing a record.

Show a Mermaid diagram when the neighbourhood is small enough to read (roughly twenty nodes); otherwise answer in prose with the record ids.

## Across teams

When the team belongs to an organisation, `coda graph --org` derives the same graph over every team, with records named `team/D-0001`: `--around <entity>` shows what several teams decided about one thing, `--check` reports contradictions between decisions in force in different teams, links to records no readable team holds, and constraints or risks that recur across teams. A link may name another team's decision (`related: [catalog/D-0002]`, `contradicts: [catalog/D-0001]`). A contradiction between teams is never settled by editing a record; it goes to the humans of both.

## Maintain it

When `--check` reports decisions without entities, propose entities and links for each from the text of the record, reusing the names already in `coda graph --format entities` so that the same thing is not named twice. Show the proposal to the human and write only what they confirm: an entity or a link is a claim about what a decision means, and the decision is theirs. Add only the frontmatter lines; do not touch the body of a past decision.

`coda graph --write` regenerates `.coda/graph.md`, a rendered view for people browsing the repository. It is generated; never edit it by hand.
