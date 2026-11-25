# Working on CODA

CODA is a plugin that makes a coding-agent harness enforce a team framework. Read `docs/harness-contract.md` before changing anything under `scripts/` or `hooks/`: every behaviour there backs a stated guarantee.

- `scripts/lib.mjs` — journal, config, globs, fingerprint. `scripts/hook.mjs` — the guard and the gates. `scripts/brief.mjs` — the brief and status facts. `scripts/graph.mjs` — the knowledge graph, derived from record frontmatter and never stored, for one team or across the teams of an organisation. `scripts/org.mjs` — the organisation several teams share (`.coda-org/`, in the same repository or in one of its own, mirrored read-only), the map of what each team carries and its overlaps. `scripts/coda.mjs` — the CLI.
- `skills/`, `agents/` — prompts. Skills keep to the portable frontmatter fields (`name`, `description`).
- No dependencies, Node 18+, ES modules. Keep it that way: the plugin must run with nothing to install.
- A team with no organisation must behave exactly as before the organisation existed; `tests/sandbox.mjs` builds three teams in one repository or in several for anything that crosses teams.
- Only declarations and records cross teams. No code path may read another team's journal, and nothing may rank teams or compare their activity.
- The organisation fails open like everything else: a team whose organisation cannot be read keeps working and says so. Only the guard may fail closed.
- `npm test` must pass. A change to the guard or a gate comes with a test that states the guarantee in its name.
- The guard fails closed (ask or deny); everything else fails open. A hook must never break a session in a project that has no `.coda/`.
- Nothing the model can call may write `session`, `run`, `tool`, `guard`, `verify`, `review` or `autonomy` events.
- Prompts describe the situation and the reasons; rules about people (no comparison of individuals, no productivity measures) are not to be softened.
- Validate with `npm run validate`; try it with `claude --plugin-dir .` in a scratch project.
