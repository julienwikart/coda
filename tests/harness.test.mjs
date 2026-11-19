import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, appendEvent, verifyJournal, journalFiles, readEvents, globToRegExp, redact, fingerprint, matchCommand } from '../scripts/lib.mjs';
import { decide, isReadOnlyCommand, isCodaBookkeeping } from '../scripts/hook.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'scripts', 'coda.mjs');
const HOOK = path.join(here, '..', 'scripts', 'hook.mjs');

function project({ level = 'supervised', verify = [] } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coda-test-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  const args = ['init', '--level', level];
  for (const v of verify) args.push('--verify', v);
  execFileSync('node', [CLI, ...args], { cwd: root });
  return root;
}

function hook(root, input) {
  const r = spawnSync('node', [HOOK], { cwd: root, input: JSON.stringify({ cwd: root, session_id: 'sess-1', ...input }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

const write = (file, extra = {}) => ({ tool_name: 'Write', tool_input: { file_path: file }, ...extra });
const bash = (command, extra = {}) => ({ tool_name: 'Bash', tool_input: { command }, ...extra });
const d = (root, input) => decide(root, loadConfig(root), input).decision;

test('globs', () => {
  assert.ok(globToRegExp('src/**').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/.env*').test('apps/api/.env.local'));
  assert.ok(globToRegExp('.env*').test('.env'));
  assert.ok(!globToRegExp('src/*').test('src/a/b.ts'));
  assert.ok(matchCommand(['git push --force*'], 'git push   --force origin main'));
  assert.ok(!matchCommand(['git push --force*'], 'git push origin main'));
});

test('read-only command detection is conservative', () => {
  for (const c of ['ls -la', 'git status && git diff HEAD', 'cat a | grep b', 'git log --oneline 2>/dev/null', 'cat .coda/decisions/D-0001*; echo; git branch -a; ls .coda/patterns', "find src -type f | grep -v x | xargs ls -la", 'git branch --show-current', 'for f in a b; do echo $f; cat $f; done', 'if test -f a; then cat a; fi', 'grep -rniE "discount|clamp; throw" .coda --include=*.md', "grep -E 'a|b' f | sort", 'git -C /tmp/x ls-files'])
    assert.ok(isReadOnlyCommand(c), c);
  for (const c of ['rm -rf x', 'echo hi > file', 'git commit -m x', 'cat a && npm test', 'ls $(rm x)', 'find . -delete', 'git -C . push', 'sed -i s/a/b/ f', 'git branch -D main', 'git branch new-branch', 'find . | xargs rm', 'ls | xargs -n1 git push', 'ls | xargs', 'for f in a b; do rm $f; done', 'if test -f a; then rm a; fi', 'grep "a" f | xargs rm', 'echo "$(rm x)"', 'cat "a', 'git -C /tmp/x push', 'git -c core.pager=evil log', 'echo "x" > f'])
    assert.ok(!isReadOnlyCommand(c), c);
});

test('observed: agents cannot change the project', () => {
  const root = project({ level: 'observed' });
  assert.equal(d(root, write(path.join(root, 'src/a.ts'))), 'deny');
  assert.equal(d(root, bash('npm test')), 'deny');
  assert.equal(d(root, bash('git status')), null);
  assert.equal(d(root, write(path.join(root, '.coda/decisions/D-0001-x.md'))), null);
});

test('supervised: a human approves each action', () => {
  const root = project({ level: 'supervised' });
  assert.equal(d(root, write(path.join(root, 'src/a.ts'))), 'ask');
  assert.equal(d(root, bash('npm test')), 'ask');
  assert.equal(d(root, bash('ls')), null);
});

test('bounded: free inside the perimeter, ask outside, protected never', () => {
  const root = project({ level: 'supervised', verify: ['true'] });
  const cfg = loadConfig(root); cfg.autonomy.level = 'bounded'; saveConfig(root, cfg);
  assert.equal(d(root, write(path.join(root, 'src/deep/a.ts'))), 'allow');
  assert.equal(d(root, write('src/a.ts')), 'allow');
  assert.equal(d(root, write(path.join(root, 'package.json'))), 'ask');
  assert.equal(d(root, write(path.join(root, 'src/.env.local'))), 'deny');
  assert.equal(d(root, write(path.join(root, '.github/workflows/ci.yml'))), 'deny');
  assert.equal(d(root, write('/etc/hosts')), 'ask');
  assert.equal(d(root, write(path.join(root, 'src/../.env'))), 'deny');
  assert.equal(d(root, bash('npm test')), null);
  assert.equal(d(root, bash('git push origin main')), 'ask');
  assert.equal(d(root, bash('npm test && git push --force origin main')), 'deny');
});

test('a symlink cannot smuggle a write out of the perimeter', () => {
  const root = project({ verify: ['true'] });
  const cfg = loadConfig(root); cfg.autonomy.level = 'bounded'; saveConfig(root, cfg);
  fs.mkdirSync(path.join(root, 'src'));
  fs.symlinkSync(os.tmpdir(), path.join(root, 'src', 'out'));
  assert.notEqual(d(root, write(path.join(root, 'src/out/x.ts'), { agent_type: 'coda:builder' })), 'allow');
});

test('every level: journal is append-only, config needs a human, deny list holds', () => {
  for (const level of ['observed', 'supervised', 'bounded']) {
    const root = project({ verify: ['true'] });
    const cfg = loadConfig(root); cfg.autonomy.level = level; saveConfig(root, cfg);
    assert.equal(d(root, write(path.join(root, '.coda/journal/2026-11/x.jsonl'))), 'deny', level);
    assert.equal(d(root, bash('rm -rf .coda/journal')), 'deny', level);
    assert.equal(d(root, bash('echo {} >> .coda/journal/2026-11/x.jsonl')), 'deny', level);
    assert.equal(d(root, bash('cat .coda/journal/2026-11/x.jsonl')), null, level);
    assert.equal(d(root, write(path.join(root, '.coda/config.json'))), 'ask', level);
    assert.equal(d(root, bash('terraform apply -auto-approve')), 'deny', level);
    assert.equal(d(root, bash(`node "${CLI}" level bounded --by x --reason y`)), 'ask', level);
  }
});

test('cognitive agents steer, they do not deliver', () => {
  const root = project({ verify: ['true'] });
  const cfg = loadConfig(root); cfg.autonomy.level = 'bounded'; saveConfig(root, cfg);
  const as = { agent_type: 'coda:coordination' };
  assert.equal(d(root, write(path.join(root, 'src/a.ts'), as)), 'deny');
  assert.equal(d(root, bash('npm run build', as)), 'deny');
  assert.equal(d(root, bash('git log --stat', as)), null);
  assert.equal(d(root, write(path.join(root, 'src/a.ts'), { agent_type: 'coda:builder' })), 'allow');
});

test('a broken config never widens permissions', () => {
  const root = project();
  fs.writeFileSync(path.join(root, '.coda/config.json'), '{ not json');
  assert.equal(loadConfig(root).autonomy.level, 'observed');
  assert.equal(d(root, write(path.join(root, 'src/a.ts'))), 'deny');
});

test('journal: chained, one stream per session, tampering is detected', () => {
  const root = project();
  for (let i = 0; i < 5; i++) appendEvent(root, { type: 'tool.write', session: 'abc', data: { i } });
  appendEvent(root, { type: 'tool.write', session: 'other', data: {} });
  assert.equal(journalFiles(root).length, 3);
  assert.deepEqual(verifyJournal(root).problems, []);
  const f = journalFiles(root).find((x) => x.endsWith('abc.jsonl'));
  const lines = fs.readFileSync(f, 'utf8').trimEnd().split('\n');
  fs.writeFileSync(f, [lines[0], lines[1].replace('"i":1', '"i":99'), ...lines.slice(2)].join('\n') + '\n');
  assert.ok(verifyJournal(root).problems.length > 0, 'edit detected');
  fs.writeFileSync(f, [lines[0], ...lines.slice(2)].join('\n') + '\n');
  assert.ok(verifyJournal(root).problems.length > 0, 'deletion detected');
});

test('journal redacts secrets in commands', () => {
  assert.ok(!redact('curl -H "Authorization: Bearer abc123def456" https://x').includes('abc123def456'));
  assert.ok(!redact('API_KEY=supersecretvalue npm run deploy').includes('supersecretvalue'));
  assert.ok(!redact('gh auth login --with-token ghp_abcdefghijklmnopqrstuv').includes('ghp_abcdefghijklmnopqrstuv'));
});

test('the CLI cannot forge harness events', () => {
  const root = project();
  for (const type of ['verify.passed', 'review.passed', 'autonomy.changed', 'guard.denied']) {
    const r = spawnSync('node', [CLI, 'journal', 'add', type], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 1, type);
  }
  assert.equal(spawnSync('node', [CLI, 'journal', 'add', 'intent.sync', '--data', '{"drift":false}'], { cwd: root }).status, 0);
});

test('level change needs a named human, a reason, and a verification loop', () => {
  const root = project();
  const run = (...a) => spawnSync('node', [CLI, 'level', ...a], { cwd: root, encoding: 'utf8' });
  assert.equal(run('bounded').status, 1);
  assert.equal(run('bounded', '--by', 'Ana', '--reason', 'r').status, 1, 'no verification configured');
  const cfg = loadConfig(root); cfg.verify.commands = ['true']; saveConfig(root, cfg);
  assert.equal(run('bounded', '--by', 'Ana', '--reason', 'three weeks clean').status, 0);
  const e = readEvents(root, { types: ['autonomy'] }).pop();
  assert.equal(e.actor, 'human:Ana');
  assert.deepEqual([e.data.from, e.data.to], ['supervised', 'bounded']);
});

test('hook: no-op outside a CODA project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coda-none-'));
  const r = spawnSync('node', [HOOK], { cwd: dir, input: JSON.stringify({ cwd: dir, hook_event_name: 'PreToolUse', ...write(path.join(dir, 'a')) }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hook: session start injects the brief; guard decisions and writes are journaled', () => {
  const root = project();
  const start = hook(root, { hook_event_name: 'SessionStart', source: 'startup' });
  assert.match(start.hookSpecificOutput.additionalContext, /supervised execution/);
  const pre = hook(root, { hook_event_name: 'PreToolUse', ...write(path.join(root, 'src/a.ts')) });
  assert.equal(pre.hookSpecificOutput.permissionDecision, 'ask');
  hook(root, { hook_event_name: 'PostToolUse', ...write(path.join(root, 'src/a.ts')) });
  hook(root, { hook_event_name: 'PostToolUse', ...bash('npm test --token=abcdef123456') });
  hook(root, { hook_event_name: 'PostToolUse', ...bash('ls') });
  const types = readEvents(root).map((e) => e.type);
  assert.deepEqual(types, ['coda.initialized', 'session.start', 'guard.asked', 'tool.write', 'tool.command']);
  assert.ok(!JSON.stringify(readEvents(root)).includes('abcdef123456'));
  assert.deepEqual(verifyJournal(root).problems, []);
});

test('verification gate: blocks failing work, accepts it once fixed, does not loop forever', () => {
  const root = project({ verify: ['test -f ok.txt'] });
  hook(root, { hook_event_name: 'SessionStart' });
  assert.equal(hook(root, { hook_event_name: 'Stop' }), null, 'nothing changed: no gate');
  fs.writeFileSync(path.join(root, 'feature.txt'), 'x');
  const blocked = hook(root, { hook_event_name: 'Stop' });
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /test -f ok\.txt/);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'x');
  assert.equal(hook(root, { hook_event_name: 'Stop' }), null);
  assert.ok(readEvents(root).some((e) => e.type === 'verify.passed'));

  fs.rmSync(path.join(root, 'ok.txt'));
  for (let i = 0; i < 3; i++) assert.equal(hook(root, { hook_event_name: 'Stop' }).decision, 'block');
  const last = hook(root, { hook_event_name: 'Stop' });
  assert.match(last.systemMessage, /unverified/);
  assert.ok(readEvents(root).some((e) => e.type === 'verify.unresolved'));
});

test('review gate: only the verifier agent\'s verdict, read by the harness, opens it', () => {
  const root = project({ verify: ['true'] });
  const cfg = loadConfig(root); cfg.verify.requireReview = true; saveConfig(root, cfg);
  hook(root, { hook_event_name: 'SessionStart' });
  fs.writeFileSync(path.join(root, 'feature.txt'), 'x');
  assert.match(hook(root, { hook_event_name: 'Stop' }).reason, /coda:verifier/);
  hook(root, { hook_event_name: 'SubagentStop', agent_type: 'coda:builder', last_assistant_message: 'CODA-VERDICT: PASS' });
  assert.equal(hook(root, { hook_event_name: 'Stop' }).decision, 'block', 'a builder cannot approve itself');
  hook(root, { hook_event_name: 'SubagentStop', agent_type: 'coda:verifier', last_assistant_message: 'All good.\nCODA-VERDICT: PASS' });
  assert.equal(hook(root, { hook_event_name: 'Stop' }), null);
  fs.writeFileSync(path.join(root, 'feature.txt'), 'changed after review');
  assert.equal(hook(root, { hook_event_name: 'Stop' }).decision, 'block', 'a review covers one state of the tree');
});

test('fingerprint ignores .coda/ and tracks content', () => {
  const root = project();
  const a = fingerprint(root);
  appendEvent(root, { type: 'tool.write', data: {} });
  assert.equal(fingerprint(root), a);
  fs.writeFileSync(path.join(root, 'f.txt'), '1');
  const b = fingerprint(root);
  assert.notEqual(b, a);
  fs.writeFileSync(path.join(root, 'f.txt'), '2');
  assert.notEqual(fingerprint(root), b);
});

test('CODA bookkeeping runs without a prompt; look-alikes and chained commands do not', () => {
  const root = project({ level: 'observed' });
  assert.equal(d(root, bash(`node "${CLI}" status`)), 'allow');
  assert.equal(d(root, bash(`node "${CLI}" journal add memory.recall --data '{"hits":1}'`)), 'allow');
  assert.ok(!isCodaBookkeeping(`node "${CLI}" status && rm -rf src`));
  assert.ok(!isCodaBookkeeping(`node "${CLI}" level bounded --by x --reason y`));
  assert.ok(!isCodaBookkeeping('node scripts/coda.mjs status'), 'a project-local script named coda.mjs is not the CLI');
  assert.equal(d(root, bash('node scripts/coda.mjs status')), 'deny');
});

test('CLI events land in the acting session\'s stream, never in a file shared between teammates', () => {
  const root = project();
  hook(root, { hook_event_name: 'SessionStart', session_id: 'sess-abc' });
  execFileSync('node', [CLI, 'journal', 'add', 'memory.recall'], { cwd: root });
  const mine = readEvents(root).filter((e) => e.type === 'memory.recall');
  assert.equal(mine[0].session, 'sess-abc');
  fs.rmSync(path.join(root, '.coda/.state/current.json'));
  execFileSync('node', [CLI, 'journal', 'add', 'memory.recall'], { cwd: root });
  assert.match(readEvents(root).filter((e) => e.type === 'memory.recall')[1].session, /^cli-[0-9a-f]{6}-\d{4}$/);
  assert.deepEqual(verifyJournal(root).problems, []);
});

test('coda verify shows the end of the output on a pass', () => {
  const root = project({ verify: ['echo "tests 0"'] });
  assert.match(execFileSync('node', [CLI, 'verify'], { cwd: root, encoding: 'utf8' }), /PASS.*\n.*tests 0/);
});

test('the journal cannot say a decision was recorded when its record does not exist', () => {
  const root = project();
  const add = () => spawnSync('node', [CLI, 'journal', 'add', 'decision.recorded', '--data', '{"id":"D-0001"}'], { cwd: root, encoding: 'utf8' });
  assert.equal(add().status, 1);
  assert.equal(spawnSync('node', [CLI, 'journal', 'add', 'decision.recorded'], { cwd: root }).status, 1, 'id required');
  fs.writeFileSync(path.join(root, '.coda/decisions/D-0001-x.md'), '---\nid: D-0001\nstatus: decided\n---\n# D-0001 X\n');
  assert.equal(add().status, 0);
});

test('init writes the team, roles and perimeter in one command; bounded at init needs a named human', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coda-test-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const init = (...a) => spawnSync('node', [CLI, 'init', ...a], { cwd: root, encoding: 'utf8' });
  assert.equal(init('--level', 'bounded', '--verify', 'true').status, 1);
  assert.equal(init('--human', 'Ana=boss').status, 1);
  const r = init('--level', 'bounded', '--by', 'Karim', '--verify', 'true', '--human', 'Ana=intent-architect,sovereign-maker', '--human', 'Lou=ethical-guardian,external', '--write', 'src/**', '--protect', 'migrations/**');
  assert.equal(r.status, 0, r.stderr);
  const cfg = loadConfig(root);
  assert.deepEqual(cfg.team.humans[1], { name: 'Lou', roles: ['ethical-guardian'], external: true });
  assert.deepEqual(cfg.autonomy.perimeter.write, ['src/**']);
  assert.ok(cfg.autonomy.perimeter.protected.includes('migrations/**') && cfg.autonomy.perimeter.protected.includes('.env*'));
  assert.equal(readEvents(root)[0].actor, 'human:Karim');
});

test('a delivery\'s verified state comes from the harness, not from the caller', () => {
  const root = project({ verify: ['true'] });
  fs.writeFileSync(path.join(root, 'f.txt'), '1');
  const add = () => execFileSync('node', [CLI, 'journal', 'add', 'delivery.completed', '--data', '{"request":"x","verified":true,"reviewed":true}'], { cwd: root });
  add();
  execFileSync('node', [CLI, 'verify'], { cwd: root });
  add();
  const [a, b] = readEvents(root).filter((e) => e.type === 'delivery.completed');
  assert.deepEqual([a.data.verified, a.data.reviewed], [false, false]);
  assert.deepEqual([b.data.verified, b.data.reviewed], [true, false]);
});

test('coda verify does not re-run on an unchanged tree unless forced; --help never runs anything', () => {
  const root = project({ verify: ['true'] });
  const run = (...a) => execFileSync('node', [CLI, 'verify', ...a], { cwd: root, encoding: 'utf8' });
  assert.match(run('--help'), /coda init/);
  assert.equal(readEvents(root, { types: ['verify'] }).length, 0);
  run(); assert.match(run(), /already verified/); run('--force');
  assert.equal(readEvents(root, { types: ['verify'] }).length, 2);
});

// ------------------------------------------------------------ knowledge graph
import { buildGraph, neighbourhood, toMermaid, parseEntity } from '../scripts/graph.mjs';

function record(root, kind, id, front, title = id) {
  fs.writeFileSync(path.join(root, '.coda', kind, `${id}-x.md`), `---\nid: ${id}\n${front}\n---\n# ${id} ${title}\n`);
}

test('graph: derived from record frontmatter — entities, typed links, patterns', () => {
  const root = project();
  record(root, 'decisions', 'D-0001', 'status: superseded\nentities: [technology:Postgres, constraint:integer cents]', 'Use "floats" [old]');
  record(root, 'decisions', 'D-0002', 'status: decided\nentities: [technology:postgres, risk:rounding]\nsupersedes: D-0001\ndepends-on: [D-0003]');
  record(root, 'decisions', 'D-0003', 'status: decided\nentities: [component:billing-api]');
  record(root, 'patterns', 'P-0001', 'status: detected\nentities: [risk:rounding]\ndecisions: [D-0002]');
  const g = buildGraph(root);
  assert.deepEqual(g.problems, []);
  const pg = g.entities.find((e) => e.id === 'technology:postgres');
  assert.deepEqual(pg.decisions, ['D-0001', 'D-0002'], 'names are normalised so the same thing is one node');
  assert.ok(g.edges.some((e) => e.from === 'D-0002' && e.to === 'D-0001' && e.type === 'supersedes'));
  assert.ok(g.edges.some((e) => e.from === 'D-0002' && e.to === 'D-0003' && e.type === 'depends-on'));
  assert.ok(g.edges.some((e) => e.from === 'P-0001' && e.to === 'D-0002' && e.type === 'observed-in'));
  const near = neighbourhood(g, 'postgres');
  assert.deepEqual(near.nodes.map((n) => n.id).sort(), ['D-0001', 'D-0002', 'technology:postgres']);
  assert.equal(neighbourhood(g, 'nothing-like-this'), null);
  const m = toMermaid(g);
  assert.match(m, /^graph LR/);
  assert.ok(!/"[^"\n]*"[^"\n]*"[^"\n]*"\]/.test(m.split('\n').find((l) => l.includes('D_0001['))), 'quotes in titles are neutralised');
  assert.match(m, /class D_0001 retired/);
});

