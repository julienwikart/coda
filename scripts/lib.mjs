// CODA core library. Zero dependencies, Node >= 18.
// Shared by the hook entry point (scripts/hook.mjs) and the CLI (bin/coda).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

export const CODA_DIR = '.coda';
export const LEVELS = ['observed', 'supervised', 'bounded'];
export const ROLES = ['intent-architect', 'ethical-guardian', 'system-orchestrator', 'sovereign-maker'];
export const COGNITIVE_AGENTS = ['memory', 'pattern', 'simulation', 'coordination'];
export const EXECUTION_AGENTS = ['builder', 'verifier'];

export const DEFAULT_CONFIG = {
  version: 1,
  team: { name: '', humans: [] },
  autonomy: {
    level: 'supervised',
    since: null,
    perimeter: {
      write: ['src/**', 'lib/**', 'app/**', 'tests/**', 'test/**', 'docs/**'],
      protected: ['.env*', '**/.env*', '**/*.pem', '**/*.key', '.github/workflows/**', 'infra/**'],
      askCommands: ['git push*', 'npm publish*', 'docker push*', 'gh pr merge*', 'gh release*'],
      denyCommands: ['git push --force*', 'git push -f*', 'git reset --hard*', 'rm -rf /*', 'rm -rf ~*', 'terraform apply*', 'terraform destroy*', 'kubectl delete*'],
    },
  },
  verify: { commands: [], timeoutSeconds: 600, maxBlocks: 3, requireReview: false },
  journal: { commit: true, commands: 'redacted' },
};

// ---------------------------------------------------------------- project root

export function findRoot(start) {
  const candidates = [start, process.env.CLAUDE_PROJECT_DIR, process.cwd()].filter(Boolean);
  for (const c of candidates) {
    let dir = path.resolve(c);
    for (;;) {
      if (fs.existsSync(path.join(dir, CODA_DIR, 'config.json'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function codaPath(root, ...parts) {
  return path.join(root, CODA_DIR, ...parts);
}

function merge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

export function loadConfig(root) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(codaPath(root, 'config.json'), 'utf8'));
  } catch (e) {
    // A broken config must never widen permissions: fall back to the most restrictive level.
    return merge(DEFAULT_CONFIG, { autonomy: { level: 'observed' }, _error: String(e.message || e) });
  }
  const cfg = merge(DEFAULT_CONFIG, raw);
  if (!LEVELS.includes(cfg.autonomy.level)) {
    cfg._error = `unknown autonomy level "${cfg.autonomy.level}"`;
    cfg.autonomy.level = 'observed';
  }
  return cfg;
}

export function saveConfig(root, cfg) {
  const { _error, ...clean } = cfg;
  fs.writeFileSync(codaPath(root, 'config.json'), JSON.stringify(clean, null, 2) + '\n');
}

// ------------------------------------------------------------------- globbing

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

export function matchAny(globs, rel) {
  return (globs || []).some((g) => globToRegExp(g).test(rel));
}

// Command patterns: `*` matches anything (including spaces and slashes).
export function matchCommand(patterns, cmd) {
  const c = cmd.trim().replace(/\s+/g, ' ');
  return (patterns || []).find((p) => {
    const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(c);
  });
}

/** Path relative to the project root with forward slashes, or null when outside it. */
export function relPath(root, file) {
  if (!file) return null;
  let abs = path.resolve(root, file);
  try {
    // Resolve symlinks on the deepest existing ancestor so a link cannot smuggle a path out.
    let probe = abs;
    const tail = [];
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) { tail.unshift(path.basename(probe)); probe = path.dirname(probe); }
    abs = path.join(fs.realpathSync(probe), ...tail);
    root = fs.realpathSync(root);
  } catch { /* keep the lexical path */ }
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

// -------------------------------------------------------------------- journal

const SECRET_RE = [
  /((?:api[_-]?key|token|secret|passw(?:or)?d|authorization)\s*[=: ]\s*(?:(?:bearer|basic|token)\s+)?|\b(?:bearer|basic)\s+)("[^"]*"|'[^']*'|[^\s"']+)/gi,
  /\b(sk|pk|ghp|gho|ghs|glpat|xox[abp])[-_][A-Za-z0-9_-]{12,}\b/g,
  /\b[A-Za-z0-9+/_-]{40,}\b/g,
];

export function redact(text, max = 200) {
  let t = String(text ?? '');
  t = t.replace(SECRET_RE[0], '$1[redacted]').replace(SECRET_RE[1], '[redacted]').replace(SECRET_RE[2], '[redacted]');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function withLock(lockFile, fn) {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      try { return fn(); } finally { fs.closeSync(fd); fs.rmSync(lockFile, { force: true }); }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lockFile).mtimeMs > 5000) fs.rmSync(lockFile, { force: true }); } catch { /* raced */ }
      if (Date.now() > deadline) return fn(); // never lose an event because of a stale lock
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
}

function lastLine(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').trimEnd();
    if (!txt) return null;
    return txt.slice(txt.lastIndexOf('\n') + 1);
  } catch { return null; }
}

export function lineHash(line) {
  return crypto.createHash('sha256').update(line).digest('hex').slice(0, 16);
}

