#!/usr/bin/env node
// Blocks non-trivial Edit/Write/MultiEdit before PLAN.md is approved, and blocks
// edits governed by a PLAN.md left over from a different branch.
// Claude Code PreToolUse hook — reads tool input from stdin, exits 2 to block.
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const data = JSON.parse(readFileSync(0, 'utf-8'))
const toolName = data?.tool_name ?? ''
const toolInput = data?.tool_input ?? {}
const filePath = toolInput.file_path ?? ''

if (!filePath) process.exit(0)

// Trivial paths never require an approved plan: tests, docs, env examples, config files.
const TRIVIAL_PATTERNS = [
  /(^|[/\\])tests?[/\\]/i,
  /\.md$/i,
  /\.env\.example$/i,
  /(^|[/\\])(\.eslintrc(\.\w+)?|eslint\.config\.\w+|\.prettierrc(\.\w+)?|prettier\.config\.\w+|tsconfig(\.\w+)?\.json|vite\.config\.\w+|vitest\.config\.\w+|nuxt\.config\.\w+|\.editorconfig|\.gitignore|\.npmrc)$/i
]

if (TRIVIAL_PATTERNS.some(p => p.test(filePath))) process.exit(0)

function currentBranch() {
  try {
    const b = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return b === 'HEAD' ? null : b // detached HEAD — nothing to compare against
  } catch {
    return null // not a git repo, or git unavailable
  }
}

// `Branch:` is optional — plans written before it existed, or on a detached HEAD,
// simply skip the check. Never block on something git can't answer.
function branchVerdict(plan) {
  const declared = plan.match(/^Branch:\s*(\S+)/m)?.[1]
  if (!declared) return { ok: true }
  const actual = currentBranch()
  if (!actual || declared === actual) return { ok: true }
  return { ok: false, declared, actual }
}

// { ok: true } | { ok: false } | { ok: false, declared, actual } for a branch mismatch.
function planVerdict() {
  const planPath = join(process.cwd(), 'PLAN.md')
  if (!existsSync(planPath)) return { ok: false }
  const plan = readFileSync(planPath, 'utf-8')
  const status = plan.match(/^Status:\s*(\S+)/m)
  if (!status || status[1].toLowerCase() !== 'approved') return { ok: false }
  return branchVerdict(plan)
}

const verdict = planVerdict()
if (verdict.ok) process.exit(0)

function lineCount(text) {
  return text === '' ? 0 : text.split('\n').length
}

// Proxy for the skill's own "≤20 lines of logic" spec-gate exemption.
const LINE_THRESHOLD = 20

function changeSize() {
  if (toolName === 'Edit') {
    return Math.max(lineCount(toolInput.old_string ?? ''), lineCount(toolInput.new_string ?? ''))
  }
  if (toolName === 'MultiEdit') {
    return (toolInput.edits ?? []).reduce(
      (sum, e) => sum + Math.max(lineCount(e.old_string ?? ''), lineCount(e.new_string ?? '')),
      0
    )
  }
  if (toolName === 'Write') {
    const newLines = lineCount(toolInput.content ?? '')
    if (existsSync(filePath)) return Math.abs(newLines - lineCount(readFileSync(filePath, 'utf-8')))
    return newLines
  }
  return Infinity
}

if (changeSize() > LINE_THRESHOLD) {
  console.error(
    verdict.declared
      ? `Error: PLAN.md is for branch '${verdict.declared}' but HEAD is '${verdict.actual}' — a leftover plan from another task. Finish it, update its Branch: line, or delete it (see task-workflow skill) before non-trivial edits here.`
      : 'Error: PLAN.md missing or not approved. Get spec approval (see task-workflow skill) before non-trivial edits, or keep the change ≤20 lines.'
  )
  process.exit(2)
}
