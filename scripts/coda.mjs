#!/usr/bin/env node
// CODA command line. Used by the skills, by humans, and by any harness that is
// not Claude Code (see docs/harness-contract.md).
import fs from 'node:fs';
import path from 'node:path';
import {
  findRoot, codaPath, loadConfig, saveConfig, appendEvent, readEvents, verifyJournal,
  nextId, slugify, listRecords, intentSummary, fingerprint, loadVerified, saveVerified, runVerify,
  DEFAULT_CONFIG, LEVELS, ROLES, CODA_DIR, git, cliSession,
} from './lib.mjs';
import { brief, status } from './brief.mjs';
import { resolveOrg, orgFacts, findOrgRoot, loadOrgFile, orgPath, parseHuman, orgAt, teamsOf, overlaps, scopeProblems, arbitration, orgGuardians, orgDecisions, arbitrationProblems, withFloors, normaliseFloors, orgView, viewMarkdown, ORG_DIR } from './org.mjs';
import { parseInto, planSplit, createTeam, hasTeam } from './split.mjs';
import { buildGraph, buildOrgGraph, bearingOn, neighbourhood, toMermaid, toMarkdown, parseEntity, ENTITY_TYPES, LINK_TYPES } from './graph.mjs';

// Events only the harness may write: a model must not be able to claim that
// verification passed or that a human changed the autonomy level.
const RESERVED = ['session', 'run', 'tool', 'guard', 'verify', 'review', 'autonomy', 'coda', 'org', 'scope', 'team'];

const USAGE = `coda — cognitive orchestration for delivery agents

  coda init [--name <team>] [--level observed|supervised|bounded] [--by <human>]
            [--verify "<cmd>"]... [--human "<name>=<role>,<role>[,external]"]...
            [--write "<glob>"]... [--protect "<glob>"]...
  coda brief                         the context every session starts from
  coda status                        facts about the team's state, as JSON
  coda next-id decisions|patterns [title]
  coda graph [--around <id|entity>] [--format json|mermaid|entities] [--check] [--write]
                                     the knowledge graph, derived from the records
  coda org init --name <organisation> --by <human> [--human "<name>=<role>,…"]...
  coda org add-team --name <team> (--path <dir> | --repo <git url>) --by <human>
  coda org join (--path <dir> | --repo <git url> [--ref <branch>]) --by <human>
  coda org status | sync             the organisation this team belongs to; refresh its local copies
  coda org decisions [--entity <e>] [--grep <text>] [--bearing] [--all]
                                     decisions in force in every team (--bearing: those that bear on this one)
  coda graph --org [--around <id|entity>] [--format …] [--check]
                                     the graph across teams: shared entities, contradictions, recurrences
  coda org rule [set --by <human> --arbiter <name> --rule "<criterion>"]
                                     who settles what two teams cannot settle between them
  coda org next-id [title] | record <X-id> --by <human>
                                     a decision taken for several teams, kept with the organisation
  coda org floors [set --by <human> [--protect <glob>]... [--deny-command <c>]... [--ask-command <c>]...
                  [--verify "<cmd>"]... [--require-review] [--max-level <level>]]
                                     what every team's harness must at least enforce
  coda org view [--format md]        scopes carried, what is open between teams, who says they are too small
  coda split --into "<team>=<dir>:<carries,…>"... --by <human> [--plan] [--assign <D-id>=<team,…>]...
             [--keep "<carries,…>"]   split this team into sandwich teams; --plan shows who inherits what
  coda regrowth [raise --by <human> --note "<what fired>" | clear --by <human>]
  coda org pending | audit           what waits between teams; evidence for a shared guardian
  coda org map | check               who carries what; overlaps and gaps (check exits 1 on an overlap)
  coda scope                         what this team declares it carries
  coda scope set --by <human> [--domain <d>]... [--component <c>]... [--path <glob>]...
  coda journal add <type> [--data '<json>'] [--actor <who>]
  coda journal tail [n] | query [--since <iso|Nd>] [--type <prefix>] | verify
  coda verify [--force]              run the verification commands (skipped if this exact state already passed)
  coda level <level> --by <human> --reason "<why>"
  coda doctor                        check that the harness is really in place
`;

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
      opt[k] = k in opt ? [].concat(opt[k], v) : v;
    } else pos.push(a);
  }
  return { pos, opt };
}

const list = (v) => [].concat(v ?? []).filter((x) => x !== true).map(String);

function fail(msg) { process.stderr.write(`coda: ${msg}\n`); process.exit(1); }

function needRoot() {
  const root = findRoot(process.cwd());
  if (!root) fail('no .coda/ found here or above. Run `coda init` (or /coda:init) at the project root first.');
  return root;
}

const INTENT_TEMPLATE = `---
level: team
version: 0
status: draft
architect:
updated:
---
# Intent

## Purpose

<!-- One or two sentences: why this team and this product exist. -->

## Objectives

<!-- 3 to 5, each with a measure and a horizon. -->

## Non-negotiable constraints

<!-- Legal, ethical, business. What cannot be traded away, whatever happens. Agents receive these with every brief. -->

## Out of scope

<!-- What this team does not do. -->

## Success criteria

<!-- How we will know. -->

## Regrowth signal

<!-- Fixed in advance: the observable signal that means this team is too small and must grow again. -->
`;

