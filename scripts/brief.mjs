// The cognitive brief: what every session and every execution agent starts from.
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

export function brief(root, cfg) {
  const lines = ['# CODA brief', ''];
  const humans = (cfg.team.humans || []).map((h) => `${h.name} (${(h.roles || []).join(', ') || 'no role'})`).join('; ');
  lines.push(`This project is run by a sandwich team${cfg.team.name ? ` — ${cfg.team.name}` : ''}: ${humans || 'humans not declared yet'}.`);
  lines.push('Humans hold the intent; cognitive agents (memory, pattern, simulation, coordination) turn it into steering; execution agents (builder, verifier) deliver. Agents propose, humans decide.');
  lines.push('', `**Autonomy level:** ${LEVEL_TEXT[cfg.autonomy.level]} Enforced by the harness, not by this text.`);
  if (cfg._error) lines.push(`**Config problem:** ${cfg._error} — falling back to "observed". Tell the human.`);

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
    '- Skills: /coda:intent, /coda:decide, /coda:recall, /coda:deliver, /coda:patterns, /coda:sync, /coda:audit, /coda:autonomy, /coda:status.');
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
      independentScope: { check: 'human', note: 'The product ships without daily dependence on another team.' },
      harnessInPlace: { check: 'auto', met: cfg.verify.commands.length > 0 && j.count > 0 && j.problems.length === 0, note: 'Verification commands configured, journal recording and intact.' },
      autonomyHeld: { check: 'auto', met: cfg.autonomy.level === 'bounded', since: cfg.autonomy.level === 'bounded' ? (cfg.autonomy.since || lastLevel?.ts || null) : null, note: 'Execution layer working in bounded autonomy; required duration is the team\'s call.' },
      guardianOutsideTeam: { check: 'auto', met: guardian.length > 0 && guardian.every((h) => h.external === true), note: 'The ethical guardian is declared with "external": true — nobody audits their own decisions.' },
    },
  };
}
