import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'

import type { ElectronStub } from '~~/tests/support/electron-mock'

// `vi.mock('electron', factory)` is hoisted above all `import` statements,
// and the factory cannot reference imported bindings (temporal dead zone).
// `vi.hoisted` callbacks have the same restriction, but they CAN use
// `require()` — so the helper is loaded with a relative `require('<path>.ts')`
// inside `vi.hoisted`, and it in turn `require`s node builtins. The returned
// stub's `module` is what the `electron` mock factory returns. The
// `ElectronStub` type import is erased at runtime, so it's safe as a normal
// import. See `tests/support/electron-mock.ts`.
const electron = vi.hoisted<ElectronStub>(() =>
  require('../../support/electron-mock.ts').createElectronStub()
)
vi.mock('electron', () => electron.module)

const {
  setupElectronMock,
  setSafeStorageAvailable,
  makeUserDataDir,
  cleanupUserDataDir
} = electron

// Wire the real credential store against the mocked `electron` + a real
// `electron-store` writing to a tmp `userData` dir. Internal collaborators
// are NOT mocked (per `testing.md`: mock only the I/O boundary).
import {
  saveCredentials,
  getCredentials,
  getConnectionInfo,
  hasCredentials,
  clearCredentials,
  __resetStoreForTests,
  CredentialValidationError,
  CredentialReadError
} from '~~/src/main/credentials'

const VALID_BASE_URL = 'https://openproject.example.com'
const OTHER_BASE_URL = 'https://op.example.org'
// A throwaway test key. Never logged anywhere in the assertions below —
// we only verify it round-trips, never print it.
const TEST_API_KEY = 'test-api-key-secret-1234567890'

let userDataDir: string

beforeEach(() => {
  userDataDir = makeUserDataDir()
  setupElectronMock({ safeStorageAvailable: true, userDataDir })
  __resetStoreForTests()
})

afterEach(() => {
  __resetStoreForTests()
  cleanupUserDataDir(userDataDir)
})

describe('credential store round-trip (safeStorage available)', () => {
  it('save → has → get → clear round-trips the values', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    expect(await hasCredentials()).toBe(true)

    const creds = await getCredentials()
    expect(creds).not.toBeNull()
    expect(creds!.baseUrl).toBe(VALID_BASE_URL)
    expect(creds!.apiKey).toBe(TEST_API_KEY)

    await clearCredentials()
    expect(await hasCredentials()).toBe(false)
    expect(await getCredentials()).toBeNull()
  })

  it('the API key never appears in plaintext on disk', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    // Read the raw electron-store JSON file straight off disk. The store
    // is created WITHOUT an `encryptionKey` on the safeStorage path (the
    // store file itself is plaintext JSON), so we can read it directly.
    // The API key column must hold the base64 of the safeStorage-encrypted
    // buffer — never the raw key string.
    const storeFile = `${userDataDir}/openproject-credentials.json`
    const raw = readFileSync(storeFile)

    // Security assertion: the secret key string must not appear in the
    // persisted file. The stored value is base64 ciphertext, not the key.
    expect(raw.includes(TEST_API_KEY)).toBe(false)

    // Sanity check: the file DOES contain the (non-secret) base URL and
    // some base64 ciphertext for the API key, so we know the read is real
    // and the absence above isn't because the file is empty.
    expect(raw.includes(VALID_BASE_URL)).toBe(true)
    expect(raw.includes('apiKeyCipher')).toBe(true)
  })
})

describe('credential store fallback path (safeStorage unavailable)', () => {
  it('round-trips via the electron-store encryptionKey path', async () => {
    setupElectronMock({ safeStorageAvailable: false, userDataDir })
    __resetStoreForTests()

    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    expect(await hasCredentials()).toBe(true)
    const creds = await getCredentials()
    expect(creds).not.toBeNull()
    expect(creds!.baseUrl).toBe(VALID_BASE_URL)
    expect(creds!.apiKey).toBe(TEST_API_KEY)

    // On the fallback path, electron-store encrypts the whole config file
    // with its `encryptionKey` (AES). The raw file must NOT contain the
    // plaintext key either — defense in depth.
    const storeFile = `${userDataDir}/openproject-credentials.json`
    const raw = readFileSync(storeFile)
    expect(raw.includes(TEST_API_KEY)).toBe(false)
  })
})

