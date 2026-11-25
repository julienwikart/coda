// The organisation: what several sandwich teams share. It lives in a .coda-org/
// directory, either in the same repository as the teams or in a repository of
// its own that each team references. Plain files, shared by pull request.
//
// Everything here fails open: a team whose organisation cannot be read keeps
// working from its own intent. Only the guard is allowed to fail closed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { codaPath, git, intentSummary, slugify, listRecords, ROLES, LEVELS, CODA_DIR } from './lib.mjs';

export const ORG_DIR = '.coda-org';
const STALE_AFTER_MS = 15 * 60 * 1000;

export const orgPath = (dir, ...parts) => path.join(dir, ORG_DIR, ...parts);

/** Nearest directory at or above `start` that holds a .coda-org/org.json, not looking past `stop`. */
export function findOrgRoot(start, stop) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(orgPath(dir, 'org.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || (stop && path.resolve(stop) === dir)) return null;
    dir = parent;
  }
}

export function loadOrgFile(dir) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(orgPath(dir, 'org.json'), 'utf8')); } catch (e) { return { error: `${ORG_DIR}/org.json cannot be read: ${e.message}` }; }
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return { error: `${ORG_DIR}/org.json has no name` };
  const teams = Array.isArray(raw.teams) ? raw.teams.filter((t) => t && typeof t.name === 'string') : [];
  return { org: { version: 1, humans: [], ...raw, teams } };
}

// ---------------------------------------------------------------- remote mirror

function mirrorDir(cache, repo, ref) {
  const key = crypto.createHash('sha256').update(`${repo}\0${ref || ''}`).digest('hex').slice(0, 12);
  return path.join(cache, key);
}

/** Where a team keeps its read-only copies of other repositories. Machine-local, never committed. */
export const teamCache = (teamRoot) => codaPath(teamRoot, '.state', 'org');
/** The same, for a session started at the organisation's root rather than in a team. */
export const orgCache = (orgDir) => orgPath(orgDir, '.state', 'mirrors');

function readMeta(dir) { try { return JSON.parse(fs.readFileSync(dir + '.json', 'utf8')); } catch { return {}; } }

const MIRRORED = [`${ORG_DIR}/`, `${CODA_DIR}/`, `!${CODA_DIR}/journal/`, `!${CODA_DIR}/.state/`];

function dropJournals(dir, depth = 0) {
  if (depth > 6) return;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.name === CODA_DIR) fs.rmSync(path.join(p, 'journal'), { recursive: true, force: true });
    else dropJournals(p, depth + 1);
  }
}

/**
 * A read-only local copy of another repository, refreshed by a time-boxed
 * fetch. Offline, the last copy serves. Machine-local and never committed.
 */
export function mirror(cache, repo, ref, { refresh = 'if-stale', timeoutMs = 8000 } = {}) {
  const dir = mirrorDir(cache, repo, ref);
  const meta = readMeta(dir);
  const have = fs.existsSync(path.join(dir, '.git'));
  const due = refresh === 'now' || (refresh === 'if-stale' && (!have || Date.now() - (meta.fetchedAt || 0) > STALE_AFTER_MS));
  if (due) {
    const run = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore', timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    try {
      if (!have) {
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        fs.rmSync(dir, { recursive: true, force: true });
        run(['clone', '--quiet', '--depth', '1', '--no-checkout', ...(ref ? ['--branch', ref] : []), repo, dir]);
      } else run(['fetch', '--quiet', '--depth', '1', 'origin', ref || 'HEAD'], dir);
      // Only what teams declare and decide is copied: no code, and never a journal. What a team
      // did day to day stays with that team; nothing here can be turned into a comparison of activity.
      try { run(['sparse-checkout', 'set', '--no-cone', ...MIRRORED], dir); } catch { /* older git: the journals are removed below */ }
      run(['reset', '--quiet', '--hard', have ? 'FETCH_HEAD' : 'HEAD'], dir);
      dropJournals(dir);
      meta.fetchedAt = Date.now(); meta.error = null;
    } catch (e) {
      if (!fs.existsSync(path.join(dir, '.git'))) fs.rmSync(dir, { recursive: true, force: true });
      meta.error = e.code === 'ETIMEDOUT' ? 'timed out' : 'could not be reached';
    }
    try { fs.mkdirSync(path.dirname(dir), { recursive: true }); fs.writeFileSync(dir + '.json', JSON.stringify(meta)); } catch { /* best effort */ }
  }
  return { dir: fs.existsSync(path.join(dir, '.git')) ? dir : null, fetchedAt: meta.fetchedAt || null, fetchError: meta.error || null };
}

