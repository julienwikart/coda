import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, readEvents } from '../scripts/lib.mjs';
import { decide, decideAtOrg, enforced } from '../scripts/hook.mjs';
import { withFloors, orgPath } from '../scripts/org.mjs';
import { status } from '../scripts/brief.mjs';
import { monorepo, multirepo, commitAll, coda, hook, tmp, gitInit, CLI } from './sandbox.mjs';

const d = (root, input) => decide(root, enforced(root), input).decision;
const write = (file, extra = {}) => ({ tool_name: 'Write', tool_input: { file_path: file }, ...extra });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const FLOORS = ['--protect', 'migrations/**', '--deny-command', 'npm publish*', '--ask-command', 'git tag*', '--verify', 'test -f LICENSE', '--require-review', '--max-level', 'supervised', '--by', 'Dana'];
const setFloors = (orgDir, args = FLOORS) => { const r = coda(orgDir, 'org', 'floors', 'set', ...args); assert.equal(r.status, 0, r.stderr); };
// A team that tries to be as lax as its own configuration allows.
function laxest(root) {
  const cfg = loadConfig(root);
  cfg.autonomy.level = 'bounded';
  cfg.autonomy.perimeter = { write: ['**'], protected: [], askCommands: [], denyCommands: [] };
  cfg.verify = { ...cfg.verify, commands: [], requireReview: false };
  saveConfig(root, cfg);
}

test('a team\'s configuration cannot go below a floor set by its organisation', () => {
  const { root, teams } = monorepo();
  setFloors(root);
  laxest(teams.billing);
  const cfg = enforced(teams.billing);
  assert.equal(cfg.autonomy.level, 'supervised', 'the level is capped');
  assert.deepEqual(cfg.verify.commands, ['test -f LICENSE'], 'the organisation\'s verification cannot be removed');
  assert.equal(cfg.verify.requireReview, true);
  assert.equal(d(teams.billing, write(path.join(teams.billing, 'migrations/001.sql'))), 'deny', 'protected by the organisation although the team protects nothing');
  assert.equal(d(teams.billing, bash('npm publish --access public')), 'deny');
  assert.equal(d(teams.billing, write(path.join(teams.billing, 'src/a.ts'))), 'ask', 'supervised, not the bounded the team declares');
  assert.match(hook(teams.billing, { hook_event_name: 'PreToolUse', ...write(path.join(teams.billing, 'migrations/001.sql')) }).hookSpecificOutput.permissionDecisionReason, /protected by the organisation, for every team/);
  assert.equal(loadConfig(teams.billing).autonomy.level, 'bounded', 'what the team declares is left as it wrote it');
});

test('a team may be stricter than the floors: what it adds stays', () => {
  const { root, teams } = monorepo();
  setFloors(root, ['--protect', 'migrations/**', '--verify', 'test -f LICENSE', '--by', 'Dana']);
  const cfg = loadConfig(teams.catalog);
  cfg.autonomy.level = 'observed'; cfg.autonomy.perimeter.protected = ['secrets/**']; cfg.verify.commands = ['npm test', 'test -f LICENSE']; cfg.verify.requireReview = true;
  saveConfig(teams.catalog, cfg);
  const eff = enforced(teams.catalog);
  assert.equal(eff.autonomy.level, 'observed');
  assert.deepEqual(eff.autonomy.perimeter.protected, ['migrations/**', 'secrets/**']);
  assert.deepEqual(eff.verify.commands, ['test -f LICENSE', 'npm test'], 'the floor runs first, and is not duplicated');
  assert.equal(eff.verify.requireReview, true);
});

test('the verification gate runs the organisation\'s minimum even for a team that configured none', () => {
  const { root, teams } = monorepo();
  setFloors(root, ['--verify', 'test -f LICENSE', '--by', 'Dana']);
  laxest(teams.search);
  commitAll(root);
  hook(teams.search, { hook_event_name: 'SessionStart' });
  fs.writeFileSync(path.join(teams.search, 'feature.txt'), 'x');
  const blocked = hook(teams.search, { hook_event_name: 'Stop' });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /test -f LICENSE/);
  fs.writeFileSync(path.join(teams.search, 'LICENSE'), 'MIT');
  assert.equal(hook(teams.search, { hook_event_name: 'Stop' }), null);
});

