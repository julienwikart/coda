#!/usr/bin/env node
// CODA harness adapter for Claude Code hooks.
// One entry point for every hook event; it is a no-op in projects without .coda/.
// Guardrails are decided here, from .coda/config.json — not from instructions
// the model could ignore.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findRoot, loadConfig, appendEvent, relPath, matchAny, matchCommand, redact,
  fingerprint, loadState, saveState, loadVerified, saveVerified, runVerify,
  COGNITIVE_AGENTS, CODA_DIR,
} from './lib.mjs';
import { brief } from './brief.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function out(obj) { process.stdout.write(JSON.stringify(obj)); }

export function actorOf(input) {
  const t = String(input.agent_type || '').replace(/^coda:/, '');
  return t ? `agent:${t}` : 'agent:main';
}

// ------------------------------------------------------------ command reading

const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'pwd', 'echo', 'which', 'tree', 'stat', 'file', 'du', 'df', 'date', 'cd', 'test', '[', 'jq', 'sort', 'uniq', 'cut', 'true', 'diff', 'basename', 'dirname', 'realpath']);
const GIT_READ_ONLY = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'shortlog', 'describe', 'grep']);

const OWN_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'coda.mjs');

/** True only for this plugin's own CLI — a look-alike script inside the project does not count. */
function isOwnCli(word) {
  const p = String(word || '').replace(/^["']|["']$/g, '');
  return path.isAbsolute(p) && path.resolve(p) === OWN_CLI;
}

/**
 * A single invocation of the CODA CLI that only reads, appends to the journal
 * or runs the configured verification: approved without a prompt, so that the
 * framework's own bookkeeping never interrupts the humans.
 */
export function isCodaBookkeeping(command) {
  const c = String(command || '').trim();
  if (/[;&|<>`\n]|\$\(/.test(c)) return false;
  const m = /^node\s+("[^"]+"|'[^']+'|\S+)\s+([a-z-]+)/.exec(c);
  return Boolean(m && isOwnCli(m[1]) && ['brief', 'status', 'doctor', 'list', 'next-id', 'journal', 'verify'].includes(m[2]));
}

/** Conservative: anything not recognised as read-only counts as an action. */
export function isReadOnlyCommand(command) {
  let c = String(command || '').replace(/\d?>\s*\/dev\/null/g, '').replace(/2>&1/g, '');
  if (!c.trim()) return true;
  if (/[<>`]|\$\(/.test(c)) return false;
  for (const seg of c.split(/&&|\|\||[;|\n]/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (!words.length) continue;
    const [cmd, sub] = words;
    if (cmd === 'git') {
      const first = words.slice(1).find((w) => !w.startsWith('-'));
      if (!GIT_READ_ONLY.has(first)) return false;
    } else if (cmd === 'find') {
      if (words.some((w) => ['-delete', '-exec', '-execdir', '-ok', '-fprint', '-fprintf'].includes(w))) return false;
    } else if (cmd === 'node' && isOwnCli(sub)) {
      if (['level', 'init', 'verify'].includes(words[2])) return false;
    } else if (!READ_ONLY.has(cmd)) return false;
  }
  return true;
}

// -------------------------------------------------------------------- the guard

/** Returns { decision: 'allow' | 'ask' | 'deny' | null, reason }. null = leave it to the harness. */
export function decide(root, cfg, input) {
  const level = cfg.autonomy.level;
  const p = cfg.autonomy.perimeter;
  const actor = actorOf(input);
  const cognitive = COGNITIVE_AGENTS.includes(actor.slice(6));
  const tool = input.tool_name;
  const ti = input.tool_input || {};

  if (WRITE_TOOLS.has(tool)) {
    const file = ti.file_path || ti.notebook_path || ti.path;
    const rel = relPath(root, file);
    if (rel === null) {
      const abs = path.resolve(root, String(file || ''));
      const scratch = [os.tmpdir(), input.scratchpad_dir].filter(Boolean).some((d) => abs.startsWith(path.resolve(d) + path.sep));
      if (scratch && !cognitive) return { decision: null };
      return { decision: level === 'observed' || cognitive ? 'deny' : 'ask', reason: `${file} is outside the project, so outside the perimeter this team delegated.` };
    }
    if (rel.startsWith(`${CODA_DIR}/journal/`) || rel.startsWith(`${CODA_DIR}/.state/`))
      return { decision: 'deny', reason: 'The CODA journal is append-only and written by the harness. To add an event use `coda journal add`; existing events are never edited.' };
    if (rel === `${CODA_DIR}/config.json`)
      return { decision: 'ask', reason: 'Changing .coda/config.json changes what agents are allowed to do (autonomy level, perimeter, verification). A human decides.' };
    if (rel.startsWith(`${CODA_DIR}/`)) return { decision: null };
    if (cognitive) return { decision: 'deny', reason: `Cognitive agents (${actor.slice(6)}) steer, they do not deliver: only execution agents write outside .coda/.` };
    if (matchAny(p.protected, rel)) return { decision: 'deny', reason: `${rel} is protected by .coda/config.json (autonomy.perimeter.protected). A human makes this change.` };
    if (level === 'observed') return { decision: 'deny', reason: 'Autonomy level is "observed": agents propose changes, humans apply them. Describe the change instead of making it.' };
    if (level === 'supervised') return { decision: 'ask', reason: `Supervised execution: a human approves each change (${rel}).` };
    if (matchAny(p.write, rel)) return { decision: 'allow', reason: `Bounded autonomy: ${rel} is inside the delegated perimeter.` };
    return { decision: 'ask', reason: `Bounded autonomy: ${rel} is outside the delegated perimeter (autonomy.perimeter.write).` };
  }

  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    const readOnly = isReadOnlyCommand(cmd);
    if (!readOnly && /\.coda\/(journal|\.state)/.test(cmd))
      return { decision: 'deny', reason: 'The CODA journal is append-only: commands may read it, never modify it.' };
    for (const part of cmd.split(/&&|\|\||[;\n]/)) {
      const hit = matchCommand(p.denyCommands, part);
      if (hit) return { decision: 'deny', reason: `Command matches "${hit}" in autonomy.perimeter.denyCommands. A human runs this.` };
    }
    if (isCodaBookkeeping(cmd)) return { decision: 'allow', reason: 'CODA bookkeeping (read, journal append or configured verification).' };
    if (readOnly) return { decision: null };
    if (/coda\.mjs["']?\s+level\b/.test(cmd)) return { decision: 'ask', reason: 'Changing the autonomy level is a human decision.' };
    if (cognitive) return { decision: 'deny', reason: `Cognitive agents (${actor.slice(6)}) only read: they cannot run commands that act on the project.` };
    if (level === 'observed') return { decision: 'deny', reason: 'Autonomy level is "observed": agents propose commands, humans run them.' };
    if (level === 'supervised') return { decision: 'ask', reason: 'Supervised execution: a human approves each command that acts on the project.' };
    for (const part of cmd.split(/&&|\|\||[;\n]/)) {
      const hit = matchCommand(p.askCommands, part);
      if (hit) return { decision: 'ask', reason: `Command matches "${hit}" in autonomy.perimeter.askCommands: it leaves the perimeter, a human confirms.` };
    }
    return { decision: null };
  }
  return { decision: null };
}

// --------------------------------------------------------------------- events

function preToolUse(root, cfg, input) {
  const d = decide(root, cfg, input);
  if (!d.decision) return;
  if (d.decision !== 'allow') {
    const ti = input.tool_input || {};
    appendEvent(root, { type: d.decision === 'deny' ? 'guard.denied' : 'guard.asked', actor: actorOf(input), session: input.session_id, data: { tool: input.tool_name, target: ti.file_path ? relPath(root, ti.file_path) || ti.file_path : redact(ti.command, 120), level: cfg.autonomy.level, reason: d.reason } });
  }
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: `CODA: ${d.reason}` } });
}

function postToolUse(root, cfg, input) {
  const ti = input.tool_input || {};
  if (WRITE_TOOLS.has(input.tool_name)) {
    const rel = relPath(root, ti.file_path || ti.notebook_path || ti.path);
    if (rel && !rel.startsWith(`${CODA_DIR}/.state/`)) appendEvent(root, { type: 'tool.write', actor: actorOf(input), session: input.session_id, data: { tool: input.tool_name, path: rel } });
  } else if (input.tool_name === 'Bash' && cfg.journal.commands !== 'off' && !isReadOnlyCommand(ti.command)) {
    appendEvent(root, { type: 'tool.command', actor: actorOf(input), session: input.session_id, data: { command: cfg.journal.commands === 'full' ? String(ti.command).slice(0, 2000) : redact(ti.command) } });
  }
}

function sessionStart(root, cfg, input) {
  const state = loadState(root, input.session_id);
  if (!state.baseline) { state.baseline = fingerprint(root); state.blocks = 0; saveState(root, input.session_id, state); }
  appendEvent(root, { type: 'session.start', session: input.session_id, data: { source: input.source || 'startup', level: cfg.autonomy.level } });
  out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief(root, cfg) } });
}