// -------------------------------------------------------------------- resolve

/**
 * The organisation a team belongs to, or null when it has none.
 * `declared` means the team says it has one: if it then cannot be read, that is
 * reported rather than silently ignored.
 */
export function resolveOrg(teamRoot, cfg, opts = {}) {
  const link = cfg.org && typeof cfg.org === 'object' ? cfg.org : null;
  let res;
  if (link?.repo) {
    const m = mirror(teamCache(teamRoot), String(link.repo), link.ref ? String(link.ref) : undefined, opts);
    res = { source: 'remote', location: String(link.repo), dir: m.dir, fetchedAt: m.fetchedAt, fetchError: m.fetchError };
    if (!m.dir) return { ...res, declared: true, error: `the organisation repository ${link.repo} ${m.fetchError || 'has not been fetched yet'} and there is no local copy` };
  } else if (link?.path) {
    res = { source: 'local', location: String(link.path), dir: path.resolve(teamRoot, String(link.path)) };
  } else {
    const top = git(teamRoot, ['rev-parse', '--show-toplevel']);
    const dir = findOrgRoot(teamRoot, top || teamRoot);
    if (!dir) return null;
    res = { source: 'local', location: path.relative(teamRoot, dir) || '.', dir };
  }
  const loaded = loadOrgFile(res.dir);
  if (loaded.error) return { ...res, declared: true, error: loaded.error };
  const org = loaded.org;
  const team = org.teams.find((t) => t.name === cfg.team?.name) || null;
  return { ...res, declared: true, name: org.name, org, team, intent: intentSummary(null, orgPath(res.dir, 'intent.md')) };
}

/** Whether `abs` lies inside this organisation's .coda-org/ directory; returns the path relative to it. */
export function inOrgDir(org, abs) {
  if (!org?.dir) return null;
  let base = orgPath(org.dir);
  try { base = fs.realpathSync(base); } catch { /* keep lexical */ }
  const rel = path.relative(base, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
}

export function parseHuman(spec) {
  const [name, rest = ''] = String(spec).split('=');
  const parts = rest.split(',').map((x) => x.trim()).filter(Boolean);
  const roles = parts.filter((x) => x !== 'external');
  if (!name.trim() || roles.some((r) => !ROLES.includes(r))) return null;
  return { name: name.trim(), roles, ...(parts.includes('external') ? { external: true } : {}) };
}

/** Facts for `coda org status`, /coda:status and the doctor. */
export function orgFacts(teamRoot, cfg, opts) {
  const o = resolveOrg(teamRoot, cfg, opts);
  if (!o) return null;
  const base = { declared: true, source: o.source, location: o.location, fetchedAt: o.fetchedAt ? new Date(o.fetchedAt).toISOString() : null, fetchError: o.fetchError || null };
  if (o.error) return { ...base, readable: false, error: o.error };
  return {
    ...base, readable: true, name: o.name,
    intent: Boolean(o.intent?.purpose), intentStatus: o.intent?.meta?.status || null,
    humans: o.org.humans,
    teams: o.org.teams.map((t) => ({ name: t.name, where: t.path ? `path ${t.path}` : t.repo ? `repo ${t.repo}` : 'not located' })),
    thisTeamRegistered: Boolean(o.team),
    arbitration: arbitration(o.org),
    guardians: orgGuardians(o.org).map((h) => h.name),
    bindingDecisions: bindingOn(orgDecisions(o), cfg.team?.name).map((d) => ({ id: d.id, title: d.title })),
    ...(() => { const teams = teamsOf(o, { selfRoot: teamRoot, selfName: cfg.team?.name, ...opts }); return { map: teams.map(({ name, isSelf, readable, note, scope }) => ({ name, isSelf, readable, note, scope })), overlaps: overlaps(teams), problems: scopeProblems(teams) }; })(),
  };
}

// ------------------------------------------------------------------ scope map

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const within = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const names = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => slugify(x)).filter((x) => x && x !== 'untitled'))];

/** The organisation resolved from its own root, for a session or a command that is not inside any team. */
export function orgAt(dir) {
  const loaded = loadOrgFile(dir);
  if (loaded.error) return { declared: true, source: 'local', location: '.', dir, error: loaded.error };
  return { declared: true, source: 'local', location: '.', dir, name: loaded.org.name, org: loaded.org, team: null, intent: intentSummary(null, orgPath(dir, 'intent.md')) };
}

