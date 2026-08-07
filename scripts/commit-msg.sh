#!/bin/sh
# Commit-message gate — Conventional Commits, enforced for every committer.
# $1 is the path to the message file git is about to use.
exec node .claude/guards/commit-msg-guard.mjs "$1"
