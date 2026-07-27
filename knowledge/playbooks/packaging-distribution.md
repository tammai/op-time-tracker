---
type: Playbook
title: Packaging for Distribution
description: How the macOS and Windows builds are produced, why they ship unsigned, why releases run in CI, and what the two traps are (dependency classification, pnpm layout).
tags: [packaging, electron-builder, macos, windows, distribution, ci]
timestamp: 2026-07-27T00:00:00Z
---

# Packaging for Distribution

`pnpm dist:mac` / `pnpm dist:win` → `electron-vite build` + `electron-builder`,
config in `/electron-builder.yml`, artifacts in `release/`. macOS universal
(arm64 + x64) DMG/zip and Windows x64 NSIS installer, all unsigned. Releases are
cut by `/.github/workflows/release.yml` on a `v*` tag. Recipient steps, artifact
names and the release procedure live in `README.md`; this file is the *why*.

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
and `gatekeeperAssess: false` (its `spctl` check always fails unsigned). No
Windows cert either, so SmartScreen warns until a binary earns reputation —
which an unsigned per-version download never really does.

The cost is integrity, not convenience: recipients cannot verify the app is
unmodified and from us. Mitigated by publishing `SHA256SUMS-*.txt` next to the
artifacts, which is weaker than a signature (same channel as the download) but
beats nothing.

To sign later: **macOS** — remove both keys, set `mac.hardenedRuntime: true`
with an entitlements plist, add `notarize` with Apple credentials from env vars.
**Windows** — an OV cert triggers SmartScreen anyway until reputation builds; EV
(hardware token) doesn't, which makes it awkward in CI. Auto-update
(`electron-updater`) only becomes viable once macOS is signed — it won't apply
updates to an unsigned app.

## Why releases run in CI

Windows NSIS packaging from macOS needs wine and is unreliable, so each platform
builds on its own runner (`.github/workflows/release.yml`, tag-driven) and
uploads to the same **draft** release via the preinstalled `gh` CLI — no
third-party upload action, and the draft leaves room to check artifacts before
the team sees them. A separate first job creates the draft: two matrix jobs
racing to create the same release conflict. `fail-fast: false` so a broken
Windows build doesn't discard a good macOS one; a re-run `--clobber`s its own
files back into the draft.

## Windows specifics

`nsis`, `oneClick: false` + `perMachine: false`: per-user install needs no admin
rights, and a real wizard reads less malware-ish than a silent one-click install
of something SmartScreen just warned about. x64 only — Windows-on-ARM is rare
internally and emulates x64. `win.icon` names `build/icon.ico` explicitly
(`tools/make-icons.mjs` writes it as a directory of PNGs); letting
electron-builder downscale `icon.png` smears the 16px taskbar icon.

## Not configured

Linux targets, code signing, notarization, auto-update, arm64 Windows.
