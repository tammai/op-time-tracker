---
type: Playbook
title: Packaging for Distribution
description: How the macOS build is produced, why it ships unsigned, and what the two traps are (dependency classification, pnpm layout).
tags: [packaging, electron-builder, macos, distribution]
timestamp: 2026-07-26T00:00:00Z
---

# Packaging for Distribution

`pnpm dist` → `electron-vite build` + `electron-builder --mac`, config in
`/electron-builder.yml`, artifacts in `release/`. macOS universal (arm64 + x64),
unsigned. Recipient steps and the artifact names live in `README.md`; this file
is the *why*.

## The dependency-classification trap

`externalizeDepsPlugin()` treats everything in `dependencies` as external to the
main/preload bundles, and electron-builder then copies all of it into the app.
The renderer, by contrast, is bundled by Vite — so a renderer library in
`dependencies` is shipped twice over: once inside the bundle, once as a
node_modules tree, dragging its per-platform binaries along.

That is not theoretical. `@nuxt/ui`, `pinia`, `tailwindcss` et al. were in
`dependencies`, and the first universal build died in `@electron/universal` on
`@esbuild/darwin-x64/bin/esbuild` — an arch-specific binary present in both
slices and identical in neither. Moving them to `devDependencies` fixed the
build and cut the asar to `electron-store`, `zod`, and their transitive deps.

**Rule:** `dependencies` = what `src/main/` or `src/preload/` `require`s at
runtime. Everything else is a `devDependency`. Verify with
`@electron/asar`'s `listPackage` on `Contents/Resources/app.asar` — the
top-level `node_modules` entries should be a short list you recognise.

## pnpm symlinks

electron-builder 26 walks pnpm's symlinked store correctly (`searching for node
modules pm=pnpm`), so **no `.npmrc node-linker=hoisted` is needed**. If a future
version regresses, the symptom is a missing-module crash on launch, not a build
error — which is why the check is "launch the packaged app", not "the build
passed".

## Unsigned, deliberately

No Developer ID, so `mac.identity: null` (stops electron-builder from silently
using whatever is in the keychain, which would make artifacts machine-dependent)
and `gatekeeperAssess: false` (its `spctl` check always fails unsigned).

The cost is integrity, not convenience: recipients cannot verify the app is
unmodified and from us. Mitigate by sending it over a trusted channel plus an
out-of-band SHA-256.

To sign later: remove both keys, set `mac.hardenedRuntime: true` with an
entitlements plist, add `notarize` with Apple credentials from env vars, and
build on a machine holding the Developer ID cert. Auto-update
(`electron-updater`) only becomes viable at that point — macOS won't apply
updates to an unsigned app.

## Not configured

Windows and Linux targets, code signing, notarization, auto-update, publishing,
CI packaging. Cross-building Windows from macOS needs wine and is unreliable —
use a runner.
