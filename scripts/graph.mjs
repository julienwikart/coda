// The knowledge graph. It is never stored: it is derived, on demand, from the
// frontmatter of the decision and pattern records, so it cannot drift from them.
import { listRecords, slugify, intentSummary } from './lib.mjs';

// Typed entities a record can name. People are deliberately absent: the graph
// maps what the team works on, never who did what.
export const ENTITY_TYPES = ['team', 'technology', 'tool', 'component', 'concept', 'process', 'metric', 'constraint', 'risk', 'opportunity'];

// Typed links from one decision to another.
export const LINK_TYPES = ['supersedes', 'depends-on', 'contradicts', 'related'];

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

export function parseEntity(raw) {
  const m = /^([a-z-]+)\s*:\s*(.+)$/i.exec(String(raw).trim());
  if (!m) return { error: `"${raw}" is not written as type:name` };
  const type = m[1].toLowerCase();
  if (type === 'person') return { error: `"${raw}": people are not entities — the graph maps what the team works on, not who did what` };
  if (!ENTITY_TYPES.includes(type)) return { error: `"${raw}": unknown entity type "${type}" (use ${ENTITY_TYPES.join(', ')})` };
  const name = slugify(m[2]);
  return { id: `${type}:${name}`, type, name };
}

export function buildGraph(root) {
  const decisions = listRecords(root, 'decisions');
  const patterns = listRecords(root, 'patterns');
  const nodes = []; const edges = []; const problems = []; const external = [];
  const entities = new Map();
  const ids = new Set([...decisions, ...patterns].map((r) => r.id));

  const mention = (record, kind) => {
    for (const raw of asList(record.meta.entities)) {
      const e = parseEntity(raw);
      if (e.error) { problems.push(`${record.file}: ${e.error}`); continue; }
      if (!entities.has(e.id)) entities.set(e.id, { ...e, decisions: [], patterns: [] });
      const bucket = entities.get(e.id)[kind];
      if (!bucket.includes(record.id)) { bucket.push(record.id); edges.push({ from: record.id, to: e.id, type: 'mentions' }); }
    }
  };

  const intent = intentSummary(root);
  if (intent?.purpose) nodes.push({ id: 'intent', kind: 'intent', title: 'Intent', status: intent.meta.status || '' });

  for (const d of decisions) {
    const status = String(d.meta.status || '').toLowerCase();
    nodes.push({ id: d.id, kind: 'decision', title: d.title.replace(new RegExp(`^${d.id}\\s+`), ''), status, type: d.meta.type || '', date: d.meta.date || '', file: d.file });
    mention(d, 'decisions');
    for (const link of LINK_TYPES) {
      for (const target of asList(d.meta[link])) {
        // team/D-0001 names another team's decision: it is resolved in the organisation's graph, not here.
        if (target.includes('/')) { external.push({ from: d.id, to: target, type: link }); continue; }
        if (target === d.id) problems.push(`${d.file}: ${link} points to itself`);
        else if (!ids.has(target)) problems.push(`${d.file}: ${link} names ${target}, which has no record`);
        // related and contradicts read the same in both directions: keep one edge per pair.
        else if (!(['related', 'contradicts'].includes(link) && edges.some((e) => e.type === link && e.from === target && e.to === d.id))) edges.push({ from: d.id, to: target, type: link });
      }
    }
    if (!asList(d.meta.entities).length) problems.push(`${d.file}: no entities — this decision is invisible in the graph`);
  }
  for (const p of patterns) {
    nodes.push({ id: p.id, kind: 'pattern', title: p.title.replace(new RegExp(`^${p.id}\\s+`), ''), status: String(p.meta.status || '').toLowerCase(), polarity: p.meta.polarity || '', file: p.file });
    mention(p, 'patterns');
    for (const target of asList(p.meta.decisions)) {
      if (!ids.has(target)) problems.push(`${p.file}: decisions names ${target}, which has no record`);
      else edges.push({ from: p.id, to: target, type: 'observed-in' });
    }
  }

  // A decision in force that contradicts another decision in force is an open contradiction.
  const inForce = (id) => { const n = nodes.find((x) => x.id === id); return n && !['superseded', 'cancelled', 'rejected'].includes(n.status); };
  const contradictions = edges.filter((e) => e.type === 'contradicts' && inForce(e.from) && inForce(e.to)).map((e) => ({ between: [e.from, e.to] }));
  const supersededStillInForce = edges.filter((e) => e.type === 'supersedes' && inForce(e.to)).map((e) => e.to);
  for (const id of supersededStillInForce) problems.push(`${id} is superseded by another decision but its status is still in force`);

  const entityList = [...entities.values()].sort((a, b) => b.decisions.length + b.patterns.length - (a.decisions.length + a.patterns.length) || a.id.localeCompare(b.id));
  for (const e of entityList) nodes.push({ id: e.id, kind: 'entity', type: e.type, title: e.name, decisions: e.decisions.length, patterns: e.patterns.length });

  // Same name under two types usually means the same thing was typed inconsistently.
  const byName = new Map();
  for (const e of entityList) byName.set(e.name, [...(byName.get(e.name) || []), e.id]);
  for (const [, same] of byName) if (same.length > 1) problems.push(`the same name appears under several types: ${same.join(', ')}`);

  return {
    nodes, edges, entities: entityList, external,
    // A constraint or a risk that three or more decisions run into is a candidate pattern.
    recurring: entityList.filter((e) => ['constraint', 'risk'].includes(e.type) && e.decisions.length >= 3).map((e) => ({ entity: e.id, decisions: e.decisions })),
    contradictions, problems,
  };
}

