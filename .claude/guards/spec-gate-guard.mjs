#!/usr/bin/env node
// Blocks non-trivial Edit/Write/MultiEdit before PLAN.md is approved.
// Claude Code PreToolUse hook — reads tool input from stdin, exits 2 to block.
import { existsSync, readFileSync } from 'node:fs'
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

function isPlanApproved() {
  const planPath = join(process.cwd(), 'PLAN.md')
  if (!existsSync(planPath)) return false
  const match = readFileSync(planPath, 'utf-8').match(/^Status:\s*(\S+)/m)
  return !!match && match[1].toLowerCase() === 'approved'
}

if (isPlanApproved()) process.exit(0)

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
  console.error('Error: PLAN.md missing or not approved. Get spec approval (see task-workflow skill) before non-trivial edits, or keep the change ≤20 lines.')
  process.exit(2)
}
