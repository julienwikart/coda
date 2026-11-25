import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, readEvents, fingerprint } from '../scripts/lib.mjs';
import { decide, decideAtOrg } from '../scripts/hook.mjs';
import { brief, status } from '../scripts/brief.mjs';
import { orgPath } from '../scripts/org.mjs';
import { monorepo, multirepo, commitAll, coda, hook, CLI, TEAMS } from './sandbox.mjs';

const d = (root, input) => decide(root, loadConfig(root), input).decision;
const write = (file, extra = {}) => ({ tool_name: 'Write', tool_input: { file_path: file }, ...extra });
const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, ...extra });
const setLevel = (root, level, mutate = () => {}) => { const cfg = loadConfig(root); cfg.autonomy.level = level; mutate(cfg); saveConfig(root, cfg); };

test('the map says who carries what, in one repository and across several', () => {
  const mono = monorepo();
  const m = JSON.parse(coda(mono.teams.billing, 'org', 'map').stdout);
  assert.deepEqual(m.teams.map((t) => [t.name, t.isSelf, t.scope.domains[0]]), [['billing', true, 'billing'], ['catalog', false, 'catalog'], ['search', false, 'search']]);
  assert.equal(coda(mono.root, 'org', 'check').status, 0, 'also from the organisation root');

  const multi = multirepo();
  assert.equal(coda(multi.teams.catalog, 'org', 'sync').status, 0);
  const mm = JSON.parse(coda(multi.teams.catalog, 'org', 'map').stdout);
  assert.deepEqual(mm.teams.map((t) => [t.name, t.readable, t.scope.components[0]]), [['billing', true, 'billing-api'], ['catalog', true, 'catalog-api'], ['search', true, 'search-api']]);
  assert.equal(coda(multi.teams.catalog, 'org', 'check').status, 0);
});

test('two teams declaring the same domain is said at the moment of declaring, and stays visible until settled', () => {
  for (const make of [monorepo, multirepo]) {
    const { teams } = make();
    const r = coda(teams.search, 'scope', 'set', '--domain', 'search', '--domain', 'Catalog', '--by', 'Dana');
    if (make === multirepo) { commitAll(teams.search); for (const t of TEAMS) coda(teams[t], 'org', 'sync'); }
    else assert.match(r.stdout, /Overlap: catalog also declares the domain "catalog"/);
    assert.equal(coda(teams.catalog, 'org', 'check').status, 1);
    assert.match(coda(teams.catalog, 'org', 'check').stdout, /catalog and search both declare the domain "catalog"/);
    assert.match(brief(teams.catalog, loadConfig(teams.catalog)), /Open overlap: catalog and search/);
    assert.match(brief(teams.search, loadConfig(teams.search)), /Open overlap/);
    assert.ok(!/Open overlap/.test(brief(teams.billing, loadConfig(teams.billing))), 'a team that is not concerned is not told');
    const ind = status(teams.catalog, loadConfig(teams.catalog)).entryConditions.independentScope;
    assert.deepEqual([ind.check, ind.met, ind.overlaps.length], ['partly', false, 1]);
  }
});

