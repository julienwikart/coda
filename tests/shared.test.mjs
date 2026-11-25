import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../scripts/lib.mjs';
import { brief, status } from '../scripts/brief.mjs';
import { buildGraph } from '../scripts/graph.mjs';
import { resolveOrg, teamsOf } from '../scripts/org.mjs';
import { monorepo, multirepo, commitAll, coda, hook, TEAMS } from './sandbox.mjs';

function decision(teamRoot, id, title, front) {
  fs.writeFileSync(path.join(teamRoot, '.coda/decisions', `${id}-${title.toLowerCase().replace(/\W+/g, '-')}.md`),
    `---\nid: ${id}\ntitle: ${title}\ndate: 2026-11-20\ntype: tactical\nstatus: decided\nmaker: Ana (intent-architect)\n${front}\n---\n# ${id} ${title}\n\n## Decision\n${title}. Prices are stored as integer cents.\n`);
}
// In several repositories a team sees the others through its copies: commit, then refresh them.
function publish(layout) {
  if (!layout.multi) return;
  for (const t of TEAMS) commitAll(layout.teams[t], 'records');
  for (const t of TEAMS) assert.equal(coda(layout.teams[t], 'org', 'sync').status, 0);
}
const layouts = () => [monorepo(), { ...multirepo(), multi: true }];
const briefOf = (root) => brief(root, loadConfig(root));

test('a decision recorded in one team is found from another, in one repository and across several', () => {
  for (const layout of layouts()) {
    const { teams } = layout;
    decision(teams.catalog, 'D-0001', 'Product prices are tax exclusive', 'entities: [component:catalog-api, concept:pricing]');
    publish(layout);
    const byText = coda(teams.billing, 'org', 'decisions', '--grep', 'integer cents').stdout;
    assert.match(byText, /^catalog\/D-0001\tdecided\t2026-11-20\tProduct prices are tax exclusive/m);
    const file = byText.trim().split('\t').pop();
    assert.match(fs.readFileSync(file, 'utf8'), /tax exclusive/, 'the record itself can be read from the other team');
    assert.match(coda(teams.billing, 'org', 'decisions', '--entity', 'pricing').stdout, /catalog\/D-0001/);
    assert.match(coda(teams.billing, 'org', 'decisions', '--entity', 'nothing').stdout, /No decision matches/);
  }
});

test('a team\'s brief carries the decisions other teams took about what it carries, or about what it also decided on', () => {
  for (const layout of layouts()) {
    const { teams } = layout;
    decision(teams.catalog, 'D-0001', 'Catalog reads invoices through the billing API only', 'entities: [component:billing-api]');
    decision(teams.search, 'D-0001', 'Search indexes are rebuilt nightly', 'entities: [process:reindex, constraint:eu-data]');
    decision(teams.billing, 'D-0001', 'Invoices are kept in the EU region', 'entities: [constraint:eu-data]');
    fs.writeFileSync(path.join(teams.search, '.coda/decisions/D-0002-old.md'), '---\nid: D-0002\ntitle: Old\nstatus: superseded\nentities: [component:billing-api]\n---\n# D-0002 Old\n');
    publish(layout);
    const b = layout.multi ? hook(teams.billing, { hook_event_name: 'SessionStart' }).hookSpecificOutput.additionalContext : briefOf(teams.billing);
    assert.match(b, /catalog\/D-0001 Catalog reads invoices through the billing API only — is about component "billing-api", which this team carries/);
    assert.match(b, /search\/D-0001 .* — is about constraint "eu-data", which this team has also decided on/);
    assert.ok(!/search\/D-0002/.test(b), 'a superseded decision is history');
    assert.ok(b.indexOf('catalog/D-0001') < b.indexOf('search/D-0001'), 'what touches the team\'s own scope comes first');
    assert.equal(status(teams.billing, loadConfig(teams.billing)).organisation.acrossTeams.bearingOnThisTeam.length, 2);
    assert.match(coda(teams.billing, 'org', 'decisions', '--bearing').stdout, /catalog\/D-0001[\s\S]*search\/D-0001/);
  }
});

