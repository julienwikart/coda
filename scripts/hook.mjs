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
  fingerprint, loadState, saveState, loadVerified, saveVerified, runVerify, noteSession,
  COGNITIVE_AGENTS, CODA_DIR,
} from './lib.mjs';
import { brief, orgBrief } from './brief.mjs';
import { resolveOrg, inOrgDir, findOrgRoot, orgAt, orgPath, teamsOf, owningTeam, ORG_DIR } from './org.mjs';

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
  if (!m || !isOwnCli(m[1])) return false;
  if (m[2] === 'org') return /^node\s+("[^"]+"|'[^']+'|\S+)\s+org\s+(status|sync|map|check|decisions|pending|audit|next-id|rule(?!\s+set))\b/.test(c);
  if (m[2] === 'scope') return !/\sscope\s+set\b/.test(c); // reading, or refreshing the local copy
  return ['brief', 'status', 'doctor', 'list', 'next-id', 'journal', 'verify', 'graph'].includes(m[2]);
}

/** Conservative: anything not recognised as read-only counts as an action. */
export function isReadOnlyCommand(command) {
  let c = String(command || '').replace(/\d?>\s*\/dev\/null/g, '').replace(/2>&1/g, '');
  if (!c.trim()) return true;
  if (/`|\$\(/.test(c)) return false; // substitution runs commands, also inside double quotes
  // What is inside quotes is an argument, not shell syntax: a quoted | or ; does not split the command.
  c = c.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, 'Q');
  if (/[<>'"]/.test(c)) return false; // redirection, or an unbalanced quote we will not guess about
  for (const seg of c.split(/&&|\|\||[;|\n]/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    // Shell control flow: a loop or a test over read-only commands is still read-only.
    if (words[0] === 'for' && words[2] === 'in') continue;
    while (words.length && ['do', 'then', 'else', 'elif', 'if', 'while', '!'].includes(words[0])) words.shift();
    if (words.length === 1 && ['done', 'fi'].includes(words[0])) continue;
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (!words.length) continue;
    const [cmd, sub] = words;
    if (cmd === 'git') {
      let rest = words.slice(1);
      if (rest[0] === '-C' && rest.length > 2) rest = rest.slice(2); // run in another directory
      const first = rest.find((w) => !w.startsWith('-'));
      // `git branch` only lists when it is given flags and no name.
      const listing = first === 'branch' && rest.filter((w) => w !== 'branch').every((w) => /^(-a|-r|-v|-vv|--all|--remotes|--list|--show-current|--no-color)$/.test(w));
      if (!GIT_READ_ONLY.has(first) && !listing) return false;
    } else if (cmd === 'xargs') {
      const target = words.slice(1).find((w) => !w.startsWith('-') && !/^\d+$/.test(w));
      if (!target || target === 'git' || target === 'find' || target === 'xargs' || !READ_ONLY.has(target)) return false;
    } else if (cmd === 'find') {
      if (words.some((w) => ['-delete', '-exec', '-execdir', '-ok', '-fprint', '-fprintf'].includes(w))) return false;
    } else if (cmd === 'node' && isOwnCli(sub)) {
      if (['level', 'init', 'verify'].includes(words[2])) return false;
      if (words[2] === 'org' && !(['status', 'map', 'check', 'decisions', 'pending', 'audit', 'next-id'].includes(words[3]) || (words[3] === 'rule' && words[4] !== 'set'))) return false;
      if (words[2] === 'scope' && words[3] === 'set') return false;
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
    // What the organisation shares is changed by a human, wherever it sits relative to this team.
    let org = null; try { org = resolveOrg(root, cfg, { refresh: 'never' }); } catch { /* unreadable: the generic rules below still apply */ }
    let abs = path.resolve(root, String(file || '')); try { abs = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { /* new directory */ }
    const orgRel = inOrgDir(org, abs) ?? (rel !== null && rel.startsWith(`${ORG_DIR}/`) ? rel.slice(ORG_DIR.length + 1) : null);
    if (orgRel !== null) {
      if (orgRel.startsWith('journal/')) return { decision: 'deny', reason: 'The organisation journal is append-only and written by the harness.' };
      if (org?.source === 'remote') return { decision: 'deny', reason: `This is a read-only copy of the organisation repository (${org.location}). Changes are made there, by pull request.` };
      return { decision: 'ask', reason: `${ORG_DIR}/ holds what every team shares (intent, constraints, the list of teams). A human of the organisation decides each change.` };
    }
    // In a repository several teams share, another team's directory is not this team's to write in.
    if (org && !org.error) {
      let other = null; try { other = owningTeam(teamsOf(org, { selfRoot: root, selfName: cfg.team.name }), abs, cfg.team.name); } catch { /* map unreadable: generic rules apply */ }
      if (other) return { decision: 'deny', team: other.name, reason: `${file} is in the directory of team "${other.name}". It is theirs to change: tell the human which team this request reaches, and stop there until the teams have agreed how to proceed.` };
    }
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
    if (!readOnly && /\.coda(-org)?\/(journal|\.state)/.test(cmd))
      return { decision: 'deny', reason: 'The CODA journal is append-only: commands may read it, never modify it.' };
    for (const part of cmd.split(/&&|\|\||[;\n]/)) {
      const hit = matchCommand(p.denyCommands, part);
      if (hit) return { decision: 'deny', reason: `Command matches "${hit}" in autonomy.perimeter.denyCommands. A human runs this.` };
    }
    if (!readOnly && cmd.includes(`${ORG_DIR}/`) && !isCodaBookkeeping(cmd)) return { decision: cognitive || level === 'observed' ? 'deny' : 'ask', reason: `This command acts on ${ORG_DIR}/, which holds what every team shares. A human of the organisation decides each change.` };
    if (isCodaBookkeeping(cmd)) return { decision: 'allow', reason: 'CODA bookkeeping (read, journal append or configured verification).' };
    if (readOnly) return { decision: null };
    if (/coda\.mjs["']?\s+scope\s+set\b/.test(cmd)) return { decision: 'ask', reason: 'Declaring what a team carries is a human decision.' };
    if (/coda\.mjs["']?\s+org\s+(init|join|add-team)\b/.test(cmd)) return { decision: 'ask', reason: 'Creating an organisation, joining one or changing its list of teams is a human decision.' };
    if (/coda\.mjs["']?\s+org\s+(record|rule\s+set)\b/.test(cmd)) return { decision: cognitive ? 'deny' : 'ask', reason: 'A decision between teams, and the rule that says who takes it, are a human\'s.' };
    if (/coda\.mjs["']?\s+level\b/.test(cmd)) return { decision: 'ask', reason: 'Changing the autonomy level is a human decision.' };
    if (cognitive) return { decision: 'deny', reason: `Cognitive agents (${actor.slice(6)}) only read: they cannot run commands that act on the project. Use Read, Grep and Glob, plain read-only commands (cat, ls, grep, git log, git diff), or the CODA CLI called directly, one invocation per command and without shell variables.` };
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
    appendEvent(root, { type: d.decision === 'deny' ? 'guard.denied' : 'guard.asked', actor: actorOf(input), session: input.session_id, data: { tool: input.tool_name, target: ti.file_path ? relPath(root, ti.file_path) || ti.file_path : redact(ti.command, 120), level: cfg.autonomy.level, reason: d.reason, ...(d.team ? { otherTeam: d.team } : {}) } });
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
  // The one moment the organisation is refreshed: time-boxed, and the last copy serves if it fails.
  out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: brief(root, cfg, { refresh: 'if-stale', timeoutMs: 8000 }) } });
}

function subagentStart(root, cfg, input) {
  appendEvent(root, { type: 'run.start', actor: actorOf(input), session: input.session_id, data: { agent: input.agent_type || 'unknown', run: input.agent_id || null } });
}

function subagentStop(root, cfg, input) {
  const agent = String(input.agent_type || 'unknown');
  if (!input._quiet) appendEvent(root, { type: 'run.end', actor: actorOf(input), session: input.session_id, data: { agent, run: input.agent_id || null } });
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
    return true;
  };
  const block = (why, reason) => {
    state.blocks = (state.blocks || 0) + 1;
    saveState(root, input.session_id, state);
    if (state.blocks > (cfg.verify.maxBlocks || 3)) return giveUp(why);
    out({ decision: 'block', reason });
    return true;
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
  return false;
}

function sessionEnd(root, cfg, input) {
  appendEvent(root, { type: 'session.end', session: input.session_id, data: { reason: input.reason || null } });
}

const HANDLERS = { PreToolUse: preToolUse, PostToolUse: postToolUse, SessionStart: sessionStart, SubagentStart: subagentStart, SubagentStop: subagentStop, Stop: stop, SessionEnd: sessionEnd };

// ------------------------------------------- a session at the organisation's root
//
// Started above every team, a session has no team of its own. A change to a
// file is then judged by the rules of the team whose directory holds it, and
// each team it touched must pass its own verification before the session ends.

function teamOwningFile(orgDir, file) {
  let dir = path.resolve(orgDir, String(file || ''));
  try { dir = fs.realpathSync(fs.existsSync(dir) ? dir : path.dirname(dir)); } catch { dir = path.dirname(dir); }
  const top = fs.realpathSync(orgDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CODA_DIR, 'config.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir || dir === top || path.relative(top, dir).startsWith('..')) return null;
    dir = parent;
  }
}

function orgState(orgDir, session) {
  const file = orgPath(orgDir, '.state', `${String(session || 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16)}.json`);
  return {
    get() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { teams: [] }; } },
    set(v) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(v)); },
  };
}

export function decideAtOrg(orgDir, input) {
  const actor = actorOf(input);
  const cognitive = COGNITIVE_AGENTS.includes(actor.slice(6));
  const ti = input.tool_input || {};
  if (WRITE_TOOLS.has(input.tool_name)) {
    const file = ti.file_path || ti.notebook_path || ti.path;
    const team = teamOwningFile(orgDir, file);
    if (team) return { ...decide(team, loadConfig(team), { ...input, cwd: team }), teamRoot: team };
    const abs = path.resolve(orgDir, String(file || ''));
    const rel = relPath(orgDir, abs);
    if (rel !== null && rel.startsWith(`${ORG_DIR}/`)) {
      if (rel.startsWith(`${ORG_DIR}/journal/`) || rel.startsWith(`${ORG_DIR}/.state/`)) return { decision: 'deny', reason: 'The organisation journal is append-only and written by the harness.' };
      if (cognitive) return { decision: 'deny', reason: 'Cognitive agents only read.' };
      return { decision: 'ask', reason: `${ORG_DIR}/ holds what every team shares. A human of the organisation decides each change.` };
    }
    if (rel === null) {
      const scratch = [os.tmpdir(), input.scratchpad_dir].filter(Boolean).some((d) => abs.startsWith(path.resolve(d) + path.sep));
      if (scratch && !cognitive) return { decision: null };
    }
    return { decision: cognitive ? 'deny' : 'ask', reason: `${file} is carried by no team. A human decides changes outside every team's scope.` };
  }
  if (input.tool_name === 'Bash') {
    const cmd = String(ti.command || '');
    const readOnly = isReadOnlyCommand(cmd);
    if (!readOnly && /\.coda(-org)?\/(journal|\.state)/.test(cmd)) return { decision: 'deny', reason: 'CODA journals are append-only: commands may read them, never modify them.' };
    if (readOnly) return { decision: null };
    if (cognitive) return { decision: 'deny', reason: 'Cognitive agents only read.' };
    return { decision: 'ask', reason: 'This session started at the organisation\'s root, in no team\'s directory: a human approves each command that acts on the repository.' };
  }
  return { decision: null };
}

