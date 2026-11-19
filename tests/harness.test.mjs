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
  for (const c of ['ls -la', 'git status && git diff HEAD', 'cat a | grep b', 'git log --oneline 2>/dev/null'])
    assert.ok(isReadOnlyCommand(c), c);
  for (const c of ['rm -rf x', 'echo hi > file', 'git commit -m x', 'cat a && npm test', 'ls $(rm x)', 'find . -delete', 'git -C . push', 'sed -i s/a/b/ f'])
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
  assert.equal(spawnSync('node', [CLI, 'journal', 'add', 'decision.recorded', '--data', '{"id":"D-0001"}'], { cwd: root }).status, 0);
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
  assert.equal(d(root, bash(`node "${CLI}" journal add decision.recorded --data '{"id":"D-0001"}'`)), 'allow');
  assert.ok(!isCodaBookkeeping(`node "${CLI}" status && rm -rf src`));
  assert.ok(!isCodaBookkeeping(`node "${CLI}" level bounded --by x --reason y`));
  assert.ok(!isCodaBookkeeping('node scripts/coda.mjs status'), 'a project-local script named coda.mjs is not the CLI');
  assert.equal(d(root, bash('node scripts/coda.mjs status')), 'deny');
});
