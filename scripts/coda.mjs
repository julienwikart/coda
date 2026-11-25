#!/usr/bin/env node
// CODA command line. Used by the skills, by humans, and by any harness that is
// not Claude Code (see docs/harness-contract.md).
import fs from 'node:fs';
import path from 'node:path';
import {
  findRoot, codaPath, loadConfig, saveConfig, appendEvent, readEvents, verifyJournal,
  nextId, slugify, listRecords, fingerprint, loadVerified, saveVerified, runVerify,
  DEFAULT_CONFIG, LEVELS, ROLES, CODA_DIR, git, cliSession,
} from './lib.mjs';
import { brief, status } from './brief.mjs';
import { resolveOrg, orgFacts, findOrgRoot, loadOrgFile, orgPath, parseHuman, orgAt, teamsOf, overlaps, scopeProblems, ORG_DIR } from './org.mjs';
import { buildGraph, neighbourhood, toMermaid, toMarkdown, ENTITY_TYPES, LINK_TYPES } from './graph.mjs';

// Events only the harness may write: a model must not be able to claim that
// verification passed or that a human changed the autonomy level.
const RESERVED = ['session', 'run', 'tool', 'guard', 'verify', 'review', 'autonomy', 'coda', 'org', 'scope'];

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
  } else fail('org: use init, add-team, join, status, sync, map or check.');
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
  const cfg = loadConfig(root);
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
  if (to === 'bounded' && !cfg.verify.commands.length) fail('bounded autonomy needs verification commands first (verify.commands): autonomy without a verification loop is not delegation.');
  cfg.autonomy.level = to;
  cfg.autonomy.since = new Date().toISOString();
  saveConfig(root, cfg);
  appendEvent(root, { type: 'autonomy.changed', actor: `human:${opt.by}`, session: cliSession(root), data: { from, to, reason: String(opt.reason) } });
  console.log(`Autonomy level: ${from} → ${to} (decided by ${opt.by}).`);
}

function doctor(root) {
  const cfg = loadConfig(root);
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
  for (const role of ROLES) add(humans.some((h) => (h.roles || []).includes(role)), `role held: ${role}`, `Nobody holds ${role}.`);
  const o = orgFacts(root, cfg, { refresh: 'never' });
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
  case 'brief': { const root = needRoot(); console.log(brief(root, loadConfig(root))); break; }
  case 'org': org(pos, opt); break;
  case 'scope': scope(needRoot(), pos, opt); break;
  case 'status': { const root = needRoot(); console.log(JSON.stringify(status(root, loadConfig(root)), null, 2)); break; }
  case 'next-id': {
    const root = needRoot();
    const kind = pos[0];
    if (!['decisions', 'patterns'].includes(kind)) fail('next-id: decisions or patterns.');
    const id = nextId(root, kind, kind === 'decisions' ? 'D-' : 'P-');
    console.log(pos[1] ? `${CODA_DIR}/${kind}/${id}-${slugify(pos.slice(1).join(' '))}.md` : id);
    break;
  }
  case 'graph': {
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