test('a team cannot raise its level above the organisation\'s cap', () => {
  const { root, teams } = monorepo();
  setFloors(root, ['--max-level', 'supervised', '--by', 'Dana']);
  const r = coda(teams.billing, 'level', 'bounded', '--by', 'Ana', '--reason', 'three clean weeks');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /caps every team at "supervised"/);
  assert.equal(loadConfig(teams.billing).autonomy.level, 'supervised');
  assert.equal(coda(teams.billing, 'level', 'observed', '--by', 'Ana', '--reason', 'incident').status, 0, 'stepping down is always possible');
});

test('an organisation that cannot be read never widens permissions: its last floors still apply', () => {
  const { root, teams } = monorepo();
  setFloors(root);
  laxest(teams.billing);
  enforced(teams.billing); // the floors are read once on this machine
  fs.writeFileSync(orgPath(root, 'org.json'), '{ broken');
  const cfg = enforced(teams.billing);
  assert.equal(cfg._floors.stale, true);
  assert.equal(cfg.autonomy.level, 'supervised');
  assert.equal(d(teams.billing, write(path.join(teams.billing, 'migrations/001.sql'))), 'deny');
  const b = hook(teams.billing, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(b, /floors as last read on this machine/);
});

test('an organisation that cannot be read and was never read drops the team to observed, and the session still starts', () => {
  const root = tmp(); gitInit(root);
  coda(root, 'init', '--name', 'lonely', '--verify', 'true', '--level', 'bounded', '--by', 'Ana');
  const cfg = loadConfig(root); cfg.org = { repo: path.join(root, 'does-not-exist') }; saveConfig(root, cfg);
  assert.equal(enforced(root).autonomy.level, 'observed');
  assert.equal(d(root, write(path.join(root, 'src/a.ts'))), 'deny');
  const b = hook(root, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(b, /floors cannot be read/);
  assert.match(b, /## Intent/, 'everything but the guard keeps working');
});

test('floors reach a team in another repository through its copy of the organisation, at the next refresh', () => {
  const { org, teams } = multirepo();
  laxest(teams.catalog);
  assert.equal(enforced(teams.catalog).autonomy.level, 'bounded', 'no floors yet');
  setFloors(org); commitAll(org);
  assert.equal(enforced(teams.catalog).autonomy.level, 'bounded', 'not until the copy is refreshed');
  assert.equal(coda(teams.catalog, 'org', 'sync').status, 0);
  assert.equal(enforced(teams.catalog).autonomy.level, 'supervised');
  assert.equal(d(teams.catalog, bash('npm publish')), 'deny');
  assert.equal(coda(teams.catalog, 'org', 'floors', 'set', '--by', 'Noor').status, 1, 'a team cannot rewrite floors through its copy');
});

test('floors are set by a named human, journaled by the harness, and the model cannot forge or bypass them', () => {
  const { root, teams } = monorepo();
  assert.equal(coda(root, 'org', 'floors', 'set', '--protect', 'x/**').status, 1);
  setFloors(root);
  const e = readEvents(root, { base: orgPath(root) }).pop();
  assert.deepEqual([e.type, e.actor, e.data.after.maxLevel], ['org.floors-set', 'human:Dana', 'supervised']);
  assert.equal(coda(teams.billing, 'journal', 'add', 'org.floors-set').status, 1);
  assert.equal(decide(teams.billing, enforced(teams.billing), bash(`node "${CLI}" org floors set --by x`)).decision, 'ask');
  assert.equal(decide(teams.billing, enforced(teams.billing), bash(`node "${CLI}" org floors`)).decision, 'allow');
  assert.throws(() => saveConfig(teams.billing, enforced(teams.billing)), /floors applied/, 'the tightened configuration is never written back as the team\'s own');
});

test('a session at the organisation root judges each team with the floors applied', () => {
  const { root, teams } = monorepo();
  setFloors(root, ['--protect', 'migrations/**', '--by', 'Dana']);
  laxest(teams.search);
  assert.equal(decideAtOrg(root, write(path.join(teams.search, 'migrations/1.sql'))).decision, 'deny');
  assert.equal(decideAtOrg(root, write(path.join(teams.search, 'src/a.ts'))).decision, 'allow');
});

test('a team with no organisation has no floors: its configuration is enforced exactly as written', () => {
  const root = tmp(); gitInit(root);
  coda(root, 'init', '--name', 'solo', '--verify', 'true');
  const cfg = loadConfig(root);
  assert.equal(withFloors(root, cfg), cfg);
  assert.equal(status(root, enforced(root)).floors, null);
});
