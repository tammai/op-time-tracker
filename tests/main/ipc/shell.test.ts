import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

import type { ElectronStub } from '~~/tests/support/electron-mock'

// `vi.mock('electron', factory)` is hoisted above all `import` statements and
// its factory cannot reference imported bindings, so the stub is loaded with a
// relative `require('<path>.ts')` inside `vi.hoisted`. Same pattern as
// `tests/main/ipc/openproject.test.ts`; see `tests/support/electron-mock.ts`.
const electron = vi.hoisted<ElectronStub>(() =>
  require('../../support/electron-mock.ts').createElectronStub()
)
vi.mock('electron', () => electron.module)

const {
  setupElectronMock,
  makeUserDataDir,
  cleanupUserDataDir,
  openExternalCalls,
  setOpenExternalImpl
} = electron

// The real handler + the real credential store, against the mocked `electron`.
// `shell.openExternal` is the only I/O boundary stubbed here — there is no
// OpenProject HTTP on this path at all, which is itself part of the contract.
import {
  buildWorkPackageWebUrl,
  registerShellIpcHandlers
} from '~~/src/main/ipc/shell'
import { saveCredentials, __resetStoreForTests } from '~~/src/main/credentials'
import Store from 'electron-store'

// Mirrors the private constants in `src/main/credentials/index.ts`. Only the
// tampered-store test below needs them — it has to write a value the public
// `saveCredentials` API correctly refuses.
const STORE_NAMESPACE = 'openproject-credentials'
const BASE_URL_KEY = 'openproject.baseUrl'

const BASE_URL = 'https://openproject.example.com'
// A throwaway test API key. Present in the store so the credential gate is
// satisfied, and asserted *never* to appear in an opened URL or an error.
const API_KEY = 'shell-test-api-key-xyz-9876543210'

let userDataDir: string

beforeEach(() => {
  userDataDir = makeUserDataDir()
  setupElectronMock({ safeStorageAvailable: true, userDataDir })
  __resetStoreForTests()
  registerShellIpcHandlers()
})

afterEach(() => {
  __resetStoreForTests()
  cleanupUserDataDir(userDataDir)
  electron.resetRegisteredHandlers()
})

/** Invoke the shell handler exactly as the preload bridge would. */
function openWorkPackage(input: unknown): Promise<unknown> {
  return electron.invoke('op:shell:open-work-package', input)
}

/**
 * Invoke and capture the rejection, asserting the error carries a `code` +
 * `message` and that neither leaks the API key. Compares against the
 * precomputed constant so a failure never prints the secret.
 */
async function expectIpcError(fn: () => Promise<unknown>): Promise<{
  code: string
  message: string
}> {
  let caught: { code?: string; message?: string } | undefined
  try {
    await fn()
  } catch (e) {
    caught = e as { code?: string; message?: string }
  }
  expect(caught).toBeDefined()
  expect(typeof caught!.code).toBe('string')
  expect(typeof caught!.message).toBe('string')
  expect(caught!.message).not.toContain(API_KEY)
  return { code: caught!.code!, message: caught!.message! }
}

describe('buildWorkPackageWebUrl — the URL is built in main, from the stored base URL', () => {
  it('appends the work-package web path to the base URL', () => {
    expect(buildWorkPackageWebUrl(BASE_URL, 42).href).toBe(
      `${BASE_URL}/work_packages/42`
    )
  })

  it('does not double the slash on a trailing-slash base URL', () => {
    expect(buildWorkPackageWebUrl(`${BASE_URL}/`, 42).href).toBe(
      `${BASE_URL}/work_packages/42`
    )
  })

  it('preserves a base URL mounted under a subpath', () => {
    expect(buildWorkPackageWebUrl(`${BASE_URL}/op`, 42).href).toBe(
      `${BASE_URL}/op/work_packages/42`
    )
  })

  it('strips userinfo, which must never be handed to the OS', () => {
    const url = buildWorkPackageWebUrl(
      'https://someone:secret@openproject.example.com',
      42
    )
    expect(url.href).toBe(`${BASE_URL}/work_packages/42`)
    expect(url.href).not.toContain('secret')
    expect(url.username).toBe('')
    expect(url.password).toBe('')
  })

  it('re-asserts http(s) at the sink, so a tampered store cannot pick the scheme', () => {
    // The credential schema already rejects these at save time. This is the
    // second gate: if a hand-edited or corrupted store ever yields one, the
    // URL is refused here rather than launched by the OS.
    for (const baseUrl of [
      'file:///etc/passwd',
      'smb://fileserver/share',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>'
    ]) {
      let code: string | undefined
      try {
        buildWorkPackageWebUrl(baseUrl, 42)
      } catch (e) {
        code = (e as { code?: string }).code
      }
      expect(code).toBe('SHELL_UNSAFE_TARGET')
    }
  })
})

