#!/usr/bin/env node
// Autosaves in-flight session state before context compaction, so an auto-compact
// mid-task doesn't silently destroy it. Claude Code PreCompact hook — reads hook input
// from stdin (session_id, transcript_path, cwd, compaction_trigger: manual|auto) and
// writes/updates .claude/memory/SESSION.md in the exact shape the session-handoff skill
// uses, so session-resume-check.mjs (SessionStart) picks it up with no changes on its
// side. Always exits 0 — a PreCompact hook CAN block compaction (exit 2), but this one
// never should; a failed autosave is a missed convenience, not a reason to freeze the
// session. Every fallible step is wrapped so one failure degrades that step only, not
// the whole guard.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const MARKER = '<!-- precompact-autosave -->'

function readStdinPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    return {}
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function gatherState(cwd) {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'unknown',
    status: git(['status', '--porcelain'], cwd),
    diffStat: git(['diff', '--stat'], cwd),
    staged: git(['diff', '--cached', '--name-only'], cwd)
  }
}

function renderUncommittedSection(state) {
  const body = state.diffStat || (state.status ? state.status : 'clean')
  const stagedLine = state.staged ? `\nStaged: ${state.staged.split('\n').join(', ')}` : ''
  return '```\n' + body + '\n```' + stagedLine
}

// Fresh SESSION.md, in session-handoff's exact template shape — populated only with what's
// deterministically gatherable. "What We Were Working On" / Tasks / Decisions Made are left
// as placeholders: a script can't summarize intent or judgment, only a human or the
// session-handoff skill itself can, and a wrong guess is worse than an honest blank.
function freshSessionMd(sessionId, nowIso, state) {
  return `---
session-id: ${sessionId}
created: ${nowIso}
last-updated: ${nowIso}
status: in-progress
---
${MARKER}

# Session Handoff

**Session saved:** ${nowIso}
**Branch:** ${state.branch}

## What We Were Working On

(autosaved before compaction — no summary captured yet; fill in on next manual save)

## Current State

### Tasks

(none captured by autosave — see TaskList)

### Decisions Made

(none captured by autosave)

### Uncommitted Changes

${renderUncommittedSection(state)}

### Next Steps
1. Resume from where compaction interrupted the session.

## Context Notes

Created by precompact-snapshot.mjs — a real session-handoff save will fill this in properly.
`
}

// Updates an existing SESSION.md in place — refreshes last-updated/status and the
// Uncommitted Changes section only. Decisions Made / Next Steps / Context Notes are left
// exactly as a human or session-handoff wrote them; this never overwrites judgment content.
function updateExisting(content, nowIso, state) {
  let updated = content
    .replace(/^last-updated:.*$/m, `last-updated: ${nowIso}`)
    .replace(/^status:\s*\S+$/m, 'status: in-progress')

  if (!updated.includes(MARKER)) {
    const fenceMatches = [...updated.matchAll(/^---\s*$/gm)]
    if (fenceMatches.length >= 2) {
      const closeIdx = fenceMatches[1].index + fenceMatches[1][0].length
      updated = updated.slice(0, closeIdx) + `\n${MARKER}` + updated.slice(closeIdx)
    }
  }

  const sectionRe = /(### Uncommitted Changes\n)([\s\S]*?)(?=\n###|\n## |$)/
  if (sectionRe.test(updated)) {
    updated = updated.replace(sectionRe, `$1\n${renderUncommittedSection(state)}\n`)
  }

  return updated
}

function main() {
  const payload = readStdinPayload()
  const cwd = payload.cwd || process.cwd()
  const nowIso = new Date().toISOString()
  const sessionDir = join(cwd, '.claude', 'memory')
  const sessionPath = join(sessionDir, 'SESSION.md')

  try {
    const state = gatherState(cwd)
    if (existsSync(sessionPath)) {
      const content = readFileSync(sessionPath, 'utf-8')
      writeFileSync(sessionPath, updateExisting(content, nowIso, state))
    } else {
      mkdirSync(sessionDir, { recursive: true })
      const sessionId = payload.session_id || randomUUID()
      writeFileSync(sessionPath, freshSessionMd(sessionId, nowIso, state))
    }
  } catch (err) {
    console.error(`precompact-snapshot: autosave failed, compaction proceeding — ${err.message}`)
  }

  process.exit(0)
}

main()
