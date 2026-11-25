import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, readEvents } from '../scripts/lib.mjs';
import { decide } from '../scripts/hook.mjs';
import { brief, status } from '../scripts/brief.mjs';
import { orgPath } from '../scripts/org.mjs';
import { monorepo, multirepo, commitAll, coda, hook, CLI, TEAMS } from './sandbox.mjs';

const briefOf = (root) => brief(root, loadConfig(root));
const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, ...extra });
const d = (root, input) => decide(root, loadConfig(root), input).decision;

function teamDecision(teamRoot, id, title, front) {
  fs.writeFileSync(path.join(teamRoot, '.coda/decisions', `${id}-x.md`), `---\nid: ${id}\ntitle: ${title}\ndate: 2026-11-20\ntype: tactical\nstatus: decided\nmaker: Ana (intent-architect)\n${front}\n---\n# ${id} ${title}\n`);
}
function orgDecision(orgDir, id, title, { maker = 'Dana (intent-architect)', teams = '[billing, catalog]', settles = '[]', status = 'decided' } = {}) {
  fs.writeFileSync(orgPath(orgDir, 'decisions', `${id}-x.md`), `---\nid: ${id}\ntitle: ${title}\ndate: 2026-11-21\nstatus: ${status}\nmaker: ${maker}\nteams: ${teams}\nsettles: ${settles}\nentities: [concept:pricing]\n---\n# ${id} ${title}\n\n## Context\nTwo teams disagreed.\n\n## Decision\nPrices are stored tax exclusive everywhere; billing adds tax when invoicing.\n\n## Why\nOne price per product.\n`);
}
function publish(layout) {
  if (!layout.multi) return;
  commitAll(layout.org, 'organisation records');
  for (const t of TEAMS) commitAll(layout.teams[t], 'records');
  for (const t of TEAMS) assert.equal(coda(layout.teams[t], 'org', 'sync').status, 0);
}
const layouts = () => [monorepo(), { ...multirepo(), multi: true }];

test('the organisation\'s intent architect arbitrates between teams unless its rule names someone else, and a named human writes the rule', () => {
  const { root, teams } = monorepo();
  assert.deepEqual(JSON.parse(coda(teams.billing, 'org', 'rule').stdout), { arbiter: 'Dana', explicit: false, rule: null });
  assert.equal(coda(root, 'org', 'rule', 'set', '--rule', 'The team that carries the component decides its interface.').status, 1, 'no rule without a named human');
  assert.equal(coda(root, 'org', 'rule', 'set', '--arbiter', 'Sam', '--rule', 'The team that carries the component decides its interface.', '--by', 'Dana').status, 0);
  assert.deepEqual(JSON.parse(coda(teams.catalog, 'org', 'rule').stdout), { arbiter: 'Sam', explicit: true, rule: 'The team that carries the component decides its interface.' });
  const e = readEvents(root, { base: orgPath(root) }).pop();
  assert.deepEqual([e.type, e.actor], ['org.rule-set', 'human:Dana']);
  assert.equal(coda(teams.billing, 'journal', 'add', 'org.decision-recorded').status, 1, 'the model cannot forge it');
});

test('a decision taken for several teams reaches the brief of each team it names, and of no other', () => {
  for (const layout of layouts()) {
    const { org, teams } = layout;
    orgDecision(org, 'X-0001', 'Prices are tax exclusive across the organisation');
    assert.equal(coda(org, 'org', 'record', 'X-0001', '--by', 'Dana').status, 0);
    publish(layout);
    for (const t of ['billing', 'catalog']) {
      const b = briefOf(teams[t]);
      assert.match(b, /Decisions of the organisation that bind this team/, t);
      assert.match(b, /X-0001 Prices are tax exclusive across the organisation — Prices are stored tax exclusive everywhere; billing adds tax when invoicing\./, t);
    }
    assert.ok(!/X-0001/.test(briefOf(teams.search)), 'search is not named');
    assert.equal(status(teams.billing, loadConfig(teams.billing)).organisation.bindingDecisions.length, 1);

    orgDecision(org, 'X-0002', 'Every public API is versioned', { teams: '[]' });
    publish(layout);
    for (const t of TEAMS) assert.match(briefOf(teams[t]), /X-0002 Every public API is versioned/, `${t}: a decision naming no team binds all`);
    orgDecision(org, 'X-0002', 'Every public API is versioned', { teams: '[]', status: 'superseded' });
    publish(layout);
    assert.ok(!/X-0002/.test(briefOf(teams.search)), 'a superseded decision no longer binds');
  }
});