export function streamId(session) {
  return String(session || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'local';
}

/**
 * Append one event to the journal. The journal is append-only: one stream per
 * session (so teammates never conflict in git), each line chained to the
 * previous one by hash so that edits and deletions are detectable.
 */
export function appendEvent(root, { type, actor = 'harness', session, data = {} }) {
  const now = new Date();
  const dir = codaPath(root, 'journal', now.toISOString().slice(0, 7));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${streamId(session)}.jsonl`);
  return withLock(file + '.lock', () => {
    const prevLine = lastLine(file);
    let seq = 1;
    if (prevLine) { try { seq = (JSON.parse(prevLine).seq || 0) + 1; } catch { /* corrupted tail: verify will flag it */ } }
    const event = { v: 1, ts: now.toISOString(), seq, type, actor, session: streamId(session), data, prev: prevLine ? lineHash(prevLine) : null };
    fs.appendFileSync(file, JSON.stringify(event) + '\n');
    return event;
  });
}

export function journalFiles(root) {
  const base = codaPath(root, 'journal');
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const month of fs.readdirSync(base).sort()) {
    const d = path.join(base, month);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d).sort()) if (f.endsWith('.jsonl')) out.push(path.join(d, f));
  }
  return out;
}

export function readEvents(root, { since, types } = {}) {
  const events = [];
  for (const f of journalFiles(root)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (since && e.ts < since) continue;
        if (types && !types.some((t) => e.type === t || e.type.startsWith(t + '.'))) continue;
        events.push(e);
      } catch { /* reported by verifyJournal */ }
    }
  }
  return events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq));
}

export function verifyJournal(root) {
  const problems = [];
  let count = 0;
  for (const f of journalFiles(root)) {
    let prev = null; let seq = 0;
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
    lines.forEach((line, i) => {
      count++;
      let e;
      try { e = JSON.parse(line); } catch { problems.push(`${f}:${i + 1} is not valid JSON`); prev = line; return; }
      if (e.seq !== seq + 1) problems.push(`${f}:${i + 1} sequence jumps from ${seq} to ${e.seq} (event removed or inserted)`);
      if ((e.prev || null) !== (prev ? lineHash(prev) : null)) problems.push(`${f}:${i + 1} does not chain to the previous line (earlier event was modified)`);
      seq = e.seq; prev = line;
    });
  }
  return { count, files: journalFiles(root).length, problems };
}

// ------------------------------------------------------------ git & fingerprint

export function git(root, args, opts = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, ...opts }).trimEnd();
  } catch { return null; }
}

/**
 * Fingerprint of the deliverable state of the working tree (everything except
 * .coda/). Two equal fingerprints mean nothing a verification would look at changed.
 */
export function fingerprint(root) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain', '--untracked-files=all', '--', '.', `:(exclude)${CODA_DIR}`]);
  if (status === null) return null; // not a git repository
  const h = crypto.createHash('sha256').update(head || 'no-head').update('\0').update(status).update('\0');
  h.update(git(root, ['diff', 'HEAD', '--', '.', `:(exclude)${CODA_DIR}`]) || git(root, ['diff', '--', '.', `:(exclude)${CODA_DIR}`]) || '');
  for (const line of status.split('\n')) {
    if (!line.startsWith('??')) continue;
    try { h.update(line).update(fs.readFileSync(path.join(root, line.slice(3).replace(/^"|"$/g, '')))); } catch { /* unreadable: name is enough */ }
  }
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- local state

// Machine-local, never committed: verification baselines and block counters.
export function loadState(root, session) {
  try { return JSON.parse(fs.readFileSync(codaPath(root, '.state', `${streamId(session)}.json`), 'utf8')); } catch { return {}; }
}

export function saveState(root, session, state) {
  const dir = codaPath(root, '.state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${streamId(session)}.json`), JSON.stringify(state));
}

export function loadVerified(root) {
  try { return JSON.parse(fs.readFileSync(codaPath(root, '.state', 'verified.json'), 'utf8')); } catch { return {}; }
}

export function saveVerified(root, v) {
  const dir = codaPath(root, '.state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'verified.json'), JSON.stringify(v));
}

// --------------------------------------------------------------- verification

export function runVerify(root, cfg) {
  const results = [];
  for (const command of cfg.verify.commands || []) {
    const started = Date.now();
    const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', timeout: (cfg.verify.timeoutSeconds || 600) * 1000, maxBuffer: 32 * 1024 * 1024 });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    const ok = r.status === 0 && !r.error;
    results.push({ command, ok, code: r.status, ms: Date.now() - started, timedOut: r.error?.code === 'ETIMEDOUT', tail: output.split('\n').slice(-40).join('\n').trim() });
    if (!ok) break;
  }
  return { ok: results.every((r) => r.ok), results };
}

// ------------------------------------------------------------- memory records

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function listRecords(root, kind) {
  const dir = codaPath(root, kind);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const { meta, body } = parseFrontmatter(text);
    const title = meta.title || (/^#\s+(.+)$/m.exec(body) || [])[1] || f;
    return { file: `${CODA_DIR}/${kind}/${f}`, id: meta.id || f.split('-')[0], title, meta, body };
  });
}

export function nextId(root, kind, prefix) {
  const max = listRecords(root, kind).reduce((n, r) => Math.max(n, parseInt(String(r.id).replace(/\D/g, ''), 10) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export function slugify(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
}

export function intentSummary(root) {
  try {
    const { meta, body } = parseFrontmatter(fs.readFileSync(codaPath(root, 'intent.md'), 'utf8'));
    const section = (name) => {
      const m = new RegExp(`^##\\s+${name}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm').exec(body + '\n## ');
      return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
    };
    return { meta, purpose: section('Purpose'), constraints: section('Non-negotiable constraints'), outOfScope: section('Out of scope'), body };
  } catch { return null; }
}
