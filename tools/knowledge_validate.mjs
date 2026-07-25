#!/usr/bin/env node
// Validate the knowledge/ bundle: frontmatter, allowed types, link resolution, timestamps.
// Zero dependencies — runs on any Node >= 18 (macOS, Linux, Windows).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const BUNDLE_ROOT = 'knowledge'

const ALLOWED_TYPES = new Set([
  'Index', 'Contract', 'System', 'Domain', 'Table',
  'Metric', 'Playbook', 'Constraint', 'Log'
])

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g

// Minimal YAML-subset parser for concept-file frontmatter: top-level
// `key: value` pairs, inline arrays ([a, b]), and `- item` block lists.
function parseFrontmatter(raw) {
  // charCodeAt check, not a \uFEFF regex literal in source: an LLM
  // transcribing this file into a target repo can render that escape as
  // the actual BOM character, tripping the target's own lint rule.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  if (!text.startsWith('---')) return { meta: null, body: text, error: 'missing frontmatter block' }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { meta: null, body: text, error: 'unterminated frontmatter block' }
  const header = text.slice(text.indexOf('\n') + 1, end)
  const bodyStart = text.indexOf('\n', end + 1)
  const body = bodyStart === -1 ? '' : text.slice(bodyStart + 1)

  const meta = {}
  let listKey = null
  for (const line of header.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = line.match(/^\s+-\s*(.*)$/)
    if (item && listKey) {
      meta[listKey].push(stripQuotes(item[1].trim()))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) return { meta: null, body, error: `unparseable frontmatter line: '${line.trim()}'` }
    const value = kv[2].trim()
    if (value === '') {
      meta[kv[1]] = []
      listKey = kv[1]
    } else if (value.startsWith('[') && value.endsWith(']')) {
      meta[kv[1]] = value.slice(1, -1).split(',').map(s => stripQuotes(s.trim())).filter(Boolean)
      listKey = null
    } else {
      meta[kv[1]] = stripQuotes(value)
      listKey = null
    }
  }
  return { meta, body, error: null }
}

function stripQuotes(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === '\'' && s.at(-1) === '\''))) {
    return s.slice(1, -1)
  }
  return s
}

function iso8601(value) {
  if (typeof value !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

function bundleRelativeLinks(content) {
  const links = []
  for (const match of content.matchAll(LINK_RE)) {
    const target = match[1].trim()
    if (target.startsWith('/')) links.push(target.split('#')[0])
  }
  return links
}

function loadBundle(root) {
  const files = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) {
        files.set('/' + relative(root, full).split('\\').join('/'), full)
      }
    }
  }
  walk(root)
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
}

function main() {
  const argv = process.argv.slice(2)
  let root = BUNDLE_ROOT
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i]
    else if (argv[i].startsWith('--root=')) root = argv[i].slice('--root='.length)
  }

  const errors = []
  const warnings = []

  let isDir
  try {
    isDir = statSync(root).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) {
    console.log(`ERROR ${root}: bundle root does not exist`)
    return 1
  }

  const files = loadBundle(root)
  if (files.size === 0) {
    console.log(`ERROR ${root}: no .md files found in bundle`)
    return 1
  }

  const parsed = new Map()
  const indexRels = []

  for (const [rel, path] of files) {
    const { meta, body, error } = parseFrontmatter(readFileSync(path, 'utf-8'))
    if (error) {
      errors.push(`${path}: invalid frontmatter (${error})`)
      continue
    }

    parsed.set(rel, { meta, body })

    if (!('type' in meta)) {
      errors.push(`${path}: missing required frontmatter key 'type'`)
    } else if (!ALLOWED_TYPES.has(meta.type)) {
      errors.push(`${path}: type '${meta.type}' not in allowed list (${[...ALLOWED_TYPES].sort().join(', ')})`)
    } else if (meta.type === 'Index') {
      indexRels.push(rel)
    }

    if ('timestamp' in meta && !iso8601(String(meta.timestamp))) {
      errors.push(`${path}: timestamp '${meta.timestamp}' is not valid ISO 8601`)
    }

    for (const link of bundleRelativeLinks(body)) {
      if (!files.has(link)) {
        errors.push(`${path}: broken link '${link}' (no file at ${root}${link})`)
      }
    }

    if (!meta.description) warnings.push(`${path}: missing recommended key 'description'`)
    if (!meta.tags || meta.tags.length === 0) warnings.push(`${path}: missing recommended key 'tags'`)
  }

  if (indexRels.length === 0) {
    warnings.push(`${root}: no file with type 'Index' found — cannot check reachability`)
  } else {
    const reachable = new Set(indexRels)
    const stack = [...indexRels]
    while (stack.length) {
      const doc = parsed.get(stack.pop())
      if (!doc) continue
      for (const link of bundleRelativeLinks(doc.body)) {
        if (files.has(link) && !reachable.has(link)) {
          reachable.add(link)
          stack.push(link)
        }
      }
    }
    for (const [rel, path] of files) {
      if (!reachable.has(rel)) warnings.push(`${path}: not reachable from an Index file`)
    }
  }

  for (const msg of errors) console.log(`ERROR ${msg}`)
  for (const msg of warnings) console.log(`WARN ${msg}`)

  if (errors.length) {
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`)
    return 1
  }
  console.log(`\n0 errors, ${warnings.length} warning(s)`)
  return 0
}

process.exit(main())