test('a decision between teams is recorded only if its record exists and names the human who may take it', () => {
  const { root, teams } = monorepo();
  const record = (...a) => coda(root, 'org', 'record', ...a);
  assert.equal(record('X-0001', '--by', 'Dana').status, 1, 'no record yet');
  orgDecision(root, 'X-0001', 'A', { maker: 'Ana (intent-architect of billing)' });
  assert.match(record('X-0001', '--by', 'Ana').stderr, /Dana arbitrates between teams/);
  orgDecision(root, 'X-0001', 'A', { teams: '[billing, ghosts]' });
  assert.match(record('X-0001', '--by', 'Dana').stderr, /ghosts/);
  orgDecision(root, 'X-0001', 'A');
  assert.equal(record('X-0001').status, 1, 'a named human records it');
  assert.equal(record('X-0001', '--by', 'Dana').status, 0);
  const e = readEvents(root, { base: orgPath(root) }).pop();
  assert.deepEqual([e.type, e.actor, e.data.teams], ['org.decision-recorded', 'human:Dana', ['billing', 'catalog']]);
  assert.match(coda(teams.billing, 'org', 'next-id', 'Next one').stdout, /\.coda-org\/decisions\/X-0002-next-one\.md/);
});

test('a team that reads its organisation from a copy cannot record a decision between teams from its own repository', () => {
  const { org, teams } = multirepo();
  orgDecision(org, 'X-0001', 'A'); commitAll(org); coda(teams.billing, 'org', 'sync');
  const r = coda(teams.billing, 'org', 'record', 'X-0001', '--by', 'Dana');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Run this in the organisation's own repository/);
});

test('a contradiction between two teams stays open until a decision of the organisation settles it', () => {
  for (const layout of layouts()) {
    const { org, teams } = layout;
    teamDecision(teams.catalog, 'D-0001', 'Prices are tax exclusive', 'entities: [concept:pricing]');
    teamDecision(teams.billing, 'D-0001', 'Prices are tax inclusive', 'entities: [concept:pricing]\ncontradicts: [catalog/D-0001]');
    publish(layout);
    const b = briefOf(teams.billing);
    assert.match(b, /Open contradiction between teams/);
    assert.match(b, /What two teams cannot settle between them, Dana settles/);
    assert.equal(JSON.parse(coda(teams.search, 'org', 'pending').stdout).contradictions.length, 1);

    orgDecision(org, 'X-0001', 'Prices are tax exclusive across the organisation', { settles: '[billing/D-0001, catalog/D-0001]' });
    assert.equal(coda(org, 'org', 'record', 'X-0001', '--by', 'Dana').status, 0);
    publish(layout);
    assert.ok(!/Open contradiction/.test(briefOf(teams.billing)));
    assert.match(briefOf(teams.catalog), /X-0001 Prices are tax exclusive across the organisation/);
    assert.deepEqual(JSON.parse(coda(teams.search, 'org', 'pending').stdout).contradictions, []);
    assert.equal(coda(teams.search, 'graph', '--org', '--check').status, 0);
  }
});