function orgSession(orgDir, input) {
  const base = orgPath(orgDir);
  const event = input.hook_event_name || process.argv[2];
  const st = orgState(orgDir, input.session_id);
  const touch = (team) => { const s = st.get(); if (!s.teams.includes(team)) { s.teams.push(team); st.set(s); } };
  const ti = input.tool_input || {};
  if (event === 'SessionStart') {
    appendEvent(orgDir, { type: 'session.start', session: input.session_id, base, data: { source: input.source || 'startup', at: 'organisation root' } });
    out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: orgBrief(orgAt(orgDir)) } });
  } else if (event === 'PreToolUse') {
    const d = decideAtOrg(orgDir, input);
    if (d.teamRoot) {
      // The team's verification baseline is taken before the first change this session makes to it.
      const ts = loadState(d.teamRoot, input.session_id);
      if (!ts.baseline) { ts.baseline = fingerprint(d.teamRoot); ts.blocks = 0; saveState(d.teamRoot, input.session_id, ts); }
    }
    if (!d.decision) return;
    if (d.decision !== 'allow') appendEvent(d.teamRoot || orgDir, { type: d.decision === 'deny' ? 'guard.denied' : 'guard.asked', actor: actorOf(input), session: input.session_id, ...(d.teamRoot ? {} : { base }), data: { tool: input.tool_name, target: ti.file_path ? relPath(orgDir, ti.file_path) || ti.file_path : redact(ti.command, 120), reason: d.reason } });
    out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: `CODA: ${d.reason}` } });
  } else if (event === 'PostToolUse') {
    if (WRITE_TOOLS.has(input.tool_name)) {
      const file = ti.file_path || ti.notebook_path || ti.path;
      const team = teamOwningFile(orgDir, file);
      if (team) { touch(team); postToolUse(team, loadConfig(team), input); }
      else appendEvent(orgDir, { type: 'tool.write', actor: actorOf(input), session: input.session_id, base, data: { tool: input.tool_name, path: relPath(orgDir, file) || String(file) } });
    } else if (input.tool_name === 'Bash' && !isReadOnlyCommand(ti.command)) {
      appendEvent(orgDir, { type: 'tool.command', actor: actorOf(input), session: input.session_id, base, data: { command: redact(ti.command) } });
    }
  } else if (event === 'SubagentStart' || event === 'SubagentStop') {
    appendEvent(orgDir, { type: event === 'SubagentStart' ? 'run.start' : 'run.end', actor: actorOf(input), session: input.session_id, base, data: { agent: input.agent_type || 'unknown', run: input.agent_id || null } });
    if (event === 'SubagentStop') for (const team of st.get().teams) subagentStop(team, loadConfig(team), { ...input, agent_id: input.agent_id, _quiet: true });
  } else if (event === 'Stop') {
    for (const team of st.get().teams) if (stop(team, loadConfig(team), input)) return; // one gate at a time: the first team that is not verified holds the session
  } else if (event === 'SessionEnd') {
    appendEvent(orgDir, { type: 'session.end', session: input.session_id, base, data: { reason: input.reason || null } });
  }
}