test('graph: people are never entities', () => {
  assert.match(parseEntity('person:Ana').error, /not who did what/);
  const root = project();
  record(root, 'decisions', 'D-0001', 'status: decided\nentities: [person:Ana, technology:redis]');
  const g = buildGraph(root);
  assert.ok(!g.nodes.some((n) => /ana/i.test(n.id)));
  assert.ok(g.problems.some((p) => /people are not entities/.test(p)));
});

test('graph: --check reports dangling links, open contradictions and decisions outside the graph', () => {
  const root = project();
  record(root, 'decisions', 'D-0001', 'status: decided\nentities: [concept:pricing]\ncontradicts: [D-0002]\nrelated: [D-0099]');
  record(root, 'decisions', 'D-0002', 'status: decided');
  const g = buildGraph(root);
  assert.deepEqual(g.contradictions, [{ between: ['D-0001', 'D-0002'] }]);
  assert.ok(g.problems.some((p) => /D-0099, which has no record/.test(p)));
  assert.ok(g.problems.some((p) => /D-0002-x\.md: no entities/.test(p)));
  assert.equal(spawnSync('node', [CLI, 'graph', '--check'], { cwd: root }).status, 1);
  record(root, 'decisions', 'D-0002', 'status: superseded\nentities: [concept:pricing]');
  record(root, 'decisions', 'D-0001', 'status: decided\nentities: [concept:pricing]\ncontradicts: [D-0002]');
  assert.deepEqual(buildGraph(root).contradictions, [], 'a superseded decision is history, not a contradiction');
  assert.equal(spawnSync('node', [CLI, 'graph', '--check'], { cwd: root }).status, 0);
});

