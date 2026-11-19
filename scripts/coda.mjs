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

// Events only the harness may write: a model must not be able to claim that
// verification passed or that a human changed the autonomy level.
const RESERVED = ['session', 'run', 'tool', 'guard', 'verify', 'review', 'autonomy', 'coda'];

const USAGE = `coda — cognitive orchestration for delivery agents

  coda init [--name <team>] [--level observed|supervised|bounded] [--verify "<cmd>"]...
  coda brief                         the context every session starts from
  coda status                        facts about the team's state, as JSON
  coda next-id decisions|patterns [title]
  coda journal add <type> [--data '<json>'] [--actor <who>]
  coda journal tail [n] | query [--since <iso|Nd>] [--type <prefix>] | verify
  coda verify                        run the verification commands now
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
  cfg.verify.commands = [].concat(opt.verify || []).filter((v) => v !== true);
  saveConfig(root, cfg);
  fs.writeFileSync(codaPath(root, 'intent.md'), INTENT_TEMPLATE);
  fs.writeFileSync(codaPath(root, '.gitignore'), '.state/\n*.lock\n');
  for (const d of ['decisions', 'patterns', 'audits']) fs.writeFileSync(codaPath(root, d, '.gitkeep'), '');
  appendEvent(root, { type: 'coda.initialized', session: cliSession(root), data: { level, verify: cfg.verify.commands } });
  console.log(`Initialised ${CODA_DIR}/ — autonomy level: ${level}; verification: ${cfg.verify.commands.join(', ') || 'none yet'}.`);
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

function verify(root) {
  const cfg = loadConfig(root);
  if (!cfg.verify.commands.length) fail('no verification commands configured (.coda/config.json → verify.commands).');
  const fp = fingerprint(root);
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
  const intent = fs.existsSync(codaPath(root, 'intent.md')) && !/status:\s*draft/.test(fs.readFileSync(codaPath(root, 'intent.md'), 'utf8'));
  add(intent, 'intent is written and no longer a draft', 'Run /coda:intent.');
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.label}${c.ok || !c.fix ? '' : `\n    → ${c.fix}`}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

const { pos, opt } = parseArgs(process.argv.slice(2));
const cmd = pos.shift();
switch (cmd) {
  case 'init': init(opt); break;
  case 'brief': { const root = needRoot(); console.log(brief(root, loadConfig(root))); break; }
  case 'status': { const root = needRoot(); console.log(JSON.stringify(status(root, loadConfig(root)), null, 2)); break; }
  case 'next-id': {
    const root = needRoot();
    const kind = pos[0];
    if (!['decisions', 'patterns'].includes(kind)) fail('next-id: decisions or patterns.');
    const id = nextId(root, kind, kind === 'decisions' ? 'D-' : 'P-');
    console.log(pos[1] ? `${CODA_DIR}/${kind}/${id}-${slugify(pos.slice(1).join(' '))}.md` : id);
    break;
  }
  case 'list': { const root = needRoot(); for (const r of listRecords(root, pos[0] || 'decisions')) console.log(`${r.id}\t${r.meta.status || ''}\t${r.meta.date || ''}\t${r.title}\t${r.file}`); break; }
  case 'journal': journal(needRoot(), pos, opt); break;
  case 'verify': verify(needRoot()); break;
  case 'level': level(needRoot(), pos, opt); break;
  case 'doctor': doctor(needRoot()); break;
  default: process.stdout.write(USAGE); process.exit(cmd && cmd !== 'help' ? 1 : 0);
}
