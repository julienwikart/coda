---
name: status
description: Show where the team stands — intent, humans and roles, autonomy level, decisions in force, open patterns, verification state, journal health, and the entry conditions. Use when the user asks for CODA status, a dashboard or overview, or whether the harness is working.
---

# Status

The CODA command line is `node "${CLAUDE_PLUGIN_ROOT}/scripts/coda.mjs"`, written `coda` below. Run it from the project root.

Run `coda status` (facts as JSON) and `coda doctor` (is the harness really in place), and present the result as a short overview a human can take in at a glance: the team and who holds which role; the autonomy level and since when; whether the intent is active; decisions in force and open patterns, with the latest few by title; whether the current working tree has passed verification and review; the last 30 days in numbers (sessions, agent runs, verification passed/failed/unresolved, guard denials); and whether the journal is intact.

Lead with whatever needs a human: a broken journal chain, unresolved verifications, a missing role, an intent still in draft, verification not configured. If everything is in order, say so in one line rather than listing green checks.

Report the numbers as they are. They describe the system, not people: do not turn session or run counts into a comment on anyone's activity.