test('graph: a constraint or risk met by three decisions is surfaced as a candidate pattern', () => {
  const root = project();
  for (const n of [1, 2, 3]) record(root, 'decisions', `D-000${n}`, 'status: decided\nentities: [constraint:legal-review, technology:node]');
  const g = buildGraph(root);
  assert.deepEqual(g.recurring, [{ entity: 'constraint:legal-review', decisions: ['D-0001', 'D-0002', 'D-0003'] }]);
});

test('graph: --write produces a generated view; the graph itself is never a source of truth', () => {
  const root = project();
  record(root, 'decisions', 'D-0001', 'status: decided\nentities: [tool:vite]');
  execFileSync('node', [CLI, 'graph', '--write'], { cwd: root });
  const md = fs.readFileSync(path.join(root, '.coda/graph.md'), 'utf8');
  assert.match(md, /```mermaid\ngraph LR/);
  assert.match(md, /Do not edit/);
  record(root, 'decisions', 'D-0002', 'status: decided\nentities: [tool:vite]');
  assert.equal(buildGraph(root).entities[0].decisions.length, 2, 'the graph follows the records without regenerating anything');
  assert.equal(d(root, bash(`node "${CLI}" graph --around vite --format mermaid`, { agent_type: 'coda:memory' })), 'allow');
});

test('graph: related and contradicts are one edge per pair, whichever record declares them', () => {
  const root = project();
  record(root, 'decisions', 'D-0001', 'status: decided\nentities: [concept:a]\nrelated: [D-0002]');
  record(root, 'decisions', 'D-0002', 'status: decided\nentities: [concept:a]\nrelated: [D-0001]');
  assert.equal(buildGraph(root).edges.filter((e) => e.type === 'related').length, 1);
});
