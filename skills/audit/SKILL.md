---
name: audit
description: Prepare the ethical guardian's audit — how decisions were made over a period, signs of bias in the decision process, respect of the human veto and of agents' limits. Use monthly, or when the ethical guardian or the user asks for an ethics, bias or governance audit.
---

# Ethical audit

The ethical guardian audits how the team and its agents decide. You prepare the evidence; the guardian judges. The guardian should not be a member of the team being audited — if `coda status` shows `guardianOutsideTeam` unmet, put that at the top of the report.

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

Collect, over the period (30 days unless told otherwise): every decision record of the period, read in full; `coda status`; and from the journal (`coda journal query --since 30d`) the guard events, verification results, autonomy changes and `coda journal verify`.

Report against what the framework holds as non-negotiable:

1. **Transparency.** Decisions without context, without the options considered, or strategic ones taken without simulation. Simulations whose assumptions were not recorded.
2. **Human veto and human decision.** Every decision has a named human maker. Any record that reads as decided by an agent is a violation. Autonomy changes all carry a human and a reason.
3. **Agents inside their limits.** `guard.denied` events: what agents tried that they were not allowed to, and whether the same attempt repeats. `verify.unresolved`: deliveries that ended without passing verification — each needs a human explanation.
4. **Integrity of the record.** Whether the journal chain is intact. A broken chain means events were edited or removed; say which stream.
5. **Signs of bias in the decision process** — signals to examine, not verdicts, and only meaningful from about ten decisions:
   - one decision type dominating (for example, over 70% operational: strategic questions may be going undecided, or decided implicitly);
   - no decision ever vetoed, superseded or challenged (possible lack of challenge), or a high share cancelled (possibly an unclear intent);
   - decisions clustering on one maker beyond what the roles explain. In a team of two this is usually just the structure — say so rather than raising an alarm;
   - simulations whose recommendation is always followed, or never.
6. **People.** Any record, pattern or journal entry that contains sensitive personal data, compares individuals, or reads as monitoring of a person. These must be removed from the memory by a human; flag them without repeating their content.

For each point: what the evidence shows, with ids; whether it is fine, a warning or a violation; and a recommendation. No overall score. Write the report to `.coda/audits/<YYYY-MM-DD>.md`, opening with a frontmatter that a guardian following several teams can read at a glance — `date`, `period`, `violations` (count), `warnings` (count), `guardian` (name) — and record it: `coda journal add audit.completed --data '{"period": "30d", "violations": <n>, "warnings": <n>}'`.

## A guardian shared by several teams

When the organisation declares the guardian, one person follows several teams. Their view across teams comes from `coda org audit`: each team's latest audit (date, counts, where to read it), what each team's decision records show (no maker, no entities, strategic decisions taken without simulation), what is open between teams, and whether the organisation's own decisions were taken by the human its rule names. It reads each team's audits and records; a team's journal is audited inside that team, by the audit above, and never leaves it.

Report team by team, in the order the organisation lists them. Say which teams have no audit yet, or an old one. Do not rank the teams, score them, or set one against another: the audit is of the system each team works in, and two teams' counts are not comparable. Write the report to `.coda-org/audits/<YYYY-MM-DD>.md`, in the organisation's repository.

The guardian's conclusions and any veto are theirs to write; add them to the report in their words, under their name.