test('a guardian declared once by the organisation is every team\'s guardian, unless that person is one of the team\'s own humans', () => {
  const { teams } = monorepo();
  let s = status(teams.billing, loadConfig(teams.billing));
  assert.deepEqual([s.entryConditions.guardianOutsideTeam.met, s.entryConditions.guardianOutsideTeam.sharedWithOrganisation], [true, ['Lou']]);
  assert.match(coda(teams.billing, 'doctor').stdout, /✓ role held: ethical-guardian \(Lou, shared by the organisation\)/);
  const cfg = loadConfig(teams.catalog); cfg.team.humans = [{ name: 'Lou', roles: ['sovereign-maker'] }, { name: 'Noor', roles: ['intent-architect'] }]; saveConfig(teams.catalog, cfg);
  s = status(teams.catalog, loadConfig(teams.catalog));
  assert.equal(s.entryConditions.guardianOutsideTeam.met, false, 'nobody audits their own decisions');
});

test('the shared guardian\'s evidence is read from each team\'s audits and records, never from a team\'s journal, and ranks nobody', () => {
  const layout = { ...multirepo(), multi: true };
  const { org, teams } = layout;
  fs.writeFileSync(path.join(teams.search, '.coda/audits/2026-11-20.md'), '---\ndate: 2026-11-20\nperiod: 30d\nviolations: 0\nwarnings: 2\n---\n# Audit\n');
  fs.writeFileSync(path.join(teams.billing, '.coda/audits/2026-11-22.md'), '---\ndate: 2026-11-22\nperiod: 30d\nviolations: 1\nwarnings: 0\n---\n# Audit\n');
  teamDecision(teams.catalog, 'D-0001', 'A big bet', 'entities: []');
  fs.writeFileSync(path.join(teams.catalog, '.coda/decisions/D-0002-x.md'), '---\nid: D-0002\ntitle: Strategy\ntype: strategic\nstatus: decided\nentities: [concept:x]\n---\n# D-0002 Strategy\n');
  publish(layout);
  assert.equal(coda(org, 'org', 'sync').status, 0, 'the organisation refreshes its own copies of the teams');
  const a = JSON.parse(coda(org, 'org', 'audit').stdout);
  assert.deepEqual(a.guardians, ['Lou']);
  assert.deepEqual(a.teams.map((t) => t.team), TEAMS, 'teams come in the order the organisation lists them');
  assert.deepEqual(a.teams.map((t) => t.lastAudit && [t.lastAudit.date, t.lastAudit.violations]), [['2026-11-22', '1'], null, ['2026-11-20', '0']]);
  const catalog = a.teams[1].decisions;
  assert.deepEqual([catalog.withoutEntities, catalog.withoutMaker, catalog.strategicNotSimulated], [['D-0001'], ['D-0002'], ['D-0002']]);
  assert.ok(!JSON.stringify(a).includes('journal'), 'nothing in it comes from a journal');
  assert.ok(!('rank' in a) && !('score' in a));
});

test('guard: recording a decision between teams or changing the rule asks a human; cognitive agents cannot; reading is free', () => {
  const { teams } = monorepo();
  const cfg = loadConfig(teams.billing); cfg.autonomy.level = 'bounded'; saveConfig(teams.billing, cfg);
  assert.equal(d(teams.billing, bash(`node "${CLI}" org record X-0001 --by Dana`)), 'ask');
  assert.equal(d(teams.billing, bash(`node "${CLI}" org rule set --arbiter Me --by Me`)), 'ask');
  assert.equal(d(teams.billing, bash(`node "${CLI}" org record X-0001 --by Dana`, { agent_type: 'coda:coordination' })), 'deny');
  for (const sub of ['pending', 'audit', 'rule', 'next-id']) assert.equal(d(teams.billing, bash(`node "${CLI}" org ${sub}`)), 'allow', sub);
});

test('a session at the organisation root sees what binds its teams and what waits between them', () => {
  const { root, teams } = monorepo();
  orgDecision(root, 'X-0001', 'Prices are tax exclusive across the organisation');
  teamDecision(teams.catalog, 'D-0001', 'A', 'entities: [concept:x]');
  teamDecision(teams.search, 'D-0001', 'B', 'entities: [concept:x]\ncontradicts: [catalog/D-0001]');
  const b = hook(root, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext;
  assert.match(b, /Decisions of the organisation that bind its teams/);
  assert.match(b, /Open contradiction between teams: search\/D-0001 and catalog\/D-0001/);
});