function init(opt) {
  const root = process.cwd();
  if (fs.existsSync(codaPath(root, 'config.json'))) fail('.coda/config.json already exists — this project is already initialised.');
  const level = opt.level || 'supervised';
  if (!LEVELS.includes(level)) fail(`unknown level "${level}". Use one of: ${LEVELS.join(', ')}.`);
  for (const d of ['decisions', 'patterns', 'audits', 'journal']) fs.mkdirSync(codaPath(root, d), { recursive: true });
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.team.name = opt.name === true ? '' : opt.name || path.basename(root);
  cfg.autonomy.level = level;
  cfg.autonomy.since = new Date().toISOString();
  cfg.verify.commands = list(opt.verify);
  if (level === 'bounded' && (!cfg.verify.commands.length || !opt.by || opt.by === true))
    fail('starting at bounded autonomy needs --verify and --by <human>: it is a delegation a named human takes responsibility for.');
  for (const h of list(opt.human)) {
    const [name, spec = ''] = h.split('=');
    const parts = spec.split(',').map((x) => x.trim()).filter(Boolean);
    const roles = parts.filter((x) => x !== 'external');
    const unknown = roles.filter((r) => !ROLES.includes(r));
    if (!name.trim() || unknown.length) fail(`--human "${h}": expected "<name>=<role>,<role>[,external]" with roles among ${ROLES.join(', ')}.`);
    cfg.team.humans.push({ name: name.trim(), roles, ...(parts.includes('external') ? { external: true } : {}) });
  }
  if (list(opt.write).length) cfg.autonomy.perimeter.write = list(opt.write);
  cfg.autonomy.perimeter.protected = [...new Set([...cfg.autonomy.perimeter.protected, ...list(opt.protect)])];
  saveConfig(root, cfg);
  fs.writeFileSync(codaPath(root, 'intent.md'), INTENT_TEMPLATE);
  fs.writeFileSync(codaPath(root, '.gitignore'), '.state/\n*.lock\n');
  for (const d of ['decisions', 'patterns', 'audits']) fs.writeFileSync(codaPath(root, d, '.gitkeep'), '');
  appendEvent(root, { type: 'coda.initialized', session: cliSession(root), actor: opt.by && opt.by !== true ? `human:${opt.by}` : 'harness', data: { level, verify: cfg.verify.commands, humans: cfg.team.humans.length } });
  console.log(`Initialised ${CODA_DIR}/ — autonomy level: ${level}; verification: ${cfg.verify.commands.join(', ') || 'none yet'}.`);
}

const who = (opt) => { if (!opt.by || opt.by === true) fail('--by <human> is required: a named human decides this.'); return String(opt.by); };

