#!/bin/sh
# Pre-commit quality gates — electron + vue profile (nuxt profile base)
set -e

echo "Running pre-commit gates..."

echo "  lint..."
pnpm lint

echo "  typecheck..."
pnpm type-check

echo "  tests..."
pnpm test --run

echo "  context budget..."
if [ -f tools/context_budget.mjs ]; then node tools/context_budget.mjs; fi

echo "  knowledge validate..."
if [ -f tools/knowledge_validate.mjs ]; then node tools/knowledge_validate.mjs; fi

echo "All gates passed."