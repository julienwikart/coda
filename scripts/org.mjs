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
import { codaPath, git, intentSummary, ROLES } from './lib.mjs';

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

function mirrorDir(teamRoot, repo, ref) {
  const key = crypto.createHash('sha256').update(`${repo}\0${ref || ''}`).digest('hex').slice(0, 12);
  return codaPath(teamRoot, '.state', 'org', key);
}

function readMeta(dir) { try { return JSON.parse(fs.readFileSync(dir + '.json', 'utf8')); } catch { return {}; } }

/**
 * A read-only local copy of another repository, refreshed by a time-boxed
 * fetch. Offline, the last copy serves. Machine-local and never committed.
 */
export function mirror(teamRoot, repo, ref, { refresh = 'if-stale', timeoutMs = 8000 } = {}) {
  const dir = mirrorDir(teamRoot, repo, ref);
  const meta = readMeta(dir);
  const have = fs.existsSync(path.join(dir, '.git'));
  const due = refresh === 'now' || (refresh === 'if-stale' && (!have || Date.now() - (meta.fetchedAt || 0) > STALE_AFTER_MS));
  if (due) {
    const run = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'ignore', timeout: timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    try {
      if (!have) {
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        fs.rmSync(dir, { recursive: true, force: true });
        run(['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), repo, dir]);
      } else {
        run(['fetch', '--quiet', '--depth', '1', 'origin', ref || 'HEAD'], dir);
        run(['reset', '--quiet', '--hard', 'FETCH_HEAD'], dir);
      }
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
    const m = mirror(teamRoot, String(link.repo), link.ref ? String(link.ref) : undefined, opts);
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
  };
}
