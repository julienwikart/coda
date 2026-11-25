import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, readEvents, verifyJournal } from '../scripts/lib.mjs';
import { decide } from '../scripts/hook.mjs';
import { brief, status } from '../scripts/brief.mjs';
import { resolveOrg, orgPath } from '../scripts/org.mjs';
import { monorepo, multirepo, tmp, gitInit, commitAll, coda, hook, CLI, TEAMS, ORG_INTENT } from './sandbox.mjs';

const d = (root, input) => decide(root, loadConfig(root), input).decision;
const write = (file, extra = {}) => ({ tool_name: 'Write', tool_input: { file_path: file }, ...extra });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const sessionBrief = (root) => hook(root, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
const CONSTRAINT = 'Customer data never leaves the EU region.';

test('a team with no organisation behaves exactly as before: no section in the brief, nothing in status, same guard', () => {
  const root = tmp(); gitInit(root);
  coda(root, 'init', '--name', 'solo', '--verify', 'true');
  const cfg = loadConfig(root);
  assert.equal(resolveOrg(root, cfg), null);
  assert.ok(!/Organisation/.test(sessionBrief(root)));
  assert.equal(status(root, cfg).organisation, null);
  assert.equal(d(root, write(path.join(root, 'src/a.ts'))), 'ask');
  assert.match(coda(root, 'org', 'status').stdout, /no organisation/);
});

test('one repository: an organisation constraint reaches the brief of every team without anyone copying it', () => {
  const { teams } = monorepo();
  for (const name of TEAMS) {
    const b = sessionBrief(teams[name]);
    assert.match(b, /## Organisation — Acme/, name);
    assert.ok(b.includes(CONSTRAINT), name);
    assert.ok(!fs.readFileSync(path.join(teams[name], '.coda/intent.md'), 'utf8').includes(CONSTRAINT), 'the team intent does not carry a copy');
    assert.ok(b.indexOf('## Organisation') < b.indexOf('## Intent'), 'the organisation comes before the team intent');
  }
});

test('several repositories: the constraint reaches every team, and a change in the organisation arrives at the next refresh', () => {
  const { org, teams } = multirepo();
  for (const name of TEAMS) assert.ok(sessionBrief(teams[name]).includes(CONSTRAINT), name);
  fs.writeFileSync(orgPath(org, 'intent.md'), ORG_INTENT('No dependency without a security review.'));
  commitAll(org);
  assert.ok(brief(teams.billing, loadConfig(teams.billing)).includes(CONSTRAINT), 'reads never fetch on their own');
  assert.equal(coda(teams.billing, 'org', 'sync').status, 0);
  const b = brief(teams.billing, loadConfig(teams.billing));
  assert.ok(b.includes('No dependency without a security review.') && !b.includes(CONSTRAINT));
});

test('organisation unreachable: the last copy still serves and the brief says it may be out of date', () => {
  const { org, teams } = multirepo();
  sessionBrief(teams.catalog);
  fs.renameSync(org, org + '-gone');
  assert.equal(coda(teams.catalog, 'org', 'sync').status, 1);
  const b = brief(teams.catalog, loadConfig(teams.catalog));
  assert.ok(b.includes(CONSTRAINT));
  assert.match(b, /may be out of date/);
});

test('organisation declared but never fetched and unreachable: the session still starts, and the brief says what is missing', () => {
  const root = tmp(); gitInit(root);
  coda(root, 'init', '--name', 'lonely', '--verify', 'true');
  const cfg = loadConfig(root); cfg.org = { repo: path.join(root, 'does-not-exist') }; saveConfig(root, cfg);
  const b = sessionBrief(root);
  assert.match(b, /declares an organisation, but/);
  assert.match(b, /tell the human/);
  assert.match(b, /## Intent/, 'the team keeps working from its own intent');
  assert.equal(status(root, loadConfig(root)).organisation.readable, false);
});

test('an unreadable org.json never breaks a session or the guard', () => {
  const { root, teams } = monorepo();
  fs.writeFileSync(orgPath(root, 'org.json'), '{ not json');
  assert.match(sessionBrief(teams.search), /cannot be read/);
  assert.equal(d(teams.search, write(path.join(teams.search, 'src/a.ts'))), 'ask');
  assert.equal(hook(teams.search, { hook_event_name: 'PreToolUse', ...bash('ls') }), null);
});

test('guard: what the organisation shares is changed by a human at every autonomy level, and its journal by nobody', () => {
  const { root, teams } = monorepo();
  for (const level of ['observed', 'supervised', 'bounded']) {
    const cfg = loadConfig(teams.billing); cfg.autonomy.level = level; cfg.autonomy.perimeter.write = ['**']; saveConfig(teams.billing, cfg);
    assert.equal(d(teams.billing, write(orgPath(root, 'intent.md'))), 'ask', level);
    assert.equal(d(teams.billing, write(orgPath(root, 'org.json'))), 'ask', level);
    assert.equal(d(teams.billing, write(orgPath(root, 'journal/2026-11/x.jsonl'))), 'deny', level);
    assert.equal(d(teams.billing, bash('rm -rf ../../.coda-org/journal')), 'deny', level);
    assert.equal(d(teams.billing, bash("echo '- x' >> ../../.coda-org/intent.md")), level === 'observed' ? 'deny' : 'ask', level);
    assert.equal(d(teams.billing, bash('cat ../../.coda-org/intent.md')), null, level);
    assert.equal(d(teams.billing, bash(`node "${CLI}" org join --path ../.. --by x`)), 'ask', level);
    assert.equal(d(teams.billing, bash(`node "${CLI}" org status`)), 'allow', level);
  }
});

test('guard: the local copy of a remote organisation is read-only', () => {
  const { teams } = multirepo();
  const o = resolveOrg(teams.search, loadConfig(teams.search));
  const cfg = loadConfig(teams.search); cfg.autonomy.level = 'bounded'; cfg.autonomy.perimeter.write = ['**']; saveConfig(teams.search, cfg);
  assert.equal(d(teams.search, write(orgPath(o.dir, 'intent.md'))), 'deny');
});

test('organisation events are written by the harness on a named human\'s decision; the model cannot forge them', () => {
  const { root, teams } = monorepo();
  const events = readEvents(root, { base: orgPath(root) });
  assert.deepEqual(events.map((e) => e.type), ['org.initialized', 'org.team-added', 'org.team-added', 'org.team-added']);
  assert.ok(events.every((e) => e.actor === 'human:Dana'));
  assert.deepEqual(verifyJournal(root, orgPath(root)).problems, []);
  assert.equal(coda(teams.billing, 'journal', 'add', 'org.joined').status, 1);
  assert.equal(coda(tmp(), 'org', 'init', '--name', 'X').status, 1, 'no organisation without a named human');
});

test('joining an organisation that cannot be read changes nothing', () => {
  const root = tmp(); gitInit(root);
  coda(root, 'init', '--name', 'solo');
  assert.equal(coda(root, 'org', 'join', '--repo', path.join(root, 'nope'), '--by', 'Ana').status, 1);
  assert.equal(loadConfig(root).org, null);
});

test('status and doctor say whether the team is known to its organisation', () => {
  const { root, teams } = monorepo();
  const s = status(teams.catalog, loadConfig(teams.catalog)).organisation;
  assert.deepEqual([s.name, s.readable, s.thisTeamRegistered, s.teams.length], ['Acme', true, true, 3]);
  const stray = path.join(root, 'teams', 'stray');
  fs.mkdirSync(stray, { recursive: true }); coda(stray, 'init', '--name', 'stray');
  assert.equal(status(stray, loadConfig(stray)).organisation.thisTeamRegistered, false);
  assert.match(brief(stray, loadConfig(stray)), /not in the organisation's list of teams/);
});
