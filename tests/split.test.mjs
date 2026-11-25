import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, readEvents, parseFrontmatter } from '../scripts/lib.mjs';
import { decide, enforced } from '../scripts/hook.mjs';
import { brief } from '../scripts/brief.mjs';
import { orgPath } from '../scripts/org.mjs';
import { monorepo, multirepo, commitAll, coda, CLI, TEAMS } from './sandbox.mjs';

const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, ...extra });
const rec = (root, kind, id, front) => fs.writeFileSync(path.join(root, '.coda', kind, `${id}-x.md`), `---\nid: ${id}\ntitle: ${id} title\n${front}\n---\n# ${id} title\n\nBody of ${id}.\n`);
const INTO = ['--into', 'invoices=../invoices:invoicing,invoice-api', '--into', 'payments=../payments:payments'];

function billingWithHistory() {
  const layout = monorepo();
  const b = layout.teams.billing;
  const cfg = loadConfig(b); cfg.autonomy.level = 'bounded'; cfg.verify.commands = ['npm test']; saveConfig(b, cfg);
  fs.writeFileSync(path.join(b, '.coda/intent.md'), '---\nlevel: team\nversion: 3\nstatus: active\narchitect: Ana\n---\n# Intent\n\n## Purpose\n\nGet shops paid.\n\n## Regrowth signal\n\nTwo shops waiting over a week.\n');
  rec(b, 'decisions', 'D-0001', 'status: decided\nentities: [component:invoice-api, constraint:integer-cents]');
  rec(b, 'decisions', 'D-0002', 'status: decided\nentities: [concept:payments]\ndepends-on: [D-0004]');
  rec(b, 'decisions', 'D-0003', 'status: decided\nentities: [constraint:eu-data]');
  rec(b, 'decisions', 'D-0004', 'status: decided\nentities: [concept:ledger]');
  rec(b, 'decisions', 'D-0005', 'status: superseded\nentities: [concept:payments]');
  rec(b, 'patterns', 'P-0001', 'status: detected\npolarity: negative');
  rec(b, 'patterns', 'P-0002', 'status: resolved');
  return layout;
}

test('the plan of a split says which team inherits which decision and why, and writes nothing', () => {
  const { teams } = billingWithHistory();
  const before = fs.readdirSync(path.dirname(teams.billing));
  const p = JSON.parse(coda(teams.billing, 'split', ...INTO, '--plan').stdout);
  assert.deepEqual(p.inherits.invoices, ['D-0001', 'D-0003', 'D-0004'], 'what names its scope, plus what concerns every new team');
  assert.deepEqual(p.inherits.payments, ['D-0002', 'D-0003', 'D-0004'], 'D-0004 follows D-0002, which depends on it');
  assert.match(p.why['D-0003'], /concerns every new team/);
  assert.ok(!JSON.stringify(p.inherits).includes('D-0005'), 'a superseded decision is not inherited');
  assert.deepEqual(p.openPatternsGoToAll, ['P-0001']);
  const o = JSON.parse(coda(teams.billing, 'split', ...INTO, '--plan', '--assign', 'D-0003=payments').stdout);
  assert.ok(!o.inherits.invoices.includes('D-0003') && o.inherits.payments.includes('D-0003'), 'a human corrects the plan');
  assert.deepEqual(fs.readdirSync(path.dirname(teams.billing)), before);
});