test('two decisions in force in different teams that contradict each other are reported to both, and only to them', () => {
  for (const layout of layouts()) {
    const { teams } = layout;
    decision(teams.catalog, 'D-0001', 'Prices are tax exclusive', 'entities: [concept:pricing]');
    decision(teams.billing, 'D-0001', 'Prices are tax inclusive', 'entities: [concept:pricing]\ncontradicts: [catalog/D-0001]');
    publish(layout);
    assert.deepEqual(buildGraph(teams.billing).problems, [], 'a link to another team is not an error in the team\'s own graph');
    const check = coda(teams.search, 'graph', '--org', '--check');
    assert.equal(check.status, 1);
    assert.match(check.stdout, /open contradiction between teams: billing\/D-0001 and catalog\/D-0001/);
    for (const t of ['billing', 'catalog']) assert.match(briefOf(teams[t]), /Open contradiction between teams: billing\/D-0001 and catalog\/D-0001/, t);
    assert.ok(!/Open contradiction/.test(briefOf(teams.search)));
    assert.equal(status(teams.catalog, loadConfig(teams.catalog)).organisation.acrossTeams.contradictions.length, 1);
  }
});

test('the same constraint met three times across more than one team is surfaced, with the same rule of three as inside a team', () => {
  const { root, teams } = monorepo();
  decision(teams.billing, 'D-0001', 'A', 'entities: [constraint:legal-review]');
  decision(teams.catalog, 'D-0001', 'B', 'entities: [constraint:legal-review]');
  let g = JSON.parse(coda(root, 'graph', '--org').stdout);
  assert.deepEqual(g.recurring, [], 'two occurrences are not a pattern');
  decision(teams.search, 'D-0001', 'C', 'entities: [constraint:legal-review]');
  g = JSON.parse(coda(root, 'graph', '--org').stdout);
  assert.deepEqual(g.recurring, [{ entity: 'constraint:legal-review', teams: ['billing', 'catalog', 'search'], decisions: ['billing/D-0001', 'catalog/D-0001', 'search/D-0001'] }]);
  assert.match(coda(teams.billing, 'graph', '--org', '--around', 'legal-review', '--format', 'mermaid').stdout, /catalog_D_0001\[/);
});

test('a link to a decision no readable team holds is reported, not silently dropped', () => {
  const { teams } = monorepo();
  decision(teams.billing, 'D-0001', 'A', 'entities: [concept:x]\nrelated: [catalog/D-0099]');
  const r = coda(teams.billing, 'graph', '--org', '--check');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /billing\/D-0001: related names catalog\/D-0099, which no readable team holds/);
});

test('copies of other teams hold their declarations and records, never their journals or their code', () => {
  const layout = { ...multirepo(), multi: true };
  const { teams } = layout;
  fs.mkdirSync(path.join(teams.catalog, 'src')); fs.writeFileSync(path.join(teams.catalog, 'src/secret.js'), 'x');
  decision(teams.catalog, 'D-0001', 'A', 'entities: [concept:x]');
  hook(teams.catalog, { hook_event_name: 'SessionStart' });
  assert.ok(fs.readdirSync(path.join(teams.catalog, '.coda/journal')).length > 0, 'catalog does have a journal');
  publish(layout);
  const cfg = loadConfig(teams.billing);
  const catalog = teamsOf(resolveOrg(teams.billing, cfg), { selfRoot: teams.billing, selfName: 'billing' }).find((t) => t.name === 'catalog');
  assert.ok(fs.existsSync(path.join(catalog.dir, '.coda/config.json')));
  assert.equal(fs.readdirSync(path.join(catalog.dir, '.coda/decisions')).filter((f) => f.endsWith('.md')).length, 1);
  assert.ok(!fs.existsSync(path.join(catalog.dir, '.coda/journal')), 'no journal crosses teams');
  assert.ok(!fs.existsSync(path.join(catalog.dir, 'src')), 'no code either');
});

test('a team that cannot be read does not break the others\' view', () => {
  const { root, teams } = monorepo();
  decision(teams.catalog, 'D-0001', 'A', 'entities: [component:billing-api]');
  fs.writeFileSync(path.join(teams.search, '.coda/config.json'), '{ broken');
  assert.match(briefOf(teams.billing), /catalog\/D-0001/);
  assert.match(briefOf(teams.billing), /search — not readable/);
  assert.match(coda(root, 'graph', '--org', '--check').stdout, /team "search" could not be read/);
});
