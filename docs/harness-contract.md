# The harness contract

CODA does not provide a harness. It states what a harness must guarantee before a team of two can delegate to agents, and ships one adapter — for Claude Code — that makes those guarantees real. Any other harness that meets the contract can run a CODA team: the state is plain files, and the logic is a dependency-free Node CLI.

"Guarantee" has a precise meaning here: the property holds even if the model ignores, forgets or is talked out of its instructions. A rule that lives only in a prompt is guidance, not a guarantee.

## The five guarantees

**G1 — Context and memory.** Before an agent acts in the project, it has received the team's brief: the intent's purpose, its non-negotiable constraints, what is out of scope, the decisions in force, the open patterns and the current autonomy level.
When the team belongs to an organisation, the brief also carries the organisation's purpose, its non-negotiable constraints and what it puts out of scope, read from the organisation itself: no human copies them into each team.
*Adapter:* a session-start hook injects the output of `coda brief`. An organisation in the same repository is read from disk. One in a repository of its own is read from a local read-only copy that the hook refreshes at session start with a time-boxed fetch; the brief states the date of the copy, and says so when the organisation could not be read at all.

**G2 — Guardrails by permission.** What an agent may write or run is decided outside the model, from `.coda/config.json`:

| | `observed` | `supervised` | `bounded` |
|---|---|---|---|
| Write inside the perimeter | deny | ask a human | allow |
| Write elsewhere in the project | deny | ask | ask |
| Write to a protected path | deny | deny | deny |
| Command that acts on the project | deny | ask | harness default; `askCommands` ask |
| Command in `denyCommands` | deny | deny | deny |
| Edit the journal | deny | deny | deny |
| Edit `.coda/config.json`, change level | ask | ask | ask |
| Edit anything under `.coda-org/` | ask | ask | ask |
| Edit the organisation's journal, or the local copy of a remote organisation | deny | deny | deny |

At every level, cognitive agents cannot write outside `.coda/` or run commands that act on the project. An unreadable or invalid configuration falls back to `observed`: a broken config never widens permissions.
*Adapter:* a pre-tool-use hook on file-writing tools and the shell returns allow, ask or deny.

**G3 — Verification loops.** An agent's turn cannot be accepted while the deliverable state of the working tree has changed and the team's verification commands have not passed on that exact state. When review is required, the same holds until an independent verifier, with no write access, has passed that exact state. The result is recorded by the harness; the model cannot record it.
*Adapter:* a stop hook fingerprints the tree, runs `verify.commands`, and blocks the stop with the failing output. After `verify.maxBlocks` consecutive failures it lets the session end and journals `verify.unresolved` so that a human sees it. A subagent-stop hook reads the verifier's `CODA-VERDICT` line.

**G4 — Orchestration by floors.** Cognitive agents produce plans and briefs; execution agents receive a brief and deliver; a builder cannot be its own verifier.
*Adapter:* agent definitions with restricted tools, plus G2 keyed on the agent's identity. The sequencing itself (`/coda:deliver`) is a skill, so it is guidance; what is guaranteed is what each floor *cannot* do.

**G5 — Observability.** Every session, agent run, write, acting command, guard decision and verification result is appended to `.coda/journal/`. Events are never edited. Each stream is hash-chained, so an edit or deletion is detectable (`coda journal verify`). Events of the families `session`, `run`, `tool`, `guard`, `verify`, `review` and `autonomy` can only be written by the harness. `decision.recorded` and `pattern.reviewed` are refused unless the record they name exists.
*Adapter:* post-tool-use, subagent and session hooks; the guard denies any other write to the journal.

## What the adapter does not guarantee

Stated plainly, so nobody delegates on a false assumption:

- **A remote organisation is as fresh as its last fetch.** Offline, or when its repository cannot be reached, the last copy serves; a team that has never fetched it starts its session without the organisation's constraints, and the brief says exactly that. Nothing here blocks work: only the guard fails closed.
- **In a repository holding several teams, the harness follows the directory the session starts in.** Start it in the team's directory; from the repository root no team is found and nothing is enforced.
- **Shell commands are not sandboxed.** The guard reads the command text. At `bounded`, a command that is not in `askCommands` or `denyCommands` follows your harness's own permission rules, and a shell command can write anywhere the process can. The perimeter is exact for file-editing tools and best-effort for the shell. Use your harness's sandbox for a hard boundary.
- **The journal is tamper-evident, not tamper-proof.** Someone with write access to the repository can rewrite a whole stream. Protect it the way you protect history: review, branch protection.
- **Human attribution is declared, not authenticated.** `--by <name>` and `human:<name>` actors record who the session says decided. The harness's own approval prompt is the actual control.
- **Secrets are redacted from journaled commands by pattern.** Set `journal.commands` to `"off"` if that is not enough for your context.
- **If Node is missing, hooks do not run** and nothing is enforced. `coda doctor` checks that hooks have fired.

## Journal format

One JSON object per line, in `.coda/journal/<YYYY-MM>/<session>.jsonl`:

```json
{"v":1,"ts":"2026-11-19T13:36:46.101Z","seq":3,"type":"guard.denied","actor":"agent:builder","session":"c38d5469-60a","data":{"tool":"Write","target":".env","level":"bounded","reason":"…"},"prev":"7919e90dff782d82"}
```

`prev` is the first 16 hex characters of the SHA-256 of the previous line in the same stream. One stream per session means teammates never produce merge conflicts. Events written from the command line join the stream of the session that issued them; from a plain terminal they go to a per-user, per-day `cli-…` stream.

| Family | Events | Written by |
|---|---|---|
| `session` | `start`, `end` | harness |
| `run` | `start`, `end` (agent runs) | harness |
| `tool` | `write`, `command` | harness |
| `guard` | `denied`, `asked` | harness |
| `verify` | `passed`, `failed`, `unresolved` | harness |
| `review` | `passed`, `failed` | harness |
| `autonomy` | `changed` | harness, on a human's decision |
| `org` | `initialized`, `team-added`, `joined` | harness, on a human's decision |
| `decision`, `intent`, `pattern`, `memory`, `audit`, `delivery` | `recorded`, `updated`, `sync`, `reviewed`, `recall`, `completed` | skills, via `coda journal add` |

## Adapting another harness

The skills are standard `SKILL.md` files and the agents are Markdown prompts; most agent tools can load them. Loaded alone they are guidance. To meet the contract, wire your harness's extension points to the CLI (`scripts/coda.mjs`) and the hook entry point (`scripts/hook.mjs`, which reads one JSON event on stdin):

| Guarantee | Your harness must be able to | Call |
|---|---|---|
| G1 | inject text at session start | `coda brief` |
| G2 | intercept a tool call before it runs and deny or ask | `hook.mjs` with `{"hook_event_name":"PreToolUse","cwd","session_id","agent_type","tool_name","tool_input"}` — it answers with `permissionDecision` |
| G3 | refuse to end a turn | `hook.mjs` with `{"hook_event_name":"Stop",…}` — it answers `{"decision":"block","reason"}` |
| G4 | restrict tools per agent and tell the hook which agent is acting | `agent_type` in the event |
| G5 | call out after tool calls and agent runs | `hook.mjs` with `PostToolUse`, `SubagentStart`, `SubagentStop`, `SessionStart`, `SessionEnd` |

A harness that cannot intercept tool calls cannot meet G2, and a team on it should stay at `supervised` using the tool's own approval prompts. Adapters for other harnesses are welcome as contributions; none ships in 0.1.
