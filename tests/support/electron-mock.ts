/**
 * Shared Electron stub for main-process integration tests
 * (`tests/main/**`). See `.opencode/rules/testing.md`: main-process tests
 * run outside Electron's runtime — `app`, `ipcMain`, `safeStorage` aren't
 * globally available, so we stub them in one place instead of per-test.
 *
 * ## Why `require`, not `import`, inside `vi.hoisted`
 *
 * `vi.mock('electron', factory)` is **hoisted** above all `import`
 * statements by Vitest, and its factory cannot reference out-of-scope
 * variables — including imported bindings (they hit the temporal dead
 * zone at hoist time). The only code that runs before the mock factory
 * is `vi.hoisted(...)`, and `vi.hoisted` callbacks have the same
 * restriction: they cannot reference `import` bindings either.
 *
 * They **can**, however, use `require()` (Vitest exposes a working
 * `require` in test files even under ESM). So this helper is loaded via
 * `require('<relative-path>.ts')` inside `vi.hoisted`, and node builtins
 * (`fs`/`os`/`path`) are likewise pulled in with `require` so the stub
 * can create tmp dirs at hoist time. After hoisting, the test body uses
 * the returned control surface normally (imports are resolved by then).
 *
 * ## Pattern (each main-process test file)
 *
 * ```ts
 * import { vi } from 'vitest'
 *
 * // Relative path + `.ts` — `require` (not Vite's alias resolver) loads
 * // the helper at hoist time. The returned stub's `module` is what the
 * // `electron` mock factory returns.
 * const electron = vi.hoisted(() =>
 *   require('../../support/electron-mock.ts').createElectronStub()
 * )
 * vi.mock('electron', () => electron.module)
 *
 * // then in beforeEach: electron.setupElectronMock({ ... })
 * ```
 *
 * `ipcRenderer` is intentionally not stubbed: these are main-process
 * integration tests, not preload tests. Mock only the true I/O boundary —
 * `fetch` is mocked separately per test via `vi.stubGlobal('fetch', ...)`.
 * Internal collaborators (`OpenProjectClient`, Zod schemas, the credential
 * module) are wired against their real implementations.
 */

// ESM imports for node builtins. This helper is an ESM module (loaded via
// Vitest's `require('<path>.ts')` interop from the test file's
// `vi.hoisted` block, which handles ESM correctly). The `require` in the
// *test file's* `vi.hoisted` is the Vitest-provided one; inside this
// helper, normal ESM `import` is the right tool.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A registered `ipcMain.handle` listener. Mirrors Electron's signature:
 * `(event, ...args) => Promise<unknown> | unknown`.
 */
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

/** The Electron stub + control surface returned by `createElectronStub`. */
export interface ElectronStub {
  /** The object to return from `vi.mock('electron', () => module)`. */
  module: Record<string, unknown>
  /** (Re)install default stub state. Idempotent — safe in `beforeEach`. */
  setupElectronMock: (opts?: {
    safeStorageAvailable?: boolean
    userDataDir?: string
  }) => void
  /** Invoke a registered `ipcMain.handle` handler by channel. */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  /** Clear the in-memory `ipcMain.handle` map between tests. */
  resetRegisteredHandlers: () => void
  /** Flip `safeStorage.isEncryptionAvailable()` at runtime. */
  setSafeStorageAvailable: (flag: boolean) => void
  /** Swap the `app.getPath('userData')` dir at runtime. */
  setUserDataDir: (dir: string) => void
  /** Create a fresh unique tmp `userData` dir; returns its path. */
  makeUserDataDir: () => string
  /** Remove the given tmp `userData` dir (afterEach / afterAll cleanup). */
  cleanupUserDataDir: (dir: string) => void
}

/**
 * Create a fresh Electron stub + control surface. Call inside
 * `vi.hoisted(...)` so the returned `module` is ready before the
 * `vi.mock('electron', ...)` factory runs.
 */
