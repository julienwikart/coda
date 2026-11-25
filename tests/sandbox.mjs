// A throwaway organisation with three sandwich teams, in one repository or in
// several. Shared by the organisation-level tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI = path.join(here, '..', 'scripts', 'coda.mjs');
export const HOOK = path.join(here, '..', 'scripts', 'hook.mjs');
export const TEAMS = ['billing', 'catalog', 'search'];

export const tmp = (prefix = 'coda-org-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
export const coda = (cwd, ...args) => spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

export function gitInit(dir) { fs.mkdirSync(dir, { recursive: true }); g(dir, 'init', '-q', '-b', 'main'); g(dir, 'commit', '-q', '--allow-empty', '-m', 'init'); }
export function commitAll(dir, msg = 'update') { g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); }

export const ORG_INTENT = (constraint = 'Customer data never leaves the EU region.') => `---
level: organization
version: 1
status: active
---
# Intent

## Purpose

Let independent shops sell online without an engineering team.

## Non-negotiable constraints

- ${constraint}

## Out of scope

- Payment processing of our own.
`;

function makeOrg(dir, constraint) {
  const r = coda(dir, 'org', 'init', '--name', 'Acme', '--by', 'Dana', '--human', 'Dana=intent-architect', '--human', 'Lou=ethical-guardian');
  if (r.status !== 0) throw new Error(r.stderr);
  fs.writeFileSync(path.join(dir, '.coda-org', 'intent.md'), ORG_INTENT(constraint));
}

function makeTeam(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const r = coda(dir, 'init', '--name', name, '--verify', 'true');
  if (r.status !== 0) throw new Error(r.stderr);
}

/** One repository: .coda-org/ at the root, each team in teams/<name>/ with its own .coda/. */
export function monorepo({ constraint } = {}) {
  const root = tmp();
  gitInit(root);
  makeOrg(root, constraint);
  const teams = {};
  for (const name of TEAMS) {
    teams[name] = path.join(root, 'teams', name);
    makeTeam(teams[name], name);
    coda(root, 'org', 'add-team', '--name', name, '--path', `teams/${name}`, '--by', 'Dana');
  }
  commitAll(root, 'organisation and teams');
  return { root, org: root, teams };
}

/** Several repositories: one for the organisation, one per team, each team referencing the organisation by URL. */
export function multirepo({ constraint } = {}) {
  const base = tmp();
  const org = path.join(base, 'acme-org');
  gitInit(org);
  makeOrg(org, constraint);
  const teams = {};
  for (const name of TEAMS) {
    teams[name] = path.join(base, name);
    gitInit(teams[name]);
    makeTeam(teams[name], name);
    coda(org, 'org', 'add-team', '--name', name, '--repo', teams[name], '--by', 'Dana');
  }
  commitAll(org, 'organisation');
  for (const name of TEAMS) {
    const r = coda(teams[name], 'org', 'join', '--repo', org, '--by', 'Dana');
    if (r.status !== 0) throw new Error(r.stderr);
  }
  return { root: base, org, teams };
}

export function hook(root, input) {
  const r = spawnSync('node', [HOOK], { cwd: root, input: JSON.stringify({ cwd: root, session_id: 'sess-1', ...input }), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  return r.stdout ? JSON.parse(r.stdout) : null;
}
