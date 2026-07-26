#!/usr/bin/env node
/**
 * Draw the app icon and build `build/icon.icns` from it.
 *
 * Procedural on purpose: the repo has no artwork and no image dependency, and
 * adding one (sharp, canvas — both native) to draw a clock face would be a
 * heavier price than the ~100 lines below. `zlib` is all a PNG needs.
 *
 * The committed outputs (`build/icon.png`, `build/icon.icns`) are what
 * packaging reads, so this script is only run when the artwork changes:
 *
 *     node tools/make-icons.mjs
 *
 * Replacing the placeholder with real artwork means overwriting those two files
 * (`iconutil -c icns <name>.iconset`) and deleting this script — not editing it.
 *
 * macOS only: `iconutil` ships with Xcode's command line tools. The PNGs are
 * written regardless, so a non-mac run still leaves usable output.
 */
import { deflateSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD_DIR = join(ROOT, 'build')
const ICONSET_DIR = join(BUILD_DIR, 'icon.iconset')

// ---------------------------------------------------------------------------
// The drawing — a clock face on a blue squircle
// ---------------------------------------------------------------------------

/** Tailwind blue-600 → blue-700, the app's `primary` (see electron.vite.config.ts). */
const TOP = [37, 99, 235]
const BOTTOM = [29, 78, 216]
const FACE = [255, 255, 255]

/**
 * Signed distance to a rounded rectangle centred at the origin — negative
 * inside. A squircle would be closer to Apple's grid, but at icon sizes the
 * difference is a pixel of curvature and this is four lines.
 */
function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x) - (halfWidth - radius)
  const dy = Math.abs(y) - (halfHeight - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/** Signed distance to a line segment thickened into a capsule. */
function segmentDistance(x, y, x1, y1, x2, y2, radius) {
  const vx = x2 - x1
  const vy = y2 - y1
  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy))
  )
  return Math.hypot(x - x1 - t * vx, y - y1 - t * vy) - radius
}

/**
 * Colour and coverage at one sample point, in a coordinate space normalised to
 * the icon's edge length (0…1 on both axes). Returns `[r, g, b, a]`.
 *
 * Hands sit at 10:10 — the arrangement every clock in every product shot uses,
 * because it leaves the face readable and reads as "a clock" at 16px.
 */
function sample(u, v) {
  // Apple's grid leaves the icon inset from its canvas; ~10% keeps the shadow
  // room macOS expects and stops the shape touching the Dock's edges.
  const inset = 0.1
  const x = u - 0.5
  const y = v - 0.5
  const half = 0.5 - inset

  if (roundedRectDistance(x, y, half, half, 0.115) > 0) return [0, 0, 0, 0]

  // Vertical gradient, dark at the bottom.
  const mix = (v - inset) / (1 - 2 * inset)
  const bg = TOP.map((c, i) => Math.round(c + (BOTTOM[i] - c) * mix))

  const ringRadius = 0.255
  const ringWidth = 0.032
  const onRing = Math.abs(Math.hypot(x, y) - ringRadius) - ringWidth / 2 < 0

  // 10:10. Angles run clockwise from 12 o'clock, hence the sin/cos swap.
  const hand = (minutes, length, width) => {
    const a = (minutes / 60) * Math.PI * 2
    return segmentDistance(x, y, 0, 0, Math.sin(a) * length, -Math.cos(a) * length, width)
  }
  const onHands =
    hand(50, 0.15, 0.019) < 0 || // hour, pointing to 10
    hand(10, 0.2, 0.016) < 0 || // minute, pointing to 2
    Math.hypot(x, y) - 0.028 < 0 // the pin they meet at

  return [...(onRing || onHands ? FACE : bg), 255]
}

/**
 * Render at `size`², supersampled 3×3.
 *
 * Rendered per size rather than downscaled from 1024: the 16px Dock/Finder icon
 * is drawn at its own scale, so the ring stays a crisp two pixels instead of the
 * grey smear a box filter would leave.
 */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const steps = 3
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < steps; sy++) {
        for (let sx = 0; sx < steps; sx++) {
          const [r, g, b, a] = sample(
            (px + (sx + 0.5) / steps) / size,
            (py + (sy + 0.5) / steps) / size
          )
          // Premultiply so a transparent sample doesn't drag colour into the
          // average — the corners would otherwise darken toward black.
          acc[0] += r * a
          acc[1] += g * a
          acc[2] += b * a
          acc[3] += a
        }
      }
      const offset = (py * size + px) * 4
      pixels[offset] = acc[3] ? Math.round(acc[0] / acc[3]) : 0
      pixels[offset + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0
      pixels[offset + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0
      pixels[offset + 3] = Math.round(acc[3] / (steps * steps))
    }
  }
  return pixels
}

// ---------------------------------------------------------------------------
// PNG encoding — RGBA, one IDAT, filter 0
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** The sizes `iconutil` expects, as `[edge, iconset filename]`. */
const ICONSET = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]

mkdirSync(ICONSET_DIR, { recursive: true })

// Cache by edge length: half the iconset entries are the same bitmap under two
// names (32px is both 16@2x and 32×32).
const rendered = new Map()
for (const [size, name] of ICONSET) {
  if (!rendered.has(size)) rendered.set(size, encodePng(size, render(size)))
  writeFileSync(join(ICONSET_DIR, name), rendered.get(size))
}

// Kept alongside the .icns for Windows/Linux targets, which take a PNG.
writeFileSync(join(BUILD_DIR, 'icon.png'), rendered.get(1024))
console.log('wrote build/icon.png (1024×1024)')

try {
  execFileSync('iconutil', ['-c', 'icns', ICONSET_DIR, '-o', join(BUILD_DIR, 'icon.icns')])
  console.log('wrote build/icon.icns')
} catch (e) {
  console.error(`iconutil failed (macOS only) — build/icon.icns not written: ${e.message}`)
  process.exitCode = 1
} finally {
  // The iconset is an intermediate; only the .icns and .png are committed.
  rmSync(ICONSET_DIR, { recursive: true, force: true })
}