test('a split gives each new team its scope, a draft of its intent and the decisions in force that concern it', () => {
  const { root, teams } = billingWithHistory();
  const r = coda(teams.billing, 'split', ...INTO, '--by', 'Dana');
  assert.equal(r.status, 0, r.stderr);
  for (const [name, carries, inherited] of [['invoices', ['invoicing', 'invoice-api'], ['D-0001', 'D-0003', 'D-0004']], ['payments', ['payments'], ['D-0002', 'D-0003', 'D-0004']]]) {
    const t = path.join(root, 'teams', name);
    const cfg = loadConfig(t);
    assert.deepEqual([cfg.team.name, cfg.team.splitFrom, cfg.team.humans, cfg.scope.domains], [name, 'billing', [], carries]);
    assert.equal(cfg.autonomy.level, 'bounded', 'the level is inherited with the harness that earned it');
    assert.deepEqual(cfg.verify.commands, ['npm test']);
    const intent = parseFrontmatter(fs.readFileSync(path.join(t, '.coda/intent.md'), 'utf8'));
    assert.equal(intent.meta.status, 'draft', 'the intent is theirs to rewrite: never in force as copied');
    assert.match(intent.body, /Get shops paid/);
    assert.deepEqual(fs.readdirSync(path.join(t, '.coda/decisions')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, 6)), inherited);
    assert.match(fs.readFileSync(path.join(t, '.coda/decisions/D-0003-x.md'), 'utf8'), /inherited-from: billing\/D-0003/);
    assert.deepEqual(fs.readdirSync(path.join(t, '.coda/patterns')).filter((f) => f.endsWith('.md')), ['P-0001-x.md'], 'open patterns go to all');
    assert.equal(coda(t, 'graph', '--check').status, 0, `${name}: nothing it inherited points nowhere`);
    assert.match(brief(t, enforced(t)), /## Organisation — Acme/, 'the new team belongs to the same organisation');
  }
});

test('the split is traced in the journal of the team that was split, of each new team, and of the organisation', () => {
  const { root, teams } = billingWithHistory();
  coda(teams.billing, 'split', ...INTO, '--by', 'Dana');
  const source = readEvents(teams.billing, { types: ['team'] }).pop();
  assert.deepEqual([source.type, source.actor, source.data.into.map((t) => t.name)], ['team.split', 'human:Dana', ['invoices', 'payments']]);
  const born = readEvents(path.join(root, 'teams/payments'))[0];
  assert.deepEqual([born.type, born.actor, born.data.splitFrom, born.data.inherited], ['team.created', 'human:Dana', 'billing', ['D-0002', 'D-0003', 'D-0004']]);
  assert.deepEqual(readEvents(root, { base: orgPath(root) }).slice(-3).map((e) => e.type), ['org.team-added', 'org.team-added', 'org.team-split']);
  assert.equal(coda(teams.billing, 'journal', 'add', 'team.split').status, 1, 'the model cannot forge it');
});

test('after a split the organisation lists the new teams, and the old one carries nothing and delivers nothing', () => {
  const { root, teams } = billingWithHistory();
  coda(teams.billing, 'split', ...INTO, '--by', 'Dana');
  const map = JSON.parse(coda(root, 'org', 'map').stdout);
  assert.deepEqual(map.teams.map((t) => t.name), ['catalog', 'search', 'invoices', 'payments']);
  assert.deepEqual(map.overlaps, []);
  assert.equal(enforced(teams.billing).autonomy.level, 'observed');
  assert.match(brief(teams.billing, enforced(teams.billing)), /This team was split into invoices, payments/);
  assert.equal(coda(teams.billing, 'split', ...INTO, '--by', 'Dana').status, 1, 'it cannot be split twice');
  const view = JSON.parse(coda(root, 'org', 'view').stdout);
  assert.deepEqual([view.scopesCarried, view.retired], [4, [{ team: 'billing', splitInto: ['invoices', 'payments'] }]], 'three scopes became four');
});

test('a team can split part of itself off and keep the rest', () => {
  const { root, teams } = billingWithHistory();
  assert.equal(coda(teams.billing, 'split', '--into', 'payments=../payments:payments', '--keep', 'invoicing', '--by', 'Dana').status, 0);
  const cfg = loadConfig(teams.billing);
  assert.deepEqual([cfg.team.retired, cfg.scope.domains], [undefined, ['invoicing']]);
  assert.deepEqual(JSON.parse(coda(root, 'org', 'map').stdout).teams.map((t) => t.name), ['billing', 'catalog', 'search', 'payments']);
});

test('a split is refused when it would leave a scope with two teams, makes one team only, has no named human, or lands on an existing team', () => {
  const { teams } = billingWithHistory();
  const s = (...a) => coda(teams.billing, 'split', ...a);
  assert.match(s('--into', 'a=../a:payments', '--into', 'b=../b:payments', '--by', 'Dana').stderr, /carried by two teams/);
  assert.match(s('--into', 'a=../a:payments', '--by', 'Dana').stderr, /at least two teams/);
  assert.equal(s(...INTO).status, 1, 'no named human');
  assert.match(s('--into', 'a=../catalog:x', '--into', 'b=../b:y', '--by', 'Dana').stderr, /already holds a team/);
  assert.equal(loadConfig(teams.billing).team.retired, undefined, 'nothing was changed by a refused split');
  assert.equal(decide(teams.billing, enforced(teams.billing), bash(`node "${CLI}" split --into a=../a:x --into b=../b:y --by Dana`)).decision, 'ask');
  assert.equal(decide(teams.billing, enforced(teams.billing), bash(`node "${CLI}" split --into a=../a:x --into b=../b:y --plan`)).decision, 'allow');
  assert.equal(decide(teams.billing, enforced(teams.billing), bash(`node "${CLI}" split --into a=../a:x --into b=../b:y --by Dana`, { agent_type: 'coda:coordination' })).decision, 'deny');
});

test('the organisation view shows scopes carried, what is open between teams and who says they are too small — and ranks nobody', () => {
  for (const layout of [monorepo(), { ...multirepo(), multi: true }]) {
    const { org, teams } = layout;
    fs.writeFileSync(path.join(teams.catalog, '.coda/intent.md'), '---\nlevel: team\nstatus: active\n---\n# Intent\n\n## Purpose\n\nCarry the catalog.\n\n## Regrowth signal\n\nMore than five suppliers waiting.\n');
    assert.equal(coda(teams.catalog, 'regrowth', 'raise', '--note', 'Seven suppliers waiting since October').status, 1, 'a named human raises it');
    assert.equal(coda(teams.catalog, 'regrowth', 'raise', '--by', 'Noor').status, 1, 'on evidence');
    assert.equal(coda(teams.catalog, 'regrowth', 'raise', '--by', 'Noor', '--note', 'Seven suppliers waiting since October').status, 0);
    coda(teams.search, 'scope', 'set', '--domain', 'search', '--domain', 'catalog', '--by', 'Dana');
    if (layout.multi) { for (const t of TEAMS) commitAll(teams[t]); assert.equal(coda(org, 'org', 'sync').status, 0); }
    const v = JSON.parse(coda(org, 'org', 'view').stdout);
    assert.equal(v.scopesCarried, 3);
    assert.deepEqual(v.teams.map((t) => t.team), TEAMS, 'in the order the organisation lists them');
    assert.deepEqual(v.regrowthRaised.map((r) => [r.team, r.by, r.note]), [['catalog', 'Noor', 'Seven suppliers waiting since October']]);
    assert.deepEqual(v.betweenTeams.overlaps.map((x) => x.what), ['catalog']);
    assert.deepEqual([v.awaitingDecision.arbiter, v.awaitingDecision.overlaps], ['Dana', 1]);
    assert.ok(v.gaps.some((g) => /"billing" has not named its regrowth signal/.test(g)));
    assert.deepEqual(Object.keys(v.teams[0]).sort(), ['carries', 'intent', 'note', 'readable', 'regrowthRaised', 'regrowthSignal', 'team'], 'only what a team declares: no level, no count, no activity');
    assert.ok(!/rank|score|level|sessions|commits|humans/i.test(JSON.stringify(v)), 'nothing that could be read as a ranking or a headcount');
    const md = coda(org, 'org', 'view', '--format', 'md').stdout;
    assert.match(md, /3 scope\(s\) carried/);
    assert.match(md, /\| catalog \|.*\*\*raised\*\*/);
    assert.match(md, /Teams that say they are too small/);
    assert.equal(coda(teams.catalog, 'regrowth', 'clear', '--by', 'Noor').status, 0);
    assert.equal(loadConfig(teams.catalog).team.regrowth, undefined);
  }
});
