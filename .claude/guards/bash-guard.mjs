#!/usr/bin/env node
// Blocks Bash commands that bypass quality gates.
// Claude Code PreToolUse hook — reads tool input from stdin, exits 2 to block.
import { readFileSync } from 'node:fs'

// Fail closed: an unparsable payload would otherwise exit 1, which Claude Code
// treats as non-blocking — the command would run ungated.
function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    console.error('Error: bash-guard.mjs could not parse its hook payload (empty or malformed stdin) — blocking rather than passing the call through unchecked.')
    process.exit(2)
  }
}

const data = readPayload()
const command = data?.tool_input?.command ?? ''

// Strip quoted strings so flags inside commit messages don't trigger false positives.
let scrubbed = command.replace(/'[^']*'/g, '\'\'')
scrubbed = scrubbed.replace(/"[^"]*"/g, '""')

const BLOCKED = [
  [/--no-verify/, 'Error: --no-verify bypasses pre-commit gates. Fix the underlying issue.'],
  // -n only in the flag region (a chain of -flags after `commit`), never inside a quoted message
  [/git\s+commit\s+(?:-\w+\s+)*-n\b/, 'Error: git commit -n bypasses pre-commit gates. Fix the underlying issue.'],
  // --force but NOT --force-with-lease (which is the sanctioned alternative)
  [/git\s+push\b.*--force(?!-with-lease)(\s|$)/, 'Error: --force push is blocked. Use --force-with-lease on a feature branch.'],
  [/git\s+push\b.*\s-f(\s|$)/, 'Error: force push is blocked. Use --force-with-lease on a feature branch.']
]

for (const [pattern, message] of BLOCKED) {
  if (pattern.test(scrubbed)) {
    console.error(message)
    process.exit(2) // exit 2 = block the tool call in Claude Code
  }
}