/** The part of the graph within one step of the nodes matching `query` (an id, an entity name or a type:name). */
export function neighbourhood(graph, query) {
  const q = String(query).toLowerCase();
  const seeds = graph.nodes.filter((n) => n.id.toLowerCase() === q || (n.kind === 'entity' && (n.title === slugify(q) || n.id === parseEntity(q).id))).map((n) => n.id);
  if (!seeds.length) return null;
  const keep = new Set(seeds);
  for (const e of graph.edges) { if (keep.has(e.from) && seeds.includes(e.from)) keep.add(e.to); if (seeds.includes(e.to)) keep.add(e.from); }
  // Second hop from a decision to the other decisions sharing its entities would explode; stop at one.
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { ...graph, nodes: graph.nodes.filter((n) => keep.has(n.id)), edges, entities: graph.entities.filter((e) => keep.has(e.id)), seeds };
}

const mid = (id) => id.replace(/[^A-Za-z0-9]/g, '_');
const label = (s, n = 60) => { const t = String(s).replace(/["`\[\]{}<>|]/g, "'"); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function toMermaid(graph) {
  const out = ['graph LR'];
  for (const n of graph.nodes) {
    if (n.kind === 'intent') out.push(`  ${mid(n.id)}{{"Intent"}}`);
    else if (n.kind === 'decision') out.push(`  ${mid(n.id)}["${n.id} ${label(n.title)}"]`);
    else if (n.kind === 'pattern') out.push(`  ${mid(n.id)}[/"${n.id} ${label(n.title)}"/]`);
    else out.push(`  ${mid(n.id)}(["${n.type}: ${label(n.title)}"])`);
  }
  for (const e of graph.edges) {
    if (e.type === 'mentions') out.push(`  ${mid(e.from)} --- ${mid(e.to)}`);
    else if (e.type === 'contradicts') out.push(`  ${mid(e.from)} -. contradicts .- ${mid(e.to)}`);
    else if (e.type === 'related') out.push(`  ${mid(e.from)} -- related --- ${mid(e.to)}`);
    else out.push(`  ${mid(e.from)} -- ${e.type} --> ${mid(e.to)}`);
  }
  const cls = (name, pick) => { const ids = graph.nodes.filter(pick).map((n) => mid(n.id)); if (ids.length) out.push(`  class ${ids.join(',')} ${name}`); };
  out.push('  classDef retired stroke-dasharray: 4 3,opacity:0.6', '  classDef entity fill:none');
  cls('retired', (n) => n.kind === 'decision' && ['superseded', 'cancelled', 'rejected'].includes(n.status));
  cls('entity', (n) => n.kind === 'entity');
  return out.join('\n');
}

export function toMarkdown(graph) {
  const lines = ['# Knowledge graph', '', '<!-- Generated by `coda graph --write` from the records in decisions/ and patterns/. Do not edit: change the records and regenerate. -->', '', '```mermaid', toMermaid(graph), '```', ''];
  if (graph.contradictions.length) lines.push('## Open contradictions', '', ...graph.contradictions.map((c) => `- ${c.between.join(' and ')} are both in force and contradict each other.`), '');
  if (graph.recurring.length) lines.push('## Recurring constraints and risks', '', ...graph.recurring.map((r) => `- \`${r.entity}\` — ${r.decisions.join(', ')}`), '');
  lines.push('## Entities', '', '| Entity | Decisions | Patterns |', '|---|---|---|', ...graph.entities.map((e) => `| \`${e.id}\` | ${e.decisions.join(', ') || '—'} | ${e.patterns.join(', ') || '—'} |`), '');
  return lines.join('\n');
}

// ------------------------------------------------------------ across teams

const RETIRED = ['superseded', 'cancelled', 'rejected'];
// Entities that say two decisions are about the same thing. A technology shared by everyone says nothing.
const BINDING = ['component', 'constraint', 'risk', 'process', 'metric'];

/**
 * The graph of a whole organisation: each team's graph, with ids qualified by
 * the team's name (catalog/D-0002), joined through the entities they share and
 * the links one team's decision declares to another's. Derived on demand from
 * whatever copy of each team is readable; never stored.
 */
export function buildOrgGraph(teams) {
  const nodes = []; const edges = []; const problems = []; const entities = new Map();
  const q = (team, id) => `${team}/${id}`;
  const pending = [];
  for (const t of teams) {
    if (!t.dir) { problems.push(`team "${t.name}" could not be read${t.note ? `: ${t.note}` : ''}`); continue; }
    let g; try { g = buildGraph(t.dir); } catch (e) { problems.push(`team "${t.name}": ${e.message}`); continue; }
    for (const n of g.nodes) {
      if (n.kind === 'intent') continue;
      if (n.kind === 'entity') {
        if (!entities.has(n.id)) entities.set(n.id, { id: n.id, type: n.type, name: n.title, decisions: [], patterns: [], teams: [] });
        continue;
      }
      nodes.push({ ...n, id: q(t.name, n.id), team: t.name, file: n.file ? `${t.dir}/${n.file}` : undefined });
    }
    for (const e of g.entities) {
      const ent = entities.get(e.id);
      ent.decisions.push(...e.decisions.map((id) => q(t.name, id)));
      ent.patterns.push(...e.patterns.map((id) => q(t.name, id)));
      if (!ent.teams.includes(t.name)) ent.teams.push(t.name);
    }
    for (const e of g.edges) edges.push({ from: q(t.name, e.from), to: e.type === 'mentions' ? e.to : q(t.name, e.to), type: e.type });
    for (const x of g.external) pending.push({ from: q(t.name, x.from), to: x.to, type: x.type });
    for (const p of g.problems) problems.push(`${t.name}: ${p}`);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const x of pending) {
    if (!byId.has(x.to)) { problems.push(`${x.from}: ${x.type} names ${x.to}, which no readable team holds`); continue; }
    if (['related', 'contradicts'].includes(x.type) && edges.some((e) => e.type === x.type && e.from === x.to && e.to === x.from)) continue;
    edges.push(x);
  }
  const inForce = (id) => { const n = byId.get(id); return n && n.kind === 'decision' && !RETIRED.includes(n.status); };
  const entityList = [...entities.values()].sort((a, b) => b.teams.length - a.teams.length || b.decisions.length - a.decisions.length || a.id.localeCompare(b.id));
  for (const e of entityList) nodes.push({ id: e.id, kind: 'entity', type: e.type, title: e.name, decisions: e.decisions.length, patterns: e.patterns.length, teams: e.teams });
  const contradictions = edges.filter((e) => e.type === 'contradicts' && inForce(e.from) && inForce(e.to))
    .map((e) => ({ between: [e.from, e.to], teams: [byId.get(e.from).team, byId.get(e.to).team] }));
  return {
    nodes, edges, entities: entityList, problems,
    contradictions,
    betweenTeams: contradictions.filter((c) => c.teams[0] !== c.teams[1]),
    // The same constraint or risk met by decisions in force, three times or more, in more than one team.
    recurring: entityList.filter((e) => ['constraint', 'risk'].includes(e.type) && e.teams.length > 1 && e.decisions.filter(inForce).length >= 3)
      .map((e) => ({ entity: e.id, teams: e.teams, decisions: e.decisions.filter(inForce) })),
    // What more than one team has decided about: where a collision would happen.
    shared: entityList.filter((e) => BINDING.includes(e.type) && e.teams.length > 1).map((e) => ({ entity: e.id, teams: e.teams, decisions: e.decisions.filter(inForce) })),
  };
}

/**
 * Decisions in force in other teams that bear on this team: they are about
 * something this team declares it carries, or about a component, constraint or
 * risk this team has also decided on. This is what lets an agent see a
 * collision before any work starts.
 */
export function bearingOn(orgGraph, team, scope = { domains: [], components: [] }) {
  const carried = new Set([...(scope.domains || []), ...(scope.components || [])]);
  const mine = new Set(orgGraph.entities.filter((e) => BINDING.includes(e.type) && e.teams.includes(team)).map((e) => e.id));
  const out = new Map();
  for (const edge of orgGraph.edges) {
    if (edge.type !== 'mentions' || edge.from.startsWith(`${team}/`)) continue;
    const n = orgGraph.nodes.find((x) => x.id === edge.from);
    if (!n || n.kind !== 'decision' || RETIRED.includes(n.status)) continue;
    const ent = orgGraph.entities.find((e) => e.id === edge.to);
    const why = carried.has(ent.name) ? `is about ${ent.type} "${ent.name}", which this team carries` : mine.has(ent.id) ? `is about ${ent.type} "${ent.name}", which this team has also decided on` : null;
    if (!why) continue;
    const cur = out.get(n.id);
    if (!cur || (why.includes('carries') && !cur.why.includes('carries'))) out.set(n.id, { id: n.id, team: n.team, title: n.title, date: n.date, file: n.file, why, carried: why.includes('carries') });
  }
  return [...out.values()].sort((a, b) => Number(b.carried) - Number(a.carried) || String(b.date).localeCompare(String(a.date)));
}
