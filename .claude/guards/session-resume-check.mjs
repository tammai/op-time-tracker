#!/usr/bin/env node
// Deterministic version of "on session start, check for an in-progress
// session and prompt to resume" — previously CLAUDE.md prose only.
// Claude Code SessionStart hook — reads hook input from stdin, injects
// additionalContext when .claude/memory/SESSION.md exists with
// status: in-progress. See the session-handoff skill for the file format.
//
// Also surfaces Graphify presence/freshness (graphify adoption, v1.42.0):
// SessionStart is deliberately the mechanism here, not a Stop hook — Stop
// hook output can only force continuation (`decision: "block"`) or stay
// silent, there is no documented non-blocking user-visible Stop output.
// Runs once per session, so this stays cheap and non-noisy.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const lines = []

const sessionPath = join(process.cwd(), '.claude', 'memory', 'SESSION.md')
if (existsSync(sessionPath)) {
  try {
    const content = readFileSync(sessionPath, 'utf-8')
    const match = content.match(/^status:\s*(\S+)/m)
    if (match && match[1].toLowerCase() === 'in-progress') {
      lines.push('Found .claude/memory/SESSION.md with status: in-progress. Before doing anything else, ask the user: resume this session (restore tasks and context) or start fresh (archive it)? See the session-handoff skill.')
    }
  } catch {
    // degrade silently, same as before
  }
}

const graphPath = join(process.cwd(), 'graphify-out', 'graph.json')
if (existsSync(graphPath)) {
  try {
    const graphCommit = execSync('git log -1 --format=%h -- graphify-out/graph.json', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (!graphCommit) {
      lines.push('Graphify: graphify-out/graph.json exists but is not yet committed.')
    } else {
      const changedSince = execSync(`git log --oneline ${graphCommit}..HEAD -- . ':(exclude)graphify-out'`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      if (changedSince) {
        const n = changedSince.split('\n').filter(Boolean).length
        lines.push(`Graphify: graph exists (last built at ${graphCommit}) — ${n} commit(s) since then touched files outside graphify-out/. Consider proposing a rebuild (\`graphify update .\`) before relying on it for structural navigation.`)
      } else {
        lines.push(`Graphify: graph exists (last built at ${graphCommit}), up to date with HEAD.`)
      }
    }
  } catch {
    // not a git repo, git missing, shallow clone edge case — degrade silently,
    // same fallback-to-grep/read behavior every consuming skill already has
  }
}

if (lines.length === 0) process.exit(0)

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join(' ')
  }
}))

process.exit(0)
