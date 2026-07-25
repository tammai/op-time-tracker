#!/usr/bin/env node
// Context budget gate — keeps the always-loaded harness within token budget.
//
// This repo runs a dual harness: Claude Code reads CLAUDE.md + .claude/rules/,
// OpenCode reads AGENTS.md + .opencode/rules/. CLAUDE.md `@`-imports AGENTS.md,
// so for a Claude Code session BOTH briefs are always loaded — the gate counts
// both. The rule dirs are deduped by realpath because .claude/rules/*.md are
// symlinks to .opencode/rules/*.md (one source of truth, two tool surfaces).
//
// Fails (exit 1) on:
//   CLAUDE.md or AGENTS.md > 60 lines
//   Any rule file without paths: frontmatter AND > 40 lines
//   Total always-loaded chars (briefs + unscoped rules) > 12 000 (~3 000 tokens)
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

const BRIEF_LINE_LIMIT = 60;
const UNSCOPED_RULE_LIMIT = 40;
const ALWAYS_LOADED_CHAR_LIMIT = 12_000;

const BRIEFS = ["CLAUDE.md", "AGENTS.md"];
const RULE_DIRS = [".claude/rules", ".opencode/rules"];

function hasPathsFrontmatter(text) {
  if (!text.startsWith("---\n")) return false;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return false;
  return text.slice(4, end).includes("paths:");
}

function countLines(text) {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

const errors = [];
let alwaysLoadedChars = 0;

for (const brief of BRIEFS) {
  if (!existsSync(brief)) {
    console.log(`WARN ${brief} not found — skipping`);
    continue;
  }
  const content = readFileSync(brief, "utf-8");
  const lines = countLines(content);
  alwaysLoadedChars += content.length;
  if (lines > BRIEF_LINE_LIMIT) {
    errors.push(`${brief}: ${lines} lines (limit: ${BRIEF_LINE_LIMIT})`);
  }
}

// Dedupe by realpath so a symlinked rule is counted once, not once per dir.
const seen = new Set();
let anyRuleDir = false;

for (const rulesDir of RULE_DIRS) {
  if (!existsSync(rulesDir)) continue;
  anyRuleDir = true;
  const ruleFiles = readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort();
  for (const name of ruleFiles) {
    const ruleFile = join(rulesDir, name);
    const real = realpathSync(ruleFile);
    if (seen.has(real)) continue;
    seen.add(real);
    const content = readFileSync(ruleFile, "utf-8");
    if (hasPathsFrontmatter(content)) continue; // path-scoped — not always loaded
    const lines = countLines(content);
    alwaysLoadedChars += content.length;
    if (lines > UNSCOPED_RULE_LIMIT) {
      errors.push(`${ruleFile}: ${lines} lines, no paths: frontmatter (limit: ${UNSCOPED_RULE_LIMIT})`);
    }
  }
}

if (!anyRuleDir) {
  console.log("WARN no rule dir found (.claude/rules/, .opencode/rules/) — skipping rule checks");
}

if (alwaysLoadedChars > ALWAYS_LOADED_CHAR_LIMIT) {
  const estTokens = Math.floor(alwaysLoadedChars / 4);
  const limitTokens = Math.floor(ALWAYS_LOADED_CHAR_LIMIT / 4);
  errors.push(
    `Always-loaded: ${alwaysLoadedChars} chars (~${estTokens} tokens) ` +
      `exceeds limit of ${ALWAYS_LOADED_CHAR_LIMIT} chars (~${limitTokens} tokens)`
  );
}

if (errors.length > 0) {
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(`\n${errors.length} context budget violation(s). Fix before committing.`);
  process.exit(1);
}

const est = Math.floor(alwaysLoadedChars / 4);
console.log(`OK always-loaded: ${alwaysLoadedChars} chars (~${est} tokens) — within budget`);
