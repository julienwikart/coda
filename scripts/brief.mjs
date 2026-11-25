// The cognitive brief: what every session and every execution agent starts from.
import { buildGraph, buildOrgGraph, bearingOn } from './graph.mjs';
import { resolveOrg, orgFacts, teamsOf, overlaps, scopeProblems, ORG_DIR } from './org.mjs';
import { intentSummary, listRecords, readEvents, loadVerified, fingerprint, verifyJournal, LEVELS } from './lib.mjs';

export const LEVEL_TEXT = {
  observed: 'observed — agents read and propose; humans make every change.',
  supervised: 'supervised execution — agents act, a human approves each change and each command.',
  bounded: 'bounded autonomy — agents act freely inside the delegated perimeter; anything outside it asks a human.',
};

const clip = (s, n) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

export function activeDecisions(root) {
  return listRecords(root, 'decisions').filter((d) => !['superseded', 'cancelled', 'rejected'].includes(String(d.meta.status || '').toLowerCase()));
}

export function openPatterns(root) {
  return listRecords(root, 'patterns').filter((p) => ['detected', 'open', 'experimenting'].includes(String(p.meta.status || 'detected').toLowerCase()));
}

const scopeLine = (s) => [s.domains.length ? `domains: ${s.domains.join(', ')}` : '', s.components.length ? `components: ${s.components.join(', ')}` : ''].filter(Boolean).join(' · ') || 'nothing declared yet';

/** Who carries what. This is how an agent knows a request reaches into another team's scope before touching it. */
function mapSection(o, self) {
  let teams; try { teams = teamsOf(o, self); } catch { return []; }
  if (!teams.length) return [];
  const lines = ['', '**Who carries what**'];
  for (const t of teams) lines.push(`- ${t.name}${t.isSelf ? ' (this team)' : ''} — ${t.readable ? scopeLine(t.scope) : `not readable: ${t.note}`}`);
  const mine = overlaps(teams).filter((v) => !self.selfName || v.teams.includes(self.selfName));
  for (const v of mine) lines.push(`- Open overlap: ${v.teams.join(' and ')} both declare the ${v.kind} "${v.what}". Two teams answering for the same thing is for the humans to settle; say so before working on it.`);
  if (self.selfName) lines.push('A request that reaches into what another team carries is not this team\'s to deliver: say which team, and stop there until the humans have agreed how to proceed.');
  lines.push(...crossTeam(teams, self.selfName));
  if (self.selfName && teams.some((t) => t.root && !t.isSelf)) lines.push('The other teams share this repository: the harness refuses any write in their directories, at every autonomy level.');
  return lines;
}

/** What other teams have decided that bears on this one, and contradictions between teams. Fails open. */
function crossTeam(teams, selfName) {
  let g; try { g = buildOrgGraph(teams); } catch { return []; }
  const lines = [];
  const me = teams.find((t) => t.isSelf);
  if (selfName && me) {
    const bearing = bearingOn(g, selfName, me.scope);
    if (bearing.length) {
      lines.push('', '**Decisions in force in other teams that bear on this one** (read the record before working near it; `coda org decisions` lists them all)');
      for (const d of bearing.slice(0, 6)) lines.push(`- ${d.id} ${clip(d.title, 90)} — ${d.why}`);
      if (bearing.length > 6) lines.push(`- …and ${bearing.length - 6} more.`);
    }
  }
  for (const c of g.betweenTeams.filter((x) => !selfName || x.teams.includes(selfName)))
    lines.push(`- Open contradiction between teams: ${c.between.join(' and ')} are both in force. It is for the humans to settle, not for either team to work around.`);
  return lines;
}

/** The brief of a session started at the organisation's root, in no team's directory. */
export function orgBrief(o) {
  const lines = ['# CODA brief — organisation', ''];
  if (o.error) return [...lines, `This directory holds an organisation, but ${o.error}. Tell the human.`].join('\n');
  lines.push(`This session started at the root of ${o.name}, not in a team's directory. Each team has its own intent, autonomy level and verification; here, a change to a file is judged by the rules of the team whose directory holds it, changes to files no team carries ask a human, and commands that act on the repository ask a human. To deliver for a team, start the session in that team's directory.`);
  const i = o.intent;
  if (i?.purpose) {
    lines.push('', `## Organisation — ${o.name}`, clip(i.purpose, 500));
    if (i.constraints) lines.push('', '**Non-negotiable constraints of the organisation**', clip(i.constraints, 900));
    if (i.outOfScope) lines.push('', '**Out of scope for the whole organisation**', clip(i.outOfScope, 400));
  } else lines.push('', `The organisation has not written its intent yet (${ORG_DIR}/intent.md).`);
  lines.push(...mapSection(o, {}));
  let teams = []; try { teams = teamsOf(o); } catch { /* fail open */ }
  for (const p of scopeProblems(teams)) lines.push(`- ${p}`);
  lines.push('', 'Agents propose, humans decide. Skills: /coda:org, /coda:status.');
  return lines.join('\n');
}