function subagentStart(root, cfg, input) {
  appendEvent(root, { type: 'run.start', actor: actorOf(input), session: input.session_id, data: { agent: input.agent_type || 'unknown', run: input.agent_id || null } });
}

function subagentStop(root, cfg, input) {
  const agent = String(input.agent_type || 'unknown');
  appendEvent(root, { type: 'run.end', actor: actorOf(input), session: input.session_id, data: { agent, run: input.agent_id || null } });
  if (agent.replace(/^coda:/, '') !== 'verifier') return;
  const verdict = /CODA-VERDICT:\s*(PASS|FAIL)/i.exec(String(input.last_assistant_message || ''));
  if (!verdict) return;
  const fp = fingerprint(root);
  const passed = verdict[1].toUpperCase() === 'PASS';
  appendEvent(root, { type: passed ? 'review.passed' : 'review.failed', actor: 'agent:verifier', session: input.session_id, data: { fingerprint: fp } });
  if (passed) saveVerified(root, { ...loadVerified(root), reviewFp: fp });
}

function stop(root, cfg, input) {
  const commands = cfg.verify.commands || [];
  if (!commands.length && !cfg.verify.requireReview) return;
  const fp = fingerprint(root);
  if (fp === null) return;
  const state = loadState(root, input.session_id);
  if (state.baseline === fp) return; // nothing deliverable changed in this session
  const verified = loadVerified(root);
  const giveUp = (why) => {
    appendEvent(root, { type: 'verify.unresolved', session: input.session_id, data: { fingerprint: fp, why } });
    out({ systemMessage: `CODA: stopping with unverified changes (${why}). Recorded in the journal as verify.unresolved — a human should look before this is accepted.` });
  };
  const block = (why, reason) => {
    state.blocks = (state.blocks || 0) + 1;
    saveState(root, input.session_id, state);
    if (state.blocks > (cfg.verify.maxBlocks || 3)) return giveUp(why);
    out({ decision: 'block', reason });
  };

  if (commands.length && verified.fp !== fp) {
    const res = runVerify(root, cfg);
    appendEvent(root, { type: res.ok ? 'verify.passed' : 'verify.failed', session: input.session_id, data: { fingerprint: fp, results: res.results.map(({ command, ok, code, ms }) => ({ command, ok, code, ms })) } });
    if (!res.ok) {
      const f = res.results.find((r) => !r.ok);
      return block('verification failing', `CODA verification gate: \`${f.command}\` ${f.timedOut ? 'timed out' : `failed (exit ${f.code})`}. No output is accepted without passing verification. Fix the cause — do not weaken or skip the check — then finish.\n\n${f.tail}`);
    }
    verified.fp = fp;
    saveVerified(root, verified);
  }
  if (cfg.verify.requireReview && verified.reviewFp !== fp)
    return block('review missing', 'CODA verification gate: these changes have not been reviewed. Delegate a review of the current diff to the `coda:verifier` agent; it must end with `CODA-VERDICT: PASS`. If it fails, fix the findings and have it review again.');
  if (state.blocks) { state.blocks = 0; saveState(root, input.session_id, state); }
}

function sessionEnd(root, cfg, input) {
  appendEvent(root, { type: 'session.end', session: input.session_id, data: { reason: input.reason || null } });
}

const HANDLERS = { PreToolUse: preToolUse, PostToolUse: postToolUse, SessionStart: sessionStart, SubagentStart: subagentStart, SubagentStop: subagentStop, Stop: stop, SessionEnd: sessionEnd };

function main() {
  const input = readInput();
  const root = findRoot(input.cwd);
  if (!root) return; // project has not adopted CODA
  const handler = HANDLERS[input.hook_event_name || process.argv[2]];
  if (!handler) return;
  const cfg = loadConfig(root);
  try {
    handler(root, cfg, input);
  } catch (e) {
    // The guard fails closed, everything else fails open.
    if (input.hook_event_name === 'PreToolUse' && (WRITE_TOOLS.has(input.tool_name) || input.tool_name === 'Bash')) {
      out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `CODA guard error (${e.message}); asking a human.` } });
    } else process.stderr.write(`coda hook: ${e.stack || e}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('hook.mjs')) main();
