#!/usr/bin/env node
// Blocks commits whose subject isn't a Conventional Commit. Two entry points:
//   node commit-msg-guard.mjs <msg-file>   git commit-msg hook — validates the message file
//   node commit-msg-guard.mjs              Claude Code PreToolUse hook — reads stdin payload
// Both exit 2 to reject; both allow when there's no subject they can read.
import { readFileSync } from 'node:fs'

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
const CONVENTIONAL = new RegExp(`^(${TYPES.join('|')})(\\([^()]+\\))?!?: .+`)
const MAX_SUBJECT = 100

// git commit-msg hook: first line that is neither a comment nor blank.
// (The file still carries git's comment template and any scissors line at this point.)
function subjectFromFile(path) {
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue
    return line.trim()
  }
  return null
}

// PreToolUse hook: pull the message out of the `git commit` command line.
function subjectFromToolInput() {
  let payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    // Fail closed. The outer catch's "can't judge → allow" covers an unreadable
    // message file; a payload this hook was handed and couldn't parse is different —
    // exiting 1 there would be non-blocking and the commit would run ungated.
    console.error('Error: commit-msg-guard.mjs could not parse its hook payload (empty or malformed stdin) — blocking rather than passing the commit through unchecked.')
    process.exit(2)
  }
  const command = payload?.tool_input?.command ?? ''

  // Detect `git commit` outside quoted strings (same scrub bash-guard.mjs uses).
  const scrubbed = command.replace(/'[^']*'/g, '\'\'').replace(/"[^"]*"/g, '""')
  if (!/\bgit\s+commit\b/.test(scrubbed)) return null

  // -m/--message, including bundled short flags (-am). Unparsable forms (heredoc,
  // $'...', an editor-driven commit) return null — but the commit-msg hook still sees those.
  const msgMatch = command.match(/(?:--message|-[a-zA-Z]*m)(?:=|\s+)"([^"]*)"/)
    ?? command.match(/(?:--message|-[a-zA-Z]*m)(?:=|\s+)'([^']*)'/)
  return msgMatch ? msgMatch[1].split('\n')[0].trim() : null
}

let subject
try {
  subject = process.argv[2] ? subjectFromFile(process.argv[2]) : subjectFromToolInput()
} catch {
  process.exit(0) // unreadable input → can't judge → never block on guard failure
}
if (!subject) process.exit(0)

// Git's own generated subjects and rebase markers aren't ours to reformat.
if (/^(Merge|Revert)\b/.test(subject) || /^(fixup|squash)!/.test(subject)) process.exit(0)

if (!CONVENTIONAL.test(subject)) {
  console.error(
    `Error: commit message is not a Conventional Commit. Use "<type>(<scope>): <subject>" — type one of: ${TYPES.join(', ')}. Append ! before the colon for a breaking change. Got: "${subject}"`
  )
  process.exit(2)
}

if (subject.length > MAX_SUBJECT) {
  console.error(
    `Error: commit subject is ${subject.length} chars (max ${MAX_SUBJECT}). Move the detail into a body: git commit -m "<subject>" -m "<body>".`
  )
  process.exit(2)
}