/** What the organisation contributes to every team's brief. Reads only; never fetches unless asked to. */
function orgSection(root, cfg, opts) {
  let o;
  try { o = resolveOrg(root, cfg, opts); } catch (e) { o = { declared: true, error: e.message }; }
  if (!o) return [];
  if (o.error) return ['', '## Organisation', `This team declares an organisation, but ${o.error}. Its intent and constraints are missing from this brief — tell the human before delivering anything that could touch them.`];
  const lines = ['', `## Organisation — ${o.name}`];
  const i = o.intent;
  if (i?.purpose) {
    lines.push(clip(i.purpose, 500));
    if (i.constraints) lines.push('', '**Non-negotiable constraints of the organisation** (they bind every team; a team may add to them, never relax them)', clip(i.constraints, 900));
    if (i.outOfScope) lines.push('', '**Out of scope for the whole organisation**', clip(i.outOfScope, 400));
  } else lines.push(`The organisation has not written its intent yet (${ORG_DIR}/intent.md).`);
  if (o.source === 'remote') lines.push('', `_Read from ${o.location}, as of ${o.fetchedAt ? new Date(o.fetchedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'an unknown date'}${o.fetchError ? ` — the last refresh ${o.fetchError}, so this may be out of date` : ''}._`);
  if (!o.team) lines.push('', `_This team ("${cfg.team.name || 'unnamed'}") is not in the organisation's list of teams yet._`);
  lines.push(...mapSection(o, { selfRoot: root, selfName: cfg.team.name, ...opts }));
  return lines;
}

export function brief(root, cfg, opts = { refresh: 'never' }) {
  const lines = ['# CODA brief', ''];
  const humans = (cfg.team.humans || []).map((h) => `${h.name} (${(h.roles || []).join(', ') || 'no role'})`).join('; ');
  lines.push(`This project is run by a sandwich team${cfg.team.name ? ` — ${cfg.team.name}` : ''}: ${humans || 'humans not declared yet'}.`);
  lines.push('Humans hold the intent; cognitive agents (memory, pattern, simulation, coordination) turn it into steering; execution agents (builder, verifier) deliver. Agents propose, humans decide.');
  lines.push('', `**Autonomy level:** ${LEVEL_TEXT[cfg.autonomy.level]} Enforced by the harness, not by this text.`);
  if (cfg._error) lines.push(`**Config problem:** ${cfg._error} — falling back to "observed". Tell the human.`);

  lines.push(...orgSection(root, cfg, opts));

  const intent = intentSummary(root);
  if (intent && intent.purpose) {
    lines.push('', '## Intent', clip(intent.purpose, 600));
    if (intent.constraints) lines.push('', '**Non-negotiable constraints**', clip(intent.constraints, 900));
    if (intent.outOfScope) lines.push('', '**Out of scope**', clip(intent.outOfScope, 500));
  } else lines.push('', '## Intent', 'No intent written yet. Nothing should be delivered before `/coda:intent` has been run with a human.');

  const decisions = activeDecisions(root).slice(-8).reverse();
  if (decisions.length) {
    lines.push('', '## Decisions in force (latest first — full text in .coda/decisions/)');
    for (const d of decisions) lines.push(`- ${d.id} ${clip(d.title, 110)}${d.meta.date ? ` (${d.meta.date})` : ''}`);
  }
  const patterns = openPatterns(root).slice(-5);
  if (patterns.length) {
    lines.push('', '## Open patterns (.coda/patterns/)');
    for (const p of patterns) lines.push(`- ${p.id} [${p.meta.polarity || 'negative'}] ${clip(p.title, 110)}`);
  }
  lines.push('', '## Working rules',
    '- Before a choice that is hard to reverse, check the decisions above; if it contradicts one, say so and run `/coda:decide` rather than deciding silently.',
    '- A decision is only made by a human. Record it with `/coda:decide`; do not write decision records on your own initiative.',
    `- Verification is ${cfg.verify.commands.length ? `enforced when you finish: ${cfg.verify.commands.map((c) => `\`${c}\``).join(', ')}` : 'not configured yet (`/coda:init` sets it)'}.`,
    '- Skills: /coda:intent, /coda:decide, /coda:recall, /coda:graph, /coda:deliver, /coda:patterns, /coda:sync, /coda:audit, /coda:autonomy, /coda:status, /coda:org.');
  return lines.join('\n');
}