/**
 * Every team of the organisation with what it declares it carries. A team in
 * the same repository is read from disk; one in its own repository from a
 * read-only copy. Only declarations are read across teams — never journals.
 */
export function teamsOf(o, { selfRoot = null, selfName = null, refresh = 'never', timeoutMs = 8000 } = {}) {
  if (!o || o.error) return [];
  const cache = selfRoot ? teamCache(selfRoot) : orgCache(o.dir);
  // Refreshing must never hold a session hostage: past the budget, the copies already here serve.
  const started = Date.now(); const budget = Math.max(timeoutMs, 10000);
  return o.org.teams.map((t) => {
    if (refresh !== 'now' && Date.now() - started > budget) refresh = 'never';
    const isSelf = Boolean(selfName) && t.name === selfName;
    let root = null; let note = null; let fetchedAt = null;
    if (isSelf && selfRoot) root = selfRoot;
    else if (t.path) root = path.resolve(o.dir, String(t.path));
    else if (t.repo) { const m = mirror(cache, String(t.repo), t.ref ? String(t.ref) : undefined, { refresh, timeoutMs }); root = m.dir; fetchedAt = m.fetchedAt; if (!root) note = `its repository ${m.fetchError || 'has not been fetched yet'}`; }
    else note = 'the organisation does not say where it lives';
    let raw = null;
    if (root) { try { raw = JSON.parse(fs.readFileSync(path.join(root, CODA_DIR, 'config.json'), 'utf8')); } catch { note = 'it has no readable .coda/config.json'; } }
    const scope = raw?.scope || {};
    return {
      dir: raw ? root : null, // where its declarations and records can be read, wherever that is
      name: t.name, isSelf, where: t.path ? { path: t.path } : t.repo ? { repo: t.repo } : {},
      root: root && (t.path || isSelf) ? real(root) : null, // only teams sharing this checkout have a place on disk that matters to the guard
      readable: Boolean(raw), note, fetchedAt,
      declaredName: raw?.team?.name ?? null,
      scope: { domains: names(scope.domains), components: names(scope.components), paths: Array.isArray(scope.paths) ? scope.paths.map(String) : ['**'] },
    };
  });
}

/** Two teams claiming the same thing. Stated as a fact for the humans to settle; nothing here picks a winner. */
export function overlaps(teams) {
  const found = [];
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
    const a = teams[i]; const b = teams[j];
    for (const kind of ['domains', 'components']) for (const what of a.scope[kind]) if (b.scope[kind].includes(what)) found.push({ kind: kind.slice(0, -1), what, teams: [a.name, b.name] });
    if (a.root && b.root && (within(a.root, b.root) || within(b.root, a.root))) found.push({ kind: 'directory', what: path.relative(within(a.root, b.root) ? a.root : b.root, within(a.root, b.root) ? b.root : a.root) || '.', teams: [a.name, b.name] });
  }
  return found;
}

/** The other team, sharing this checkout, whose directory holds `abs` — or null. */
export function owningTeam(teams, abs, selfName) {
  const hit = teams.filter((t) => t.root && t.name !== selfName && within(t.root, abs)).sort((x, y) => y.root.length - x.root.length)[0];
  return hit || null;
}

export function scopeProblems(teams) {
  const out = [];
  for (const t of teams) {
    if (!t.readable) out.push(`team "${t.name}" cannot be read: ${t.note}`);
    else {
      if (t.declaredName !== t.name) out.push(`team "${t.name}" calls itself "${t.declaredName}" in its own config`);
      if (!t.scope.domains.length && !t.scope.components.length) out.push(`team "${t.name}" has not declared what it carries`);
    }
  }
  return out;
}

// ------------------------------------------------- arbitration and the guardian

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
const RETIRED = ['superseded', 'cancelled', 'rejected'];

/**
 * Who settles what two teams cannot settle between them, and on what criterion.
 * Written once for the organisation. Unless it says otherwise, the
 * organisation's intent architect arbitrates.
 */
export function arbitration(org) {
  const a = org?.arbitration || {};
  const fallback = (org?.humans || []).find((h) => (h.roles || []).includes('intent-architect'));
  const arbiter = a.arbiter ? String(a.arbiter) : fallback?.name || null;
  return { arbiter, explicit: Boolean(a.arbiter), rule: a.rule ? String(a.rule) : null };
}

/** The ethical guardians the organisation declares, shared by its teams. */
export const orgGuardians = (org) => (org?.humans || []).filter((h) => (h.roles || []).includes('ethical-guardian'));