test('every team\'s brief carries the map, so an agent knows whose scope a request reaches before touching it', () => {
  const { teams } = monorepo();
  const b = hook(teams.billing, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(b, /billing \(this team\) — domains: billing · components: billing-api/);
  assert.match(b, /- catalog — domains: catalog/);
  assert.match(b, /not this team's to deliver/);
  assert.match(b, /the harness refuses any write in their directories/);
});

test('guard: in a shared repository, a team cannot write in another team\'s directory, at any autonomy level', () => {
  const { teams } = monorepo();
  const target = path.join(teams.catalog, 'src', 'index.ts');
  for (const level of ['observed', 'supervised', 'bounded']) {
    setLevel(teams.billing, level, (cfg) => { cfg.autonomy.perimeter.write = ['**']; });
    assert.equal(d(teams.billing, write(target)), 'deny', level);
    assert.equal(d(teams.billing, write(target, { agent_type: 'coda:builder' })), 'deny', level);
    assert.equal(d(teams.billing, write(path.join(teams.catalog, '.coda/decisions/D-0001-x.md'))), 'deny', `${level}: their memory is theirs too`);
  }
  assert.equal(d(teams.billing, write(path.join(teams.billing, 'src/a.ts'))), 'allow', 'its own directory is unaffected');
  const out = hook(teams.billing, { hook_event_name: 'PreToolUse', ...write(target) });
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /team "catalog"/);
  assert.equal(readEvents(teams.billing, { types: ['guard'] }).pop().data.otherTeam, 'catalog');
});

test('a session started at the organisation root gets the organisation brief, not silence', () => {
  const { root } = monorepo();
  const b = hook(root, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(b, /CODA brief — organisation/);
  assert.match(b, /Customer data never leaves the EU region/);
  assert.match(b, /- search — domains: search/);
  assert.equal(readEvents(root, { base: orgPath(root) }).pop().type, 'session.start');
});

test('guard at the organisation root: each file is judged by the rules of the team that carries it', () => {
  const { root, teams } = monorepo();
  const at = (input) => decideAtOrg(root, input).decision;
  assert.equal(at(write(path.join(teams.billing, 'src/a.ts'))), 'ask', 'billing is supervised');
  setLevel(teams.catalog, 'bounded');
  assert.equal(at(write(path.join(teams.catalog, 'src/a.ts'))), 'allow', 'catalog is bounded and src/ is in its perimeter');
  assert.equal(at(write(path.join(teams.catalog, '.env'))), 'deny', 'catalog protects it');
  setLevel(teams.search, 'observed');
  assert.equal(at(write(path.join(teams.search, 'src/a.ts'))), 'deny', 'search is observed');
  assert.equal(at(write(path.join(root, 'README.md'))), 'ask', 'carried by no team');
  assert.equal(at(write(orgPath(root, 'intent.md'))), 'ask');
  assert.equal(at(write(orgPath(root, 'journal/2026-11/x.jsonl'))), 'deny');
  assert.equal(at(write(path.join(teams.catalog, 'src/a.ts'), { agent_type: 'coda:coordination' })), 'deny', 'cognitive agents still only read');
  assert.equal(at(bash('npm test')), 'ask');
  assert.equal(at(bash('git status')), null);
  assert.equal(at(bash(`node "${CLI}" org view --format md`)), 'allow', 'reading the organisation is never held up');
  assert.equal(at(bash(`node "${CLI}" org floors set --by x`)), 'ask');
  assert.equal(at(bash('npm test', { agent_type: 'coda:memory' })), 'deny');
  assert.equal(at(bash('rm -rf .coda-org/journal')), 'deny');
});

test('verification gate at the organisation root: every team the session changed must pass its own verification', () => {
  const { root, teams } = monorepo();
  setLevel(teams.billing, 'bounded', (cfg) => { cfg.verify.commands = ['test -f ok.txt']; });
  commitAll(root);
  const file = path.join(teams.billing, 'src', 'feature.ts');
  hook(root, { hook_event_name: 'SessionStart' });
  assert.equal(hook(root, { hook_event_name: 'Stop' }), null, 'nothing changed: no gate');
  assert.equal(hook(root, { hook_event_name: 'PreToolUse', ...write(file) }).hookSpecificOutput.permissionDecision, 'allow');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x');
  hook(root, { hook_event_name: 'PostToolUse', ...write(file) });
  assert.equal(readEvents(teams.billing, { types: ['tool'] }).pop().data.path, 'src/feature.ts', 'journaled in the team that was changed');
  const blocked = hook(root, { hook_event_name: 'Stop' });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /test -f ok\.txt/);
  fs.writeFileSync(path.join(teams.billing, 'ok.txt'), 'x');
  assert.equal(hook(root, { hook_event_name: 'Stop' }), null);
  assert.ok(readEvents(teams.billing).some((e) => e.type === 'verify.passed'));
  assert.equal(readEvents(teams.catalog, { types: ['verify'] }).length, 0, 'a team the session did not touch is not run');
});

test('fingerprint follows the content of new files for a team that is not at the top of its repository', () => {
  const { teams } = monorepo();
  const f = path.join(teams.search, 'new.txt');
  fs.writeFileSync(f, '1'); const a = fingerprint(teams.search);
  fs.writeFileSync(f, '2'); const b = fingerprint(teams.search);
  assert.notEqual(a, b);
  fs.writeFileSync(path.join(teams.billing, 'elsewhere.txt'), 'x');
  assert.equal(fingerprint(teams.search), b, 'another team\'s changes are not this team\'s');
});

test('declaring a scope needs a named human, and the model cannot forge the event', () => {
  const { teams } = monorepo();
  assert.equal(coda(teams.billing, 'scope', 'set', '--domain', 'x').status, 1);
  assert.equal(coda(teams.billing, 'journal', 'add', 'scope.declared').status, 1);
  assert.equal(d(teams.billing, bash(`node "${CLI}" scope set --domain x --by y`)), 'ask');
  assert.equal(d(teams.billing, bash(`node "${CLI}" org check`)), 'allow');
  assert.equal(readEvents(teams.billing, { types: ['scope'] })[0].actor, 'human:Dana');
});