describe('safeStorage availability flip (task 3 carry-forward)', () => {
  it('save with safeStorage, then flip unavailable, then read → CredentialReadError', async () => {
    // Save while the OS keychain is "available" — stored as safeStorage
    // ciphertext with storageMode = 'safeStorage'.
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    // Simulate the keychain going away (e.g. user removed libsecret, or a
    // sandboxed CI without keyring). The cached store instance is fine —
    // the read path re-checks `safeStorage.isEncryptionAvailable()`.
    setSafeStorageAvailable(false)

    await expect(getCredentials()).rejects.toBeInstanceOf(CredentialReadError)

    // Reset back to available for any following test's beforeEach.
  })
})

describe('credential validation rejection', () => {
  it('rejects an invalid base URL and writes nothing', async () => {
    await expect(
      saveCredentials({ baseUrl: 'not-a-url', apiKey: TEST_API_KEY })
    ).rejects.toBeInstanceOf(CredentialValidationError)

    expect(await hasCredentials()).toBe(false)
    expect(await getCredentials()).toBeNull()
  })

  it('rejects a whitespace-only API key and writes nothing', async () => {
    await expect(
      saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: '   ' })
    ).rejects.toBeInstanceOf(CredentialValidationError)

    expect(await hasCredentials()).toBe(false)
    expect(await getCredentials()).toBeNull()
  })

  it('rejects an omitted API key when none is stored', async () => {
    await expect(
      saveCredentials({ baseUrl: VALID_BASE_URL })
    ).rejects.toBeInstanceOf(CredentialValidationError)

    expect(await hasCredentials()).toBe(false)
  })
})

// The settings form prefills from this — it must expose the base URL and the
// *presence* of a key, and never the key itself.
describe('getConnectionInfo', () => {
  it('reports nulls / false when nothing is stored', async () => {
    expect(await getConnectionInfo()).toEqual({
      baseUrl: null,
      hasApiKey: false
    })
  })

  it('reports the stored base URL and that a key exists', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    const info = await getConnectionInfo()
    expect(info).toEqual({ baseUrl: VALID_BASE_URL, hasApiKey: true })
    // The secret must not leak into this payload under any key.
    expect(JSON.stringify(info)).not.toContain(TEST_API_KEY)
  })

  it('reports baseUrl: null when the persisted URL is invalid', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    // Simulate a hand-edited store entry. On the safeStorage path the store
    // file is plaintext JSON (see the on-disk test above), so we can rewrite
    // the URL in place and force a re-read.
    const storeFile = `${userDataDir}/openproject-credentials.json`
    const parsed = JSON.parse(readFileSync(storeFile, 'utf8'))
    parsed.openproject.baseUrl = 'not-a-url'
    writeFileSync(storeFile, JSON.stringify(parsed), 'utf8')
    __resetStoreForTests()

    expect(await getConnectionInfo()).toEqual({
      baseUrl: null,
      hasApiKey: true
    })
  })
})

// A URL-only change: the renderer never receives the key, so an omitted
// `apiKey` has to mean "keep the stored one".
describe('saving without an API key keeps the stored one', () => {
  it('updates the base URL and leaves the key intact', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    await saveCredentials({ baseUrl: OTHER_BASE_URL })

    const creds = await getCredentials()
    expect(creds).toEqual({ baseUrl: OTHER_BASE_URL, apiKey: TEST_API_KEY })
  })

  it('treats a blank key the same as an omitted one', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    await saveCredentials({ baseUrl: OTHER_BASE_URL, apiKey: '   ' })

    const creds = await getCredentials()
    expect(creds).toEqual({ baseUrl: OTHER_BASE_URL, apiKey: TEST_API_KEY })
  })

  it('does not touch the store when the new base URL is invalid', async () => {
    await saveCredentials({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })

    await expect(saveCredentials({ baseUrl: 'not-a-url' })).rejects.toBeInstanceOf(
      CredentialValidationError
    )

    const creds = await getCredentials()
    expect(creds).toEqual({ baseUrl: VALID_BASE_URL, apiKey: TEST_API_KEY })
  })
})