export function createElectronStub(): ElectronStub {
  // Mutable stub state — closed over by the control surface below.
  let safeStorageAvailable = true
  let userDataDir = mkdtempSync(join(tmpdir(), 'op-test-userdata-'))
  // In-memory registry of `ipcMain.handle` listeners, keyed by channel.
  const handlers = new Map<string, IpcHandler>()

  // A reversible safeStorage stub: `encryptString` returns a Buffer whose
  // bytes are the original string's bytes prefixed with a marker, so
  // `decryptString` can reverse it. Real safeStorage uses the OS keychain;
  // we don't need cryptographic fidelity here — only round-trip behavior.
  const SAFE_MARKER = Buffer.from('OPSAFE:')

  function encryptString(plain: string): Buffer {
    return Buffer.concat([SAFE_MARKER, Buffer.from(plain, 'utf8')])
  }

  function decryptString(buf: Buffer): string {
    if (!buf.subarray(0, SAFE_MARKER.length).equals(SAFE_MARKER)) {
      // Simulate a keychain refusal on a buffer we didn't produce —
      // exercises the `CredentialReadError` branch in the credential store.
      throw new Error('safeStorage.decryptString: not a valid encrypted blob')
    }
    return buf.subarray(SAFE_MARKER.length).toString('utf8')
  }

  function isEncryptionAvailable(): boolean {
    return safeStorageAvailable
  }

  const safeStorage = {
    encryptString,
    decryptString,
    isEncryptionAvailable
  }

  function getPath(name: string): string {
    if (name === 'userData') return userDataDir
    // Only `userData` is used by the credential store + electron-store.
    // Anything else is a programming error in the code under test.
    throw new Error(`electron app.getPath stub: unsupported path "${name}"`)
  }

  function getVersion(): string {
    return '0.0.0-test'
  }

  function isReady(): boolean {
    return true
  }

  const app = { getPath, getVersion, isReady }

  function handle(channel: string, handler: IpcHandler): void {
    handlers.set(channel, handler)
  }

  // electron-store calls `ipcMain.on('electron-store-get-data', ...)` on
  // construction (in the main-process branch). We only need it to be a
  // no-op sink so the store can initialize; the credential store never
  // relies on the IPC round-trip in the main-process branch.
  function on(_channel: string, _listener: unknown): void {
    /* no-op — store only registers a sync data responder */
  }

  function removeHandler(channel: string): void {
    handlers.delete(channel)
  }

  const ipcMain = { handle, on, removeHandler }

  // The `electron` module mock. The real `electron` package is CJS
  // (`module.exports = { app, ipcMain, safeStorage, ... }`), so ESM
  // consumers import it two ways:
  //   - `import { app } from 'electron'`      → named exports
  //   - `import electron from 'electron'`     → `default` = the whole
  //                                            module.exports (CJS interop)
  // `electron-store` uses the default-import form (`import electron from
  // 'electron'; const { app, ipcMain } = electron`), so the mock MUST
  // expose `default` pointing at the same object that carries the named
  // exports. The self-reference makes both import styles resolve to our
  // stub.
  const electronModule: Record<string, unknown> = {
    app,
    ipcMain,
    safeStorage
  }
  electronModule.default = electronModule

  return {
    module: electronModule,
    setupElectronMock(opts?: {
      safeStorageAvailable?: boolean
      userDataDir?: string
    }) {
      safeStorageAvailable = opts?.safeStorageAvailable ?? true
      if (opts?.userDataDir !== undefined) {
        userDataDir = opts.userDataDir
      }
      handlers.clear()
    },
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handlers.get(channel)
      if (!handler) {
        throw new Error(`No ipcMain.handle registered for channel "${channel}"`)
      }
      // Mirror Electron's call shape: first arg is the (mocked) event.
      return handler(undefined, ...args)
    },
    resetRegisteredHandlers() {
      handlers.clear()
    },
    setSafeStorageAvailable(flag: boolean) {
      safeStorageAvailable = flag
    },
    setUserDataDir(dir: string) {
      userDataDir = dir
    },
    makeUserDataDir() {
      const dir = mkdtempSync(join(tmpdir(), 'op-test-userdata-'))
      userDataDir = dir
      return dir
    },
    cleanupUserDataDir(dir: string) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore — best-effort cleanup */
      }
    }
  }
}