function main() {
  const input = readInput();
  const root = findRoot(input.cwd);
  if (!root) {
    // Not inside any team. If this is the root of an organisation, the session is judged team by team.
    const orgDir = input.cwd ? findOrgRoot(input.cwd) : null;
    if (!orgDir) return; // project has not adopted CODA
    try { orgSession(orgDir, input); } catch (e) {
      if ((input.hook_event_name || process.argv[2]) === 'PreToolUse' && (WRITE_TOOLS.has(input.tool_name) || input.tool_name === 'Bash')) out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `CODA guard error (${e.message}); asking a human.` } });
      else process.stderr.write(`coda hook: ${e.stack || e}\n`);
    }
    return;
  }
  const handler = HANDLERS[input.hook_event_name || process.argv[2]];
  if (!handler) return;
  const cfg = loadConfig(root);
  try {
    if (input.session_id) noteSession(root, input.session_id);
    handler(root, cfg, input);
  } catch (e) {
    // The guard fails closed, everything else fails open.
    if (input.hook_event_name === 'PreToolUse' && (WRITE_TOOLS.has(input.tool_name) || input.tool_name === 'Bash')) {
      out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `CODA guard error (${e.message}); asking a human.` } });
    } else process.stderr.write(`coda hook: ${e.stack || e}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('hook.mjs')) main();