function org(pos, opt) {
  const sub = pos[0];
  if (sub === 'init') {
    const dir = process.cwd();
    if (fs.existsSync(orgPath(dir, 'org.json'))) fail(`${ORG_DIR}/org.json already exists here.`);
    if (!opt.name || opt.name === true) fail('--name <organisation> is required.');
    const by = who(opt);
    const humans = list(opt.human).map((h) => parseHuman(h) || fail(`--human "${h}": expected "<name>=<role>,<role>" with roles among ${ROLES.join(', ')}.`));
    fs.mkdirSync(orgPath(dir, 'decisions'), { recursive: true });
    fs.writeFileSync(orgPath(dir, 'org.json'), JSON.stringify({ version: 1, name: String(opt.name), humans, teams: [] }, null, 2) + '\n');
    fs.writeFileSync(orgPath(dir, 'intent.md'), INTENT_TEMPLATE.replace('level: team', 'level: organization').replace('why this team and this product exist', 'why this organisation exists').replace(/\n## Regrowth signal[\s\S]*$/, '\n'));
    fs.writeFileSync(orgPath(dir, 'decisions', '.gitkeep'), '');
    fs.writeFileSync(orgPath(dir, '.gitignore'), '*.lock\n.state/\n');
    appendEvent(dir, { type: 'org.initialized', actor: `human:${by}`, session: cliSession(dir), base: orgPath(dir), data: { name: String(opt.name) } });
    console.log(`Initialised ${ORG_DIR}/ for "${opt.name}". Next: write ${ORG_DIR}/intent.md, then register each team with \`coda org add-team\`.`);
  } else if (sub === 'add-team') {
    const dir = findOrgRoot(process.cwd()) || fail(`no ${ORG_DIR}/ found here or above. Run this in the organisation's repository.`);
    const loaded = loadOrgFile(dir); if (loaded.error) fail(loaded.error);
    if (!opt.name || opt.name === true) fail('--name <team> is required.');
    const where = opt.path && opt.path !== true ? { path: String(opt.path) } : opt.repo && opt.repo !== true ? { repo: String(opt.repo) } : fail('give --path <dir> (same repository) or --repo <git url>.');
    if (loaded.org.teams.some((t) => t.name === opt.name)) fail(`a team named "${opt.name}" is already registered.`);
    const by = who(opt);
    loaded.org.teams.push({ name: String(opt.name), ...where });
    fs.writeFileSync(orgPath(dir, 'org.json'), JSON.stringify(loaded.org, null, 2) + '\n');
    appendEvent(dir, { type: 'org.team-added', actor: `human:${by}`, session: cliSession(dir), base: orgPath(dir), data: { team: String(opt.name), ...where } });
    console.log(`Team "${opt.name}" registered in ${loaded.org.name}.`);
  } else if (sub === 'join') {
    const root = needRoot();
    const cfg = loadConfig(root); if (cfg._error) fail(cfg._error);
    const link = opt.repo && opt.repo !== true ? { repo: String(opt.repo), ...(opt.ref && opt.ref !== true ? { ref: String(opt.ref) } : {}) } : opt.path && opt.path !== true ? { path: String(opt.path) } : fail('give --path <dir> or --repo <git url>.');
    const by = who(opt);
    const o = resolveOrg(root, { ...cfg, org: link }, { refresh: 'now', timeoutMs: 60000 });
    if (o.error) fail(`${o.error}. Nothing was changed.`);
    cfg.org = link; saveConfig(root, cfg);
    appendEvent(root, { type: 'org.joined', actor: `human:${by}`, session: cliSession(root), data: { organisation: o.name, ...link } });
    console.log(`Joined ${o.name}.${o.team ? '' : ` This team ("${cfg.team.name}") is not in its list of teams yet: someone of the organisation runs \`coda org add-team --name "${cfg.team.name}" …\` there.`}`);
  } else if ((sub === 'status' || sub === 'sync') && !findRoot(process.cwd()) && findOrgRoot(process.cwd())) {
    // From the organisation's own root: the same facts, seen from no team in particular.
    const o = orgAt(findOrgRoot(process.cwd()));
    if (o.error) fail(o.error);
    const teams = teamsOf(o, { refresh: sub === 'sync' ? 'now' : 'never', timeoutMs: 60000 });
    console.log(JSON.stringify({ name: o.name, source: 'local', humans: o.org.humans, arbitration: arbitration(o.org), guardians: orgGuardians(o.org).map((h) => h.name), teams: teams.map(({ name, where, readable, note, fetchedAt, scope }) => ({ name, where, readable, note, fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null, scope })), overlaps: overlaps(teams), problems: scopeProblems(teams) }, null, 2));
    if (sub === 'sync' && teams.some((t) => !t.readable)) process.exit(1);
  } else if (sub === 'status' || sub === 'sync') {
    const root = needRoot();
    const facts = orgFacts(root, loadConfig(root), { refresh: sub === 'sync' ? 'now' : 'never', timeoutMs: 60000 });
    if (!facts) { console.log('This team belongs to no organisation.'); return; }
    console.log(JSON.stringify(facts, null, 2));
    if (sub === 'sync' && facts.fetchError) process.exit(1);
  } else if (sub === 'map' || sub === 'check') {
    // Works from inside a team and from the organisation's own root.
    const root = findRoot(process.cwd());
    const cfg = root ? loadConfig(root) : null;
    const o = root ? resolveOrg(root, cfg, { refresh: 'never' }) : (() => { const dir = findOrgRoot(process.cwd()); return dir ? orgAt(dir) : null; })();
    if (!o) fail('no organisation here: this is neither a team that belongs to one nor an organisation\'s root.');
    if (o.error) fail(o.error);
    const teams = teamsOf(o, { selfRoot: root, selfName: cfg?.team?.name });
    const clash = overlaps(teams); const problems = scopeProblems(teams);
    if (sub === 'map') { console.log(JSON.stringify({ organisation: o.name, teams: teams.map(({ name, isSelf, where, readable, note, scope }) => ({ name, isSelf, where, readable, note, scope })), overlaps: clash, problems }, null, 2)); return; }
    for (const v of clash) console.log(`overlap: ${v.teams.join(' and ')} both declare the ${v.kind} "${v.what}"`);
    for (const p of problems) console.log(`gap: ${p}`);
    if (clash.length) process.exit(1);
    console.log(`${teams.length} team(s), no overlap${problems.length ? `, ${problems.length} gap(s) above` : ''}.`);
  } else if (sub === 'decisions') {
    // What every team has decided, for the memory agent and for /coda:recall. Records only — never journals.
    const { o, teams, cfg } = orgContext();
    const g = buildOrgGraph(teams, orgDecisions(o));
    const me = teams.find((t) => t.isSelf);
    const wantEntity = opt.entity && opt.entity !== true ? (parseEntity(opt.entity).id || slugify(opt.entity)) : null;
    const grep = opt.grep && opt.grep !== true ? String(opt.grep).toLowerCase() : null;
    const bearing = opt.bearing && me ? new Set(bearingOn(g, cfg.team.name, me.scope).map((d) => d.id)) : null;
    const rows = g.nodes.filter((n) => n.kind === 'decision' && (opt.all || !['superseded', 'cancelled', 'rejected'].includes(n.status))).filter((n) => {
      if (bearing && !bearing.has(n.id)) return false;
      const ents = g.edges.filter((e) => e.type === 'mentions' && e.from === n.id).map((e) => e.to);
      if (wantEntity && !ents.some((id) => id === wantEntity || id.split(':')[1] === wantEntity)) return false;
      if (grep) { let text = n.title; try { text += fs.readFileSync(n.file, 'utf8'); } catch { /* title only */ } if (!text.toLowerCase().includes(grep)) return false; }
      return true;
    });
    for (const n of rows) console.log(`${n.id}\t${n.status}\t${n.date}\t${n.title}\t${g.edges.filter((e) => e.type === 'mentions' && e.from === n.id).map((e) => e.to).join(',')}\t${n.file}`);
    if (!rows.length) console.log('No decision matches.');
  } else if (sub === 'rule') {
    // Who settles what two teams cannot settle between them. Written once, for the whole organisation.
    const { o } = orgContext();
    if (pos[1] !== 'set') { console.log(JSON.stringify(arbitration(o.org), null, 2)); return; }
    const dir = writableOrg(o);
    const by = who(opt);
    const next = { ...(o.org.arbitration || {}) };
    if (opt.arbiter && opt.arbiter !== true) next.arbiter = String(opt.arbiter);
    if (opt.rule && opt.rule !== true) next.rule = String(opt.rule);
    if (!next.arbiter && !next.rule) fail('give --arbiter "<name>" and/or --rule "<the criterion>".');
    o.org.arbitration = next;
    fs.writeFileSync(orgPath(dir, 'org.json'), JSON.stringify(o.org, null, 2) + '\n');
    appendEvent(dir, { type: 'org.rule-set', actor: `human:${by}`, session: cliSession(dir), base: orgPath(dir), data: next });
    const a = arbitration(o.org);
    console.log(`Between teams, ${a.arbiter || 'nobody yet'} arbitrates${a.rule ? `: ${a.rule}` : ''}.`);
  } else if (sub === 'floors') {
    // What every team's harness must at least enforce. A team may be stricter, never laxer.
    const { o } = orgContext();
    if (pos[1] !== 'set') { console.log(JSON.stringify(normaliseFloors(o.org.floors), null, 2)); return; }
    const dir = writableOrg(o);
    const by = who(opt);
    if (opt['max-level'] && opt['max-level'] !== true && !LEVELS.includes(opt['max-level'])) fail(`unknown level "${opt['max-level']}". Use one of: ${LEVELS.join(', ')}.`);
    // The whole set is stated each time, so that what is in force can be read in one place.
    const next = normaliseFloors({ protected: list(opt.protect), denyCommands: list(opt['deny-command']), askCommands: list(opt['ask-command']), verify: { commands: list(opt.verify), requireReview: opt['require-review'] === true }, maxLevel: opt['max-level'] });
    const before = normaliseFloors(o.org.floors);
    o.org.floors = next;
    fs.writeFileSync(orgPath(dir, 'org.json'), JSON.stringify(o.org, null, 2) + '\n');
    appendEvent(dir, { type: 'org.floors-set', actor: `human:${by}`, session: cliSession(dir), base: orgPath(dir), data: { before, after: next } });
    console.log(`Floors of ${o.name} set by ${by}. They apply to every team from its next tool call${o.source === 'local' ? '' : ' after a refresh'}.`);
  } else if (sub === 'next-id') {
    const { o } = orgContext();
    const id = nextId(null, 'decisions', 'X-', orgPath(o.dir));
    console.log(pos[1] ? path.join(orgPath(o.dir, 'decisions'), `${id}-${slugify(pos.slice(1).join(' '))}.md`) : id);
  } else if (sub === 'record') {
    // The journal says a decision between teams was taken only if its record exists and names who may take it.
    const { o } = orgContext();
    const dir = writableOrg(o);
    const by = who(opt);
    const d = orgDecisions(o).find((x) => x.id === pos[1]) || fail(`no record with id ${pos[1] || '(none given)'} in ${ORG_DIR}/decisions/ — write the record first.`);
    const { arbiter } = arbitration(o.org);
    if (!arbiter) fail('nobody arbitrates between teams yet: declare an intent architect for the organisation, or `coda org rule set --arbiter "<name>"`.');
    const maker = String(d.meta.maker || '');
    if (!maker.toLowerCase().includes(arbiter.toLowerCase())) fail(`${d.id} names "${maker || 'nobody'}" as its maker, but ${arbiter} arbitrates between teams. A decision between teams is taken by the human the organisation's rule names.`);
    const unknown = d.teams.filter((t) => t !== 'all' && !o.org.teams.some((x) => x.name === t));
    if (unknown.length) fail(`${d.id} names team(s) the organisation does not list: ${unknown.join(', ')}.`);
    appendEvent(dir, { type: 'org.decision-recorded', actor: `human:${by}`, session: cliSession(dir), base: orgPath(dir), data: { id: d.id, maker, teams: d.teams, settles: d.settles } });
    console.log(`${d.id} recorded. It binds ${d.teams.length && !d.teams.includes('all') ? d.teams.join(', ') : 'every team'} and reaches their briefs at their next session.`);
  } else if (sub === 'view') {
    const { o, teams } = orgContext();
    const v = orgView(o, teams);
    console.log(opt.format === 'md' ? viewMarkdown(v) : JSON.stringify(v, null, 2));
  } else if (sub === 'pending') {
    // What is waiting for the humans between teams. Facts, in the order the teams are listed; nothing is ranked.
    const { o, teams } = orgContext();
    const decided = orgDecisions(o);
    const g = buildOrgGraph(teams, decided);
    console.log(JSON.stringify({ arbitration: arbitration(o.org), contradictions: g.betweenTeams, overlaps: overlaps(teams), recurring: g.recurring, problems: [...arbitrationProblems(o, decided), ...scopeProblems(teams)] }, null, 2));
  } else if (sub === 'audit') {
    // Evidence for a guardian shared by several teams. Each team's own audit stays the source for what
    // its agents did: this reads the audits and the records, never a team's journal.
    const { o, teams } = orgContext();
    const decided = orgDecisions(o);
    const g = buildOrgGraph(teams, decided);
    const perTeam = teams.map((t) => {
      if (!t.dir) return { team: t.name, readable: false, note: t.note };
      const audits = listRecords(t.dir, 'audits');
      const last = audits[audits.length - 1];
      const decisions = listRecords(t.dir, 'decisions');
      return {
        team: t.name, readable: true,
        lastAudit: last ? { file: path.join(t.dir, last.file), date: last.meta.date || path.basename(last.file, '.md'), violations: last.meta.violations ?? null, warnings: last.meta.warnings ?? null } : null,
        decisions: { total: decisions.length, withoutMaker: decisions.filter((d) => !d.meta.maker).map((d) => d.id), withoutEntities: decisions.filter((d) => !d.meta.entities || !String(d.meta.entities).length).map((d) => d.id), strategicNotSimulated: decisions.filter((d) => String(d.meta.type).toLowerCase() === 'strategic' && String(d.meta.simulated) !== 'true').map((d) => d.id) },
      };
    });
    console.log(JSON.stringify({ organisation: o.name, guardians: orgGuardians(o.org).map((h) => h.name), arbitration: arbitration(o.org), teams: perTeam, betweenTeams: { contradictions: g.betweenTeams, overlaps: overlaps(teams) }, organisationDecisions: { total: decided.length, problems: arbitrationProblems(o, decided) } }, null, 2));
  } else fail('org: use init, add-team, join, status, sync, map, check, view, decisions, rule, floors, next-id, record, pending or audit.');
}

/** The organisation's directory when it can be written from here: never through a read-only copy. */
function writableOrg(o) {
  if (o.source === 'remote') fail(`this team reads the organisation from ${o.location}. Run this in the organisation's own repository; it reaches the teams at their next refresh.`);
  return o.dir;
}

/** The organisation and its teams, from inside a team or from the organisation's own root. */
function orgContext() {
  const root = findRoot(process.cwd());
  const cfg = root ? loadConfig(root) : null;
  const o = root ? resolveOrg(root, cfg, { refresh: 'never' }) : (() => { const dir = findOrgRoot(process.cwd()); return dir ? orgAt(dir) : null; })();
  if (!o) fail('no organisation here: this is neither a team that belongs to one nor an organisation\'s root.');
  if (o.error) fail(o.error);
  return { o, root, cfg, teams: teamsOf(o, { selfRoot: root, selfName: cfg?.team?.name }) };
}

/** Split this team into several sandwich teams. */
function split(root, opt) {
  const cfg = loadConfig(root); if (cfg._error) fail(cfg._error);
  if (cfg.team.retired) fail('this team was already split.');
  const intos = list(opt.into).map((s) => { const t = parseInto(s); if (t.error) fail(`--into ${t.error}`); return t; });
  if (intos.length < (opt.keep ? 1 : 2)) fail('a split makes at least two teams: give --into twice, or once with --keep "<what this team keeps>".');
  if (new Set(intos.map((t) => t.name)).size !== intos.length || intos.some((t) => t.name === cfg.team.name)) fail('each new team needs a name of its own.');
  const overrides = Object.fromEntries(list(opt.assign).map((a) => { const [id, to = ''] = a.split('='); return [id, to.split(',').map((x) => x.trim()).filter(Boolean)]; }));
  const plan = planSplit(root, intos, overrides);
  const kept = opt.keep && opt.keep !== true ? [...new Set(String(opt.keep).split(',').map((x) => slugify(x)).filter(Boolean))] : null;
  const claimed = [...intos.flatMap((t) => t.carries.map((c) => [c, t.name])), ...(kept || []).map((c) => [c, cfg.team.name])];
  const twice = claimed.filter(([c, n], i) => claimed.some(([c2, n2], j) => j !== i && c2 === c && n2 !== n)).map(([c]) => c);
  if (twice.length) fail(`"${[...new Set(twice)].join('", "')}" would be carried by two teams. A split gives each scope to one team.`);
  if (opt.plan) { console.log(JSON.stringify({ from: cfg.team.name, into: intos, keeps: kept, inherits: plan.teams, why: plan.why, openPatternsGoToAll: plan.patterns }, null, 2)); return; }
  const by = who(opt);
  for (const t of intos) { t.root = path.resolve(root, t.dir); if (hasTeam(t.root)) fail(`${t.dir} already holds a team.`); }
  const when = new Date().toISOString();
  let o = null; try { o = resolveOrg(root, cfg, { refresh: 'never' }); } catch { /* split without an organisation */ }
  const orgWritable = o && !o.error && o.source === 'local';
  for (const t of intos) {
    createTeam(root, cfg, t.root, t, plan, when);
    appendEvent(t.root, { type: 'team.created', actor: `human:${by}`, session: cliSession(root), data: { splitFrom: cfg.team.name, carries: t.carries, inherited: plan.teams[t.name], level: cfg.autonomy.level } });
    if (orgWritable) {
      const rel = path.relative(o.dir, t.root);
      if (!rel.startsWith('..') && !o.org.teams.some((x) => x.name === t.name)) { o.org.teams.push({ name: t.name, path: rel.split(path.sep).join('/') }); appendEvent(o.dir, { type: 'org.team-added', actor: `human:${by}`, session: cliSession(root), base: orgPath(o.dir), data: { team: t.name, path: rel, splitFrom: cfg.team.name } }); }
    }
  }
  if (kept) cfg.scope = { ...cfg.scope, domains: kept, components: [] };
  else { cfg.team.retired = true; cfg.team.splitInto = intos.map((t) => t.name); cfg.scope = { domains: [], components: [], paths: [] }; }
  saveConfig(root, cfg);
  appendEvent(root, { type: 'team.split', actor: `human:${by}`, session: cliSession(root), data: { into: intos.map((t) => ({ name: t.name, carries: t.carries, inherited: plan.teams[t.name] })), keeps: kept } });
  if (orgWritable) {
    const me = o.org.teams.find((x) => x.name === cfg.team.name);
    if (me && !kept) { me.retired = true; me.splitInto = intos.map((t) => t.name); }
    fs.writeFileSync(orgPath(o.dir, 'org.json'), JSON.stringify(o.org, null, 2) + '\n');
    appendEvent(o.dir, { type: 'org.team-split', actor: `human:${by}`, session: cliSession(root), base: orgPath(o.dir), data: { team: cfg.team.name, into: intos.map((t) => t.name), keeps: kept } });
  }
  console.log(`${cfg.team.name} split into ${intos.map((t) => `${t.name} (${plan.teams[t.name].length} decision(s) inherited)`).join(', ')}${kept ? `; ${cfg.team.name} keeps ${kept.join(', ')}` : `; ${cfg.team.name} carries nothing any more and its records stay as history`}.`);
  console.log('Each new team starts with a draft intent and no humans declared: its two humans write the intent (/coda:intent) and are added to its config. The code is not moved for you.');
  if (o && !orgWritable) console.log(`The organisation is read from ${o.location || 'elsewhere'}: register the new teams there with \`coda org add-team\`.`);
}

/** The team's humans say that the signal named in their intent has fired. A declaration, so other teams and the organisation can see it. */
function regrowth(root, pos, opt) {
  const cfg = loadConfig(root); if (cfg._error) fail(cfg._error);
  if (!pos[0]) { console.log(JSON.stringify({ signal: intentSummary(root)?.regrowth || null, raised: cfg.team.regrowth || null }, null, 2)); return; }
  const by = who(opt);
  if (pos[0] === 'raise') {
    if (!opt.note || opt.note === true) fail('--note "<what was observed>" is required: the signal fires on evidence.');
    cfg.team.regrowth = { raised: new Date().toISOString(), by, note: String(opt.note) };
  } else if (pos[0] === 'clear') delete cfg.team.regrowth;
  else fail('regrowth: use raise or clear.');
  saveConfig(root, cfg);
  appendEvent(root, { type: pos[0] === 'raise' ? 'team.regrowth-raised' : 'team.regrowth-cleared', actor: `human:${by}`, session: cliSession(root), data: pos[0] === 'raise' ? { note: String(opt.note) } : {} });
  console.log(pos[0] === 'raise' ? `Regrowth signal raised by ${by}. It shows in the organisation's view until it is cleared.` : 'Regrowth signal cleared.');
}

function scope(root, pos, opt) {
  const cfg = loadConfig(root); if (cfg._error) fail(cfg._error);
  if (pos[0] !== 'set') { console.log(JSON.stringify(cfg.scope, null, 2)); return; }
  const by = who(opt);
  const next = { domains: list(opt.domain).map(slugify), components: list(opt.component).map(slugify), paths: list(opt.path).length ? list(opt.path) : cfg.scope.paths };
  if (!next.domains.length && !next.components.length) fail('declare at least one --domain or --component.');
  cfg.scope = next; saveConfig(root, cfg);
  appendEvent(root, { type: 'scope.declared', actor: `human:${by}`, session: cliSession(root), data: next });
  console.log(`Scope of "${cfg.team.name}": ${[...next.domains.map((d) => `domain ${d}`), ...next.components.map((c) => `component ${c}`)].join(', ')}.`);
  // Said at the moment of declaring, not discovered later.
  try {
    const o = resolveOrg(root, cfg, { refresh: 'never' });
    if (o && !o.error) for (const v of overlaps(teamsOf(o, { selfRoot: root, selfName: cfg.team.name })).filter((x) => x.teams.includes(cfg.team.name)))
      console.log(`Overlap: ${v.teams.filter((t) => t !== cfg.team.name)[0]} also declares the ${v.kind} "${v.what}". Two teams answering for the same thing is for the humans to settle.`);
  } catch { /* the declaration stands even if the organisation cannot be read */ }
}

function journal(root, pos, opt) {
  const sub = pos[0];
  if (sub === 'add') {
    const type = pos[1];
    if (!type || !/^[a-z]+(\.[a-z-]+)+$/.test(type)) fail('journal add needs a type like "decision.recorded".');
    if (RESERVED.includes(type.split('.')[0])) fail(`"${type.split('.')[0]}.*" events are written by the harness only.`);
    let data = {};
    if (opt.data && opt.data !== true) { try { data = JSON.parse(opt.data); } catch { fail('--data is not valid JSON.'); } }
    // The journal must not say a record exists when it does not.
    const kind = { 'decision.recorded': 'decisions', 'pattern.reviewed': 'patterns' }[type];
    if (kind) {
      if (!data.id) fail(`${type} needs the record id in --data, e.g. '{"id":"${kind === 'decisions' ? 'D' : 'P'}-0001"}'.`);
      if (!listRecords(root, kind).some((r) => r.id === data.id)) fail(`no record with id ${data.id} in ${CODA_DIR}/${kind}/ — write the record first; if writing it was refused, nothing was recorded and the human should be told.`);
    }
    // Whether a delivery is verified is a fact the harness knows; it is not taken from the caller.
    if (type === 'delivery.completed') {
      const fp = fingerprint(root); const v = loadVerified(root);
      data = { ...data, verified: fp !== null && v.fp === fp, reviewed: fp !== null && v.reviewFp === fp, fingerprint: fp };
    }
    const e = appendEvent(root, { type, actor: opt.actor && opt.actor !== true ? String(opt.actor) : 'agent:main', session: cliSession(root, opt.session !== true && opt.session), data });
    console.log(`${e.ts} ${e.type} #${e.seq}`);
  } else if (sub === 'tail' || sub === 'query') {
    let since = opt.since && opt.since !== true ? String(opt.since) : undefined;
    const days = /^(\d+)d$/.exec(since || '');
    if (days) since = new Date(Date.now() - Number(days[1]) * 864e5).toISOString();
    let events = readEvents(root, { since, types: opt.type && opt.type !== true ? [].concat(opt.type) : undefined });
    if (sub === 'tail') events = events.slice(-(parseInt(pos[1], 10) || 20));
    for (const e of events) console.log(JSON.stringify(e));
  } else if (sub === 'verify') {
    const r = verifyJournal(root);
    if (r.problems.length) { console.log(r.problems.join('\n')); fail(`journal integrity: ${r.problems.length} problem(s) in ${r.count} events.`); }
    console.log(`Journal intact: ${r.count} events in ${r.files} stream(s).`);
  } else fail('journal: use add, tail, query or verify.');
}

function verify(root, opt) {
  const cfg = withFloors(root, loadConfig(root));
  if (!cfg.verify.commands.length) fail('no verification commands configured (.coda/config.json → verify.commands).');
  const fp = fingerprint(root);
  if (!opt.force && fp && loadVerified(root).fp === fp) {
    console.log(`PASS  already verified at this exact state of the tree (${fp}). Nothing changed since; use --force to run again.`);
    return;
  }
  const res = runVerify(root, cfg);
  appendEvent(root, { type: res.ok ? 'verify.passed' : 'verify.failed', session: cliSession(root), data: { fingerprint: fp, results: res.results.map(({ command, ok, code, ms }) => ({ command, ok, code, ms })) } });
  // Show the end of the output on a pass too: a green run that executed nothing must be visible.
  for (const r of res.results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.command}  (${r.ms} ms)\n${r.ok ? r.tail.split('\n').slice(-8).join('\n') : r.tail}`.trimEnd());
  if (res.ok && fp) saveVerified(root, { ...loadVerified(root), fp });
  process.exit(res.ok ? 0 : 1);
}

function level(root, pos, opt) {
  const cfg = loadConfig(root);
  const to = pos[0];
  if (!to) { console.log(cfg.autonomy.level); return; }
  if (!LEVELS.includes(to)) fail(`unknown level "${to}". Use one of: ${LEVELS.join(', ')}.`);
  if (!opt.by || opt.by === true) fail('--by <human> is required: a named human decides the autonomy level.');
  if (!opt.reason || opt.reason === true) fail('--reason is required.');
  const from = cfg.autonomy.level;
  if (from === to) { console.log(`Already at "${to}".`); return; }
  const floors = withFloors(root, cfg)._floors;
  if (floors?.maxLevel && LEVELS.indexOf(to) > LEVELS.indexOf(floors.maxLevel)) fail(`the organisation caps every team at "${floors.maxLevel}". Raising the cap is the organisation's decision (\`coda org floors\`), not a team's.`);
  if (to === 'bounded' && !withFloors(root, cfg).verify.commands.length) fail('bounded autonomy needs verification commands first (verify.commands): autonomy without a verification loop is not delegation.');
  cfg.autonomy.level = to;
  cfg.autonomy.since = new Date().toISOString();
  saveConfig(root, cfg);
  appendEvent(root, { type: 'autonomy.changed', actor: `human:${opt.by}`, session: cliSession(root), data: { from, to, reason: String(opt.reason) } });
  console.log(`Autonomy level: ${from} → ${to} (decided by ${opt.by}).`);
}

function doctor(root) {
  const cfg = withFloors(root, loadConfig(root));
  const checks = [];
  const add = (ok, label, fix) => checks.push({ ok, label, fix });
  add(!cfg._error, 'config.json is valid', cfg._error);
  add(Number(process.versions.node.split('.')[0]) >= 18, `Node ${process.versions.node}`, 'CODA hooks need Node 18 or newer.');
  add(git(root, ['rev-parse', '--git-dir']) !== null, 'project is a git repository', 'The verification gate needs git to know what changed.');
  add(cfg.verify.commands.length > 0, 'verification commands configured', 'Set verify.commands in .coda/config.json — without it nothing gates what agents deliver.');
  const j = verifyJournal(root);
  add(j.count > 0, `journal is recording (${j.count} events)`, 'No events yet: are the hooks installed? In Claude Code, check /hooks.');
  add(j.problems.length === 0, 'journal is intact', j.problems[0]);
  add(readEvents(root, { types: ['session'] }).length > 0, 'harness hooks have fired at least once', 'Only CLI events found: the plugin hooks have not run in this project yet.');
  const humans = cfg.team.humans || [];
  add(humans.length > 0, `${humans.length} human(s) declared`, 'Declare the humans and their roles in config.json (team.humans).');
  let o = null; try { o = orgFacts(root, cfg, { refresh: 'never' }); } catch { /* no organisation to ask */ }
  for (const role of ROLES) add(humans.some((h) => (h.roles || []).includes(role)) || (role === 'ethical-guardian' && o?.readable && o.guardians.length > 0), `role held: ${role}${role === 'ethical-guardian' && o?.readable && o.guardians.length && !humans.some((h) => (h.roles || []).includes(role)) ? ` (${o.guardians.join(', ')}, shared by the organisation)` : ''}`, `Nobody holds ${role}.`);
  if (o) {
    add(o.readable, `organisation is readable${o.readable ? ` (${o.name})` : ''}`, o.error);
    if (o.readable) {
      add(o.thisTeamRegistered, 'this team is in the organisation\'s list of teams', `Add it with \`coda org add-team --name "${cfg.team.name}"\` in the organisation.`);
      add(o.intent && o.intentStatus !== 'draft', 'organisation intent is written and no longer a draft', `Write ${ORG_DIR}/intent.md with the organisation's intent architect.`);
    }
  }
  const intent = fs.existsSync(codaPath(root, 'intent.md')) && !/status:\s*draft/.test(fs.readFileSync(codaPath(root, 'intent.md'), 'utf8'));
  add(intent, 'intent is written and no longer a draft', 'Run /coda:intent.');
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.label}${c.ok || !c.fix ? '' : `\n    → ${c.fix}`}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const { pos, opt } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();
if (opt.help) { process.stdout.write(USAGE); process.exit(0); }
switch (cmd) {
  case 'init': init(opt); break;
  case 'brief': { const root = needRoot(); console.log(brief(root, withFloors(root, loadConfig(root)))); break; }
  case 'org': org(pos, opt); break;
  case 'scope': scope(needRoot(), pos, opt); break;
  case 'split': split(needRoot(), opt); break;
  case 'regrowth': regrowth(needRoot(), pos, opt); break;
  case 'status': { const root = needRoot(); console.log(JSON.stringify(status(root, withFloors(root, loadConfig(root))), null, 2)); break; }
  case 'next-id': {
    const root = needRoot();
    const kind = pos[0];
    if (!['decisions', 'patterns'].includes(kind)) fail('next-id: decisions or patterns.');
    const id = nextId(root, kind, kind === 'decisions' ? 'D-' : 'P-');
    console.log(pos[1] ? `${CODA_DIR}/${kind}/${id}-${slugify(pos.slice(1).join(' '))}.md` : id);
    break;
  }
  case 'graph': {
    if (opt.org) {
      const { o, teams } = orgContext();
      let g = buildOrgGraph(teams, orgDecisions(o));
      if (opt.check) {
        for (const p of g.problems) console.log(p);
        for (const c of g.betweenTeams) console.log(`open contradiction between teams: ${c.between.join(' and ')} are both in force`);
        for (const r of g.recurring) console.log(`recurring across teams: ${r.entity} — ${r.decisions.join(', ')}`);
        if (g.problems.length || g.betweenTeams.length) process.exit(1);
        console.log(`${o.name}: ${g.nodes.filter((n) => n.kind === 'decision').length} decisions across ${teams.filter((t) => t.dir).length} team(s), ${g.shared.length} thing(s) more than one team has decided about.`);
        break;
      }
      if (opt.around && opt.around !== true) {
        const n = neighbourhood(g, opt.around);
        if (!n) fail(`nothing in the organisation's graph matches "${opt.around}".`);
        g = { ...g, ...n };
      }
      if (opt.format === 'mermaid') console.log(toMermaid(g));
      else if (opt.format === 'entities') { for (const e of g.entities) console.log(`${e.id}\t${e.teams.join(',')}\t${e.decisions.join(',')}`); }
      else console.log(JSON.stringify({ organisation: o.name, ...g }, null, 2));
      break;
    }
    const root = needRoot();
    let g = buildGraph(root);
    if (opt.check) {
      for (const p of g.problems) console.log(p);
      for (const c of g.contradictions) console.log(`open contradiction: ${c.between.join(' and ')} are both in force`);
      if (g.problems.length || g.contradictions.length) process.exit(1);
      console.log(`Graph consistent: ${g.nodes.filter((n) => n.kind === 'decision').length} decisions, ${g.entities.length} entities, ${g.edges.filter((e) => LINK_TYPES.includes(e.type)).length} links.`);
      break;
    }
    if (opt.write) {
      fs.writeFileSync(codaPath(root, 'graph.md'), toMarkdown(g));
      console.log(`Wrote ${CODA_DIR}/graph.md (${g.nodes.length} nodes, ${g.edges.length} edges). It is generated: regenerate it rather than editing it.`);
      break;
    }
    if (opt.around && opt.around !== true) {
      const n = neighbourhood(g, opt.around);
      if (!n) fail(`nothing in the graph matches "${opt.around}". Known entities: ${g.entities.map((e) => e.id).join(', ') || 'none yet'}.`);
      g = n;
    }
    if (opt.format === 'mermaid') console.log(toMermaid(g));
    else if (opt.format === 'entities') { for (const e of g.entities) console.log(`${e.id}\t${e.decisions.join(',')}\t${e.patterns.join(',')}`); }
    else console.log(JSON.stringify({ entityTypes: ENTITY_TYPES, linkTypes: LINK_TYPES, ...g }, null, 2));
    break;
  }
  case 'list': { const root = needRoot(); for (const r of listRecords(root, pos[0] || 'decisions')) console.log(`${r.id}\t${r.meta.status || ''}\t${r.meta.date || ''}\t${r.title}\t${r.file}`); break; }
  case 'journal': journal(needRoot(), pos, opt); break;
  case 'verify': verify(needRoot(), opt); break;
  case 'level': level(needRoot(), pos, opt); break;
  case 'doctor': doctor(needRoot()); break;
  default: process.stdout.write(USAGE); process.exit(cmd && cmd !== 'help' ? 1 : 0);
}