/** Decisions taken for several teams. They live with the organisation, as X-0001 records. */
export function orgDecisions(o) {
  if (!o || o.error) return [];
  return listRecords(null, 'decisions', orgPath(o.dir)).map((r) => ({
    ...r, status: String(r.meta.status || '').toLowerCase(), inForce: !RETIRED.includes(String(r.meta.status || '').toLowerCase()),
    teams: asList(r.meta.teams), settles: asList(r.meta.settles),
    statement: (/^##\s+Decision\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(r.body) || [])[1]?.trim() || '',
  }));
}

/** The organisation's decisions in force that bind a team: those naming it, and those naming no team (they bind all). */
export const bindingOn = (decisions, team) => decisions.filter((d) => d.inForce && (d.teams.length === 0 || d.teams.includes(team) || d.teams.includes('all')));

/** What is wrong with the organisation's decisions as records: wrong maker, unknown teams. Facts for a human. */
export function arbitrationProblems(o, decisions = orgDecisions(o)) {
  const out = [];
  const { arbiter } = arbitration(o.org);
  const known = new Set(o.org.teams.map((t) => t.name));
  if (!arbiter) out.push('nobody arbitrates between teams: the organisation declares no intent architect and names no arbiter');
  for (const d of decisions) {
    const maker = String(d.meta.maker || '');
    if (!maker) out.push(`${d.id} names no human who took it`);
    else if (arbiter && d.inForce && !maker.toLowerCase().includes(arbiter.toLowerCase())) out.push(`${d.id} was taken by "${maker}", but ${arbiter} arbitrates between teams`);
    for (const t of d.teams) if (t !== 'all' && !known.has(t)) out.push(`${d.id} names team "${t}", which the organisation does not list`);
  }
  return out;
}

// --------------------------------------------------------------------- floors

const strings = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))];

/** What the organisation requires of every team's harness. A team may be stricter; it cannot be laxer. */
export function normaliseFloors(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  return {
    protected: strings(f.protected), denyCommands: strings(f.denyCommands), askCommands: strings(f.askCommands),
    verify: { commands: strings(f.verify?.commands), requireReview: f.verify?.requireReview === true },
    maxLevel: LEVELS.includes(f.maxLevel) ? f.maxLevel : null,
  };
}

export const floorsEmpty = (f) => !f.protected.length && !f.denyCommands.length && !f.askCommands.length && !f.verify.commands.length && !f.verify.requireReview && !f.maxLevel;

/**
 * The configuration the harness actually enforces: what the team declares,
 * tightened by the organisation's floors. Lists are unions, so a team can add
 * and never remove; the level is the lower of the two.
 *
 * This is the one place where the organisation fails closed. If a team has an
 * organisation and its floors cannot be read, the last floors read on this
 * machine apply; with none, the team drops to "observed". An unreadable
 * organisation never widens what agents may do.
 */
export function withFloors(root, cfg) {
  let o; try { o = resolveOrg(root, cfg, { refresh: 'never' }); } catch (e) { o = { declared: true, error: e.message }; }
  if (!o) return cfg;
  const cacheFile = codaPath(root, '.state', 'floors.json');
  let floors; let stale = false;
  if (o.error) {
    try { floors = normaliseFloors(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))); stale = true; } catch {
      return { ...cfg, autonomy: { ...cfg.autonomy, level: 'observed' }, _error: `the organisation's floors cannot be read (${o.error}) and no earlier copy exists on this machine`, _floors: { unreadable: true } };
    }
  } else {
    floors = normaliseFloors(o.org.floors);
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(floors)); } catch { /* the copy is a convenience */ }
  }
  const p = cfg.autonomy.perimeter;
  const capped = floors.maxLevel && LEVELS.indexOf(cfg.autonomy.level) > LEVELS.indexOf(floors.maxLevel);
  return {
    ...cfg,
    autonomy: {
      ...cfg.autonomy,
      level: capped ? floors.maxLevel : cfg.autonomy.level,
      perimeter: { ...p, protected: strings([...floors.protected, ...p.protected]), denyCommands: strings([...floors.denyCommands, ...p.denyCommands]), askCommands: strings([...floors.askCommands, ...p.askCommands]) },
    },
    verify: { ...cfg.verify, commands: strings([...floors.verify.commands, ...cfg.verify.commands]), requireReview: cfg.verify.requireReview || floors.verify.requireReview },
    _floors: { ...floors, stale, declaredLevel: cfg.autonomy.level, capped: Boolean(capped), organisation: o.name || null },
  };
}
