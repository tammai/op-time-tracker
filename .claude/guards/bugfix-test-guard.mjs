#!/usr/bin/env node
// Blocks fix-shaped `git commit`s that include no test file — every bug fix ships a regression test.
// Claude Code PreToolUse hook — reads tool input from stdin, exits 2 to block.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(0, 'utf-8'))
const command = data?.tool_input?.command ?? ''

// Detect `git commit` outside quoted strings (same scrub bash-guard.mjs uses).
const scrubbed = command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
if (!/\bgit\s+commit\b/.test(scrubbed)) process.exit(0)

// Extract the commit message from -m/--message. No parsable message → can't judge → allow.
const msgMatch =
  command.match(/(?:-m|--message)(?:=|\s+)"([^"]*)"/) ??
  command.match(/(?:-m|--message)(?:=|\s+)'([^']*)'/)
if (!msgMatch) process.exit(0)
const message = msgMatch[1]

// Explicit override: [no-test] in the message (state the reason next to it).
if (message.includes('[no-test]')) process.exit(0)

// Fix-shaped: conventional-commit fix prefix (any line), or bugfix/hotfix anywhere.
if (!/^\s*fix(\([^)]*\))?!?:/im.test(message) && !/\b(bugfix|hotfix)\b/i.test(message)) process.exit(0)

// Files this commit will include: staged, plus tracked-modified when -a/--all is used.
let files = []
try {
  files = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).split('\n')
  if (/\s(-[a-z]*a[a-z]*|--all)(\s|$)/.test(scrubbed)) {
    files = files.concat(execSync('git diff --name-only', { encoding: 'utf-8' }).split('\n'))
  }
} catch {
  process.exit(0) // not a git repo / git unavailable — never block on guard failure
}
files = files.map(f => f.trim()).filter(Boolean)
if (files.length === 0) process.exit(0)

const TEST_PATTERNS = [
  /\.test\.[^/\\]+$/i,
  /\.spec\.[^/\\]+$/i,
  /_test\.go$/,
  /(^|[/\\])tests?[/\\]/i,
  /(^|[/\\])__tests__[/\\]/
]
if (files.some(f => TEST_PATTERNS.some(p => p.test(f)))) process.exit(0)

// Docs/config-only fixes have no runtime surface to test — same allowlist as spec-gate-guard.mjs.
const TRIVIAL_PATTERNS = [
  /\.md$/i,
  /\.env\.example$/i,
  /(^|[/\\])(\.eslintrc(\.\w+)?|eslint\.config\.\w+|\.prettierrc(\.\w+)?|prettier\.config\.\w+|tsconfig(\.\w+)?\.json|vite\.config\.\w+|vitest\.config\.\w+|nuxt\.config\.\w+|\.editorconfig|\.gitignore|\.npmrc)$/i
]
if (files.every(f => TRIVIAL_PATTERNS.some(p => p.test(f)))) process.exit(0)

console.error(
  'Error: fix commit with no test file included. Every bug fix ships a regression test (see the debug-workflow skill). Stage a test covering the bug, or add [no-test] to the commit message with the reason.'
)
process.exit(2)
