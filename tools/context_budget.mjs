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
//   Any .claude/skills/*/SKILL.md description: > 350 chars
//   Total always-loaded chars (briefs + unscoped rules + skill descriptions) > 12 000 (~3 000 tokens)
//
// Skill `description:` frontmatter counts because it is injected for every skill on
// every turn — the same always-loaded surface as the briefs, just spread across files.
// The skills scan no-ops in repos that don't author their own skills.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

const BRIEF_LINE_LIMIT = 60;
const UNSCOPED_RULE_LIMIT = 40;
const SKILL_DESCRIPTION_LIMIT = 350;
const ALWAYS_LOADED_CHAR_LIMIT = 12_000;

// Pulls `description:` out of YAML frontmatter, following indented continuation
// lines so a wrapped multi-line description is measured whole, not just its first line.
function readDescription(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const lines = text.slice(4, end).split("\n");
  const start = lines.findIndex((l) => /^description:/.test(l));
  if (start === -1) return null;
  const parts = [lines[start].replace(/^description:\s*/, "")];
  for (let i = start + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) {
    parts.push(lines[i].trim());
  }
  return parts.join(" ").trim();
}

function meterSkill(skillFile) {
  const description = readDescription(readFileSync(skillFile, "utf-8"));
  if (description === null) {
    errors.push(`${skillFile}: no description: in frontmatter — the skill will never trigger`);
    return;
  }
  alwaysLoadedChars += description.length;
  if (description.length > SKILL_DESCRIPTION_LIMIT) {
    errors.push(
      `${skillFile}: description is ${description.length} chars (limit: ${SKILL_DESCRIPTION_LIMIT}) — always loaded, every turn`
    );
  }
}

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

for (const root of ["skills", ".claude/skills"]) {
  if (!existsSync(root)) continue;
  const skillDirs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
  for (const name of skillDirs) meterSkill(join(root, name, "SKILL.md"));
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