describe('op:shell:open-work-package — happy path', () => {
  it('opens the URL built from the stored base URL and the validated id', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    await expect(openWorkPackage({ workPackageId: 42 })).resolves.toBeUndefined()

    expect(openExternalCalls()).toEqual([`${BASE_URL}/work_packages/42`])
  })

  it('joins a trailing-slash base URL without doubling the slash', async () => {
    await saveCredentials({ baseUrl: `${BASE_URL}/`, apiKey: API_KEY })

    await openWorkPackage({ workPackageId: 7 })

    expect(openExternalCalls()).toEqual([`${BASE_URL}/work_packages/7`])
  })

  it('never puts the API key in the opened URL', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    await openWorkPackage({ workPackageId: 42 })

    const [opened] = openExternalCalls() as string[]
    expect(opened).not.toContain(API_KEY)
    expect(opened).not.toContain('apikey')
  })
})

describe('op:shell:open-work-package — id validation (nothing reaches the OS)', () => {
  it('rejects every non-positive-integer id without calling openExternal', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    const badIds = [
      0,
      -1,
      -42,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '42',
      '42/../../admin',
      null,
      undefined,
      true,
      {},
      []
    ]

    for (const workPackageId of badIds) {
      const err = await expectIpcError(() => openWorkPackage({ workPackageId }))
      expect(err.code).toBe('SHELL_INVALID_INPUT')
    }

    expect(openExternalCalls()).toEqual([])
  })

  it('rejects a malformed or missing input object', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    for (const input of [undefined, null, {}, 42, 'https://evil.example', []]) {
      const err = await expectIpcError(() => openWorkPackage(input))
      expect(err.code).toBe('SHELL_INVALID_INPUT')
    }

    expect(openExternalCalls()).toEqual([])
  })

  it('ignores a renderer-supplied URL riding alongside a valid id', async () => {
    // The security invariant: the renderer sends an id, and *only* the id is
    // used. A hostile renderer smuggling an href, path, or absolute URL must
    // see it discarded — never forwarded to the OS.
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })

    await openWorkPackage({
      workPackageId: 42,
      url: 'file:///etc/passwd',
      href: 'https://evil.example/pwn',
      baseUrl: 'smb://fileserver/share',
      path: '../../admin'
    })

    // Exactly one call, and it is the URL main built — nothing from the input.
    expect(openExternalCalls()).toEqual([`${BASE_URL}/work_packages/42`])
    const [opened] = openExternalCalls() as string[]
    expect(opened).not.toContain('evil.example')
    expect(opened).not.toContain('file:')
    expect(opened).not.toContain('smb:')
    expect(opened).not.toContain('admin')
  })
})

describe('op:shell:open-work-package — credential gate', () => {
  it('rejects with CREDENTIAL_NOT_CONFIGURED when nothing is stored', async () => {
    // Deliberately do NOT call saveCredentials.
    const err = await expectIpcError(() => openWorkPackage({ workPackageId: 42 }))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(openExternalCalls()).toEqual([])
  })

  it('opens nothing when the stored base URL is not http(s)', async () => {
    // A hand-edited or corrupted store is the only way this value can exist —
    // `saveCredentials` refuses it. The point of the test is that the whole
    // chain refuses too, so a tampered store cannot turn this channel into a
    // `file:` launch. It surfaces as CREDENTIAL_NOT_CONFIGURED because the
    // credential layer reports an unusable stored URL as "none": the two cases
    // have the same remedy (re-enter the URL in Settings), and collapsing them
    // keeps the sink guard from being the thing that has to explain itself.
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    const store = new Store<Record<string, unknown>>({
      cwd: userDataDir,
      name: STORE_NAMESPACE,
      accessPropertiesByDotNotation: true
    })
    store.set(BASE_URL_KEY, 'file:///etc/passwd')
    __resetStoreForTests()

    const err = await expectIpcError(() => openWorkPackage({ workPackageId: 42 }))
    expect(err.code).toBe('CREDENTIAL_NOT_CONFIGURED')
    expect(openExternalCalls()).toEqual([])
  })

  it('validates the id before reading credentials at all', async () => {
    // Order matters: a bad id is refused on its own terms, not reported as a
    // configuration problem the user would then go looking for.
    const err = await expectIpcError(() => openWorkPackage({ workPackageId: 0 }))
    expect(err.code).toBe('SHELL_INVALID_INPUT')
    expect(openExternalCalls()).toEqual([])
  })
})

describe('op:shell:open-work-package — openExternal rejects', () => {
  it('surfaces SHELL_OPEN_FAILED without leaking the underlying error', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    setOpenExternalImpl(() =>
      Promise.reject(
        new Error(`no handler registered for https: (key was ${API_KEY})`)
      )
    )

    const err = await expectIpcError(() => openWorkPackage({ workPackageId: 42 }))
    expect(err.code).toBe('SHELL_OPEN_FAILED')
    // The OS error text is replaced, not forwarded — it is not ours to trust.
    expect(err.message).not.toContain('no handler registered')
    // It was attempted, though — this is a sink failure, not a refusal.
    expect(openExternalCalls()).toEqual([`${BASE_URL}/work_packages/42`])
  })

  it('surfaces SHELL_OPEN_FAILED when openExternal throws synchronously', async () => {
    await saveCredentials({ baseUrl: BASE_URL, apiKey: API_KEY })
    setOpenExternalImpl(() => {
      throw new Error('synchronous OS failure')
    })

    const err = await expectIpcError(() => openWorkPackage({ workPackageId: 42 }))
    expect(err.code).toBe('SHELL_OPEN_FAILED')
    expect(err.message).not.toContain('synchronous OS failure')
  })
})