/** Facts for /coda:status and /coda:autonomy. Counts only, no judgement. */
export function status(root, cfg) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const events = readEvents(root, { since });
  const count = (t) => events.filter((e) => e.type === t).length;
  const j = verifyJournal(root);
  const fp = fingerprint(root);
  const verified = loadVerified(root);
  const levelEvents = readEvents(root, { types: ['autonomy'] });
  const lastLevel = levelEvents[levelEvents.length - 1];
  const humans = cfg.team.humans || [];
  const guardian = humans.filter((h) => (h.roles || []).includes('ethical-guardian'));
  return {
    team: cfg.team,
    autonomy: { level: cfg.autonomy.level, levels: LEVELS, since: cfg.autonomy.since || lastLevel?.ts || null, perimeter: cfg.autonomy.perimeter },
    intent: Boolean(intentSummary(root)?.purpose),
    decisions: { total: listRecords(root, 'decisions').length, inForce: activeDecisions(root).length },
    patterns: { total: listRecords(root, 'patterns').length, open: openPatterns(root).length },
    organisation: (() => {
      try {
        const facts = orgFacts(root, cfg, { refresh: 'never' });
        if (!facts?.readable) return facts;
        const o = resolveOrg(root, cfg, { refresh: 'never' });
        const teams = teamsOf(o, { selfRoot: root, selfName: cfg.team.name });
        const g = buildOrgGraph(teams);
        const me = teams.find((t) => t.isSelf);
        return { ...facts, acrossTeams: { bearingOnThisTeam: me ? bearingOn(g, cfg.team.name, me.scope).map(({ id, title, why }) => ({ id, title, why })) : [], contradictions: g.betweenTeams, recurring: g.recurring } };
      } catch (e) { return { declared: true, readable: false, error: e.message }; }
    })(),
    graph: (() => { const g = buildGraph(root); return { entities: g.entities.length, links: g.edges.filter((e) => e.type !== 'mentions').length, openContradictions: g.contradictions, recurring: g.recurring, problems: g.problems.length }; })(),
    verification: { commands: cfg.verify.commands, requireReview: cfg.verify.requireReview, currentTreeVerified: fp !== null && verified.fp === fp, currentTreeReviewed: fp !== null && verified.reviewFp === fp },
    journal: { events: j.count, streams: j.files, intact: j.problems.length === 0, problems: j.problems.slice(0, 5) },
    last30Days: {
      sessions: count('session.start'), runs: count('run.start'), writes: count('tool.write'), commands: count('tool.command'),
      verifyPassed: count('verify.passed'), verifyFailed: count('verify.failed'), verifyUnresolved: count('verify.unresolved'),
      reviewPassed: count('review.passed'), reviewFailed: count('review.failed'),
      guardDenied: count('guard.denied'), guardAsked: count('guard.asked'),
      decisionsRecorded: count('decision.recorded'), recalls: count('memory.recall'),
    },
    entryConditions: {
      seniority: { check: 'human', note: 'Each human can judge an agent output alone in their domain. Only the team can assert this.' },
      independentScope: (() => {
        const human = { check: 'human', note: 'The product ships without daily dependence on another team.' };
        try {
          const o = orgFacts(root, cfg, { refresh: 'never' });
          if (!o?.readable) return human;
          const me = o.map.find((t) => t.isSelf);
          const declared = Boolean(me && (me.scope.domains.length || me.scope.components.length));
          const clash = o.overlaps.filter((v) => v.teams.includes(cfg.team.name));
          return { check: 'partly', met: declared && clash.length === 0 ? null : false, declared, overlaps: clash, note: 'The scope is declared and no other team claims the same thing — read from the organisation\'s map. Whether the product ships without daily dependence on another team is still the humans\' to assert.' };
        } catch { return human; }
      })(),
      harnessInPlace: { check: 'auto', met: cfg.verify.commands.length > 0 && j.count > 0 && j.problems.length === 0, note: 'Verification commands configured, journal recording and intact.' },
      autonomyHeld: { check: 'auto', met: cfg.autonomy.level === 'bounded', since: cfg.autonomy.level === 'bounded' ? (cfg.autonomy.since || lastLevel?.ts || null) : null, note: 'Execution layer working in bounded autonomy; required duration is the team\'s call.' },
      guardianOutsideTeam: { check: 'auto', met: guardian.length > 0 && guardian.every((h) => h.external === true), note: 'The ethical guardian is declared with "external": true — nobody audits their own decisions.' },
    },
  };
}
