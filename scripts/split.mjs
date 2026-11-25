// Splitting a team into several sandwich teams. Each new team receives its
// scope, a draft of its intent, and the decisions in force that concern it;
// the split is traced in every journal involved. Nothing here decides who
// goes where: people are assigned by the humans, afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { codaPath, listRecords, parseFrontmatter, slugify, CODA_DIR } from './lib.mjs';
import { parseEntity, LINK_TYPES } from './graph.mjs';

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
const RETIRED = ['superseded', 'cancelled', 'rejected'];

/** "name=dir:domain,component,…" — a new team, where it lives, and what it will carry. */
export function parseInto(spec) {
  const m = /^([^=]+)=([^:]+):(.+)$/.exec(String(spec));
  if (!m) return { error: `"${spec}": expected "<team>=<directory>:<what it carries, comma-separated>"` };
  const carries = [...new Set(m[3].split(',').map((x) => slugify(x)).filter((x) => x && x !== 'untitled'))];
  if (!carries.length) return { error: `"${spec}": a new team has to carry something` };
  return { name: m[1].trim(), dir: m[2].trim(), carries };
}

/**
 * Which decisions each new team inherits. A decision goes to the teams whose
 * scope it names; one that names none of them concerns everyone and goes to
 * all. Whatever a decision links to follows it, so no team inherits a record
 * with a dangling reference. `overrides` is the humans' correction.
 */
export function planSplit(root, intos, overrides = {}) {
  const decisions = listRecords(root, 'decisions');
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const plan = Object.fromEntries(intos.map((t) => [t.name, new Set()]));
  const why = {};
  for (const d of decisions) {
    if (RETIRED.includes(String(d.meta.status || '').toLowerCase())) continue;
    const named = new Set(asList(d.meta.entities).map((e) => parseEntity(e)).filter((e) => !e.error).map((e) => e.name));
    let to = intos.filter((t) => t.carries.some((c) => named.has(c))).map((t) => t.name);
    let reason = to.length ? `names ${intos.filter((t) => to.includes(t.name)).flatMap((t) => t.carries.filter((c) => named.has(c))).join(', ')}` : 'names none of the new scopes, so it concerns every new team';
    if (!to.length) to = intos.map((t) => t.name);
    if (overrides[d.id]) { to = overrides[d.id].filter((n) => plan[n]); reason = 'assigned by a human'; }
    why[d.id] = reason;
    for (const n of to) plan[n].add(d.id);
  }
  // Follow links, so that what a team inherits is complete.
  for (const name of Object.keys(plan)) {
    const queue = [...plan[name]];
    while (queue.length) {
      const d = byId.get(queue.pop());
      if (!d) continue;
      for (const link of LINK_TYPES) for (const target of asList(d.meta[link])) {
        if (target.includes('/') || !byId.has(target) || plan[name].has(target)) continue;
        plan[name].add(target); queue.push(target);
        why[target] = why[target] || `linked from ${d.id}`;
      }
    }
  }
  return { teams: Object.fromEntries(Object.entries(plan).map(([n, s]) => [n, [...s].sort()])), why, patterns: listRecords(root, 'patterns').filter((p) => ['detected', 'open', 'experimenting'].includes(String(p.meta.status || 'detected').toLowerCase())).map((p) => p.id) };
}

function inherit(text, source, id) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return text;
  return text.replace(m[0], `---\n${m[1].replace(/^inherited-from:.*\n?/m, '').trimEnd()}\ninherited-from: ${source}/${id}\n---`);
}

/** Write one new team: its configuration, a draft intent, and the records it inherits. */
export function createTeam(sourceRoot, sourceCfg, target, into, plan, when) {
  const from = (kind, id) => listRecords(sourceRoot, kind).find((r) => r.id === id);
  for (const d of ['decisions', 'patterns', 'audits', 'journal']) fs.mkdirSync(codaPath(target, d), { recursive: true });
  const { _error, _floors, ...clean } = sourceCfg;
  const cfg = {
    ...clean,
    team: { name: into.name, humans: [], splitFrom: sourceCfg.team.name },
    // The harness that earned the source team its level comes with the split; the level is inherited, not raised.
    autonomy: { ...clean.autonomy, since: when },
    scope: { domains: into.carries, components: [], paths: ['**'] },
    // The new team belongs to the same organisation as the one it comes from.
    org: sourceCfg.org?.repo ? sourceCfg.org : sourceCfg.org?.path ? { path: path.relative(target, path.resolve(sourceRoot, String(sourceCfg.org.path))) || '.' } : null,
  };
  fs.writeFileSync(codaPath(target, 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(codaPath(target, '.gitignore'), '.state/\n*.lock\n');
  for (const d of ['decisions', 'patterns', 'audits']) fs.writeFileSync(codaPath(target, d, '.gitkeep'), '');
  // The intent is a starting point to make their own: a draft, never in force as copied.
  let intent = '';
  try { intent = fs.readFileSync(codaPath(sourceRoot, 'intent.md'), 'utf8'); } catch { /* the source had none */ }
  const { meta, body } = parseFrontmatter(intent);
  fs.writeFileSync(codaPath(target, 'intent.md'), `---\nlevel: team\nversion: 0\nstatus: draft\narchitect:\nupdated:\nsplit-from: ${sourceCfg.team.name}${meta.version ? ` (version ${meta.version})` : ''}\n---\n${body || '# Intent\n\n## Purpose\n\n## Objectives\n\n## Non-negotiable constraints\n\n## Out of scope\n\n## Success criteria\n\n## Regrowth signal\n'}`);
  for (const id of plan.teams[into.name]) {
    const r = from('decisions', id); if (!r) continue;
    fs.writeFileSync(path.join(target, r.file), inherit(fs.readFileSync(path.join(sourceRoot, r.file), 'utf8'), sourceCfg.team.name, id));
  }
  for (const id of plan.patterns) {
    const r = from('patterns', id); if (!r) continue;
    fs.writeFileSync(path.join(target, r.file), inherit(fs.readFileSync(path.join(sourceRoot, r.file), 'utf8'), sourceCfg.team.name, id));
  }
  return cfg;
}

export const hasTeam = (dir) => fs.existsSync(path.join(dir, CODA_DIR, 'config.json'));
