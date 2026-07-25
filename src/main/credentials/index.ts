import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { hostname, userInfo } from 'node:os'

import {
  OpenProjectApiKeySchema,
  formatApiKeyZodError
} from '@shared/validation/api-key'
import {
  OpenProjectBaseUrlSchema,
  formatUrlZodError
} from '@shared/validation/url'

/**
 * Credentials held in the main process. `baseUrl` is the validated,
 * normalized URL string (not secret); `apiKey` is the raw secret string.
 *
 * This type never crosses IPC — the renderer only learns *whether*
 * credentials are configured (`hasCredentials`), never the values.
 * See `.opencode/rules/security.md`.
 */
export interface Credentials {
  baseUrl: string
  apiKey: string
}

/**
 * The non-secret half of the stored credentials — safe to hand to the
 * renderer so the settings form can show the configured base URL and
 * indicate that a key is stored without ever revealing it.
 *
 * `hasApiKey` is presence only; the key itself never crosses IPC.
 * See `.opencode/rules/security.md`.
 */
export interface ConnectionInfo {
  /** Stored base URL, or `null` when nothing is saved yet. */
  baseUrl: string | null
  /** True when an API key is stored (never says *what* it is). */
  hasApiKey: boolean
}

/** Shape persisted on disk by the credential store. */
interface StoredCredentials {
  /** Plaintext http(s) base URL — not secret. */
  baseUrl: string
  /**
   * Encoded API key value. Encoding depends on `storageMode`:
   *
   * - `safeStorage`: base64 of the `safeStorage.encryptString` buffer
   *   (OS keychain — macOS Keychain / Windows DPAPI / libsecret on Linux).
   * - `fallback`: the raw key string. This is NOT plaintext on disk — the
   *   entire `electron-store` file is encrypted with a per-machine
   *   `encryptionKey` (see `getFallbackEncryptionKey()`). electron-store
   *   transparently decrypts on read, so we get the raw string back.
   *
   * Never plaintext on disk, on either path.
   */
  apiKeyCipher: string
  /** Which encryption mode produced `apiKeyCipher`. Drives the read path. */
  storageMode: 'safeStorage' | 'fallback'
}

/**
 * Error thrown when credentials are present but cannot be read
 * (corruption / decryption failure). Callers must not swallow this —
 * surface it as a typed IPC error to the renderer so the user can
 * re-enter credentials.
 */
export class CredentialReadError extends Error {
  readonly code = 'CREDENTIAL_READ_FAILED' as const
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'CredentialReadError'
  }
}

/** Error thrown when an input fails validation at save time. */
export class CredentialValidationError extends Error {
  readonly code = 'CREDENTIAL_VALIDATION_FAILED' as const
  constructor(message: string) {
    super(message)
    this.name = 'CredentialValidationError'
  }
}

/** Error thrown when credential APIs are called before `app.isReady()`. */
export class CredentialNotReadyError extends Error {
  readonly code = 'CREDENTIAL_NOT_READY' as const
  constructor() {
    super(
      'Credential store called before app.whenReady() — safeStorage requires the Electron app to be ready.'
    )
    this.name = 'CredentialNotReadyError'
  }
}

const STORE_NAMESPACE = 'openproject-credentials'
const BASE_URL_KEY = 'openproject.baseUrl'
const API_KEY_CIPHER_KEY = 'openproject.apiKeyCipher'
const STORAGE_MODE_KEY = 'openproject.storageMode'
const MACHINE_ID_FILE = 'machine-id.txt'

let storeInstance: Store<Record<string, unknown>> | null = null

/**
 * Lazily create the `electron-store` instance. Lives in the OS-appropriate
 * app data dir (`app.getPath('userData')`). When `safeStorage` is unavailable,
 * the store is created with a per-machine `encryptionKey` so the API key is
 * never written to disk in plaintext even on the fallback path.
 */
function getStore(): Store<Record<string, unknown>> {
  if (storeInstance) return storeInstance

  if (!app.isReady()) {
    throw new CredentialNotReadyError()
  }

  const cwd = app.getPath('userData')
  const safeStorageAvailable = safeStorage.isEncryptionAvailable()

  // When safeStorage is available, the API key buffer is encrypted by us
  // with `safeStorage.encryptString` and stored as base64 — the store file
  // itself doesn't need a separate encryption layer.
  //
  // When safeStorage is NOT available, we let electron-store encrypt the
  // entire config file with a per-machine key derived from a random
  // machine-id file. This is weaker than OS keychain (any process on this
  // machine that can read the machine-id file + the store file can decrypt),
  // but it is NOT plaintext, and it is the documented fallback per the spec.
  // The onboarding UI (task 4) should warn the user in this case.
  const options: ConstructorParameters<typeof Store>[0] = {
    cwd,
    name: STORE_NAMESPACE,
    accessPropertiesByDotNotation: true
  }
  if (!safeStorageAvailable) {
    options.encryptionKey = getFallbackEncryptionKey(cwd)
  }

  storeInstance = new Store<Record<string, unknown>>(options)
  return storeInstance
}

/**
 * Derive (or create + persist) a per-machine encryption key for the
 * safeStorage-unavailable fallback path.
 *
 * Strategy: a random 32-byte value, generated once and persisted to
 * `userData/machine-id.txt` (NOT a secret on its own — its job is only to
 * make the on-disk `electron-store` file non-plaintext). Falls back to a
 * deterministic hash of `hostname + username` if the file can't be created
 * (e.g. read-only FS), so the key is at least machine+user-scoped.
 */
function getFallbackEncryptionKey(userDataDir: string): string {
  const idFilePath = join(userDataDir, MACHINE_ID_FILE)
  try {
    if (existsSync(idFilePath)) {
      const existing = readFileSync(idFilePath, 'utf8').trim()
      if (existing.length > 0) return existing
    }
    // Generate + persist a fresh random id.
    const id = randomBytes(32).toString('hex')
    try {
      mkdirSync(userDataDir, { recursive: true })
    } catch {
      /* directory may already exist or be a system-managed userData dir */
    }
    writeFileSync(idFilePath, id, { encoding: 'utf8', mode: 0o600 })
    return id
  } catch {
    // Last resort: derive from machine + user identity. Still not plaintext
    // on disk (electron-store applies AES with this as the key).
    const fingerprint = `${hostname()}|${userInfo().username}`
    return createHash('sha256').update(fingerprint).digest('hex')
  }
}

/**
 * Returns true if credentials are saved. Cheap — does not decrypt the API
 * key. Safe to call from IPC handlers that just gate the onboarding flow.
 */
export async function hasCredentials(): Promise<boolean> {
  if (!app.isReady()) throw new CredentialNotReadyError()
  const store = getStore()
  const hasBaseUrl = Boolean(store.get(BASE_URL_KEY))
  const hasCipher = Boolean(store.get(API_KEY_CIPHER_KEY))
  const hasMode = Boolean(store.get(STORAGE_MODE_KEY))
  return hasBaseUrl && hasCipher && hasMode
}

/**
 * Read back the non-secret connection info. Never decrypts the API key —
 * it only reports whether one is stored, so this is safe to expose over IPC.
 *
 * An invalid persisted base URL is reported as `null` rather than thrown:
 * the caller is a form that is about to overwrite it anyway, and
 * `getCredentials()` still refuses to build requests from it.
 */
export async function getConnectionInfo(): Promise<ConnectionInfo> {
  if (!app.isReady()) throw new CredentialNotReadyError()
  const store = getStore()

  const baseUrlResult = OpenProjectBaseUrlSchema.safeParse(
    store.get(BASE_URL_KEY)
  )
  const apiKeyCipher = store.get(API_KEY_CIPHER_KEY)

  return {
    baseUrl: baseUrlResult.success ? baseUrlResult.data : null,
    hasApiKey: typeof apiKeyCipher === 'string' && apiKeyCipher.length > 0
  }
}

/**
 * Read the stored credentials. Returns `null` if nothing is saved yet.
 * Throws `CredentialReadError` if the store is present but unreadable
 * (corruption / decryption failure) — do not swallow.
 *
 * Main-process only. Never send the returned `apiKey` across IPC.
 */
export async function getCredentials(): Promise<Credentials | null> {
  if (!app.isReady()) throw new CredentialNotReadyError()
  const store = getStore()

  const baseUrl = store.get(BASE_URL_KEY)
  const apiKeyCipher = store.get(API_KEY_CIPHER_KEY)
  const storageMode = store.get(STORAGE_MODE_KEY)

  // Nothing saved yet.
  if (!baseUrl && !apiKeyCipher && !storageMode) return null

  // Re-validate the persisted base URL. If a hand-edit or schema change made
  // it invalid, treat as unreadable rather than hand back a value that could
  // be used to build a bad request URL.
  const baseUrlResult = OpenProjectBaseUrlSchema.safeParse(baseUrl)
  if (!baseUrlResult.success) {
    throw new CredentialReadError(
      'Stored base URL is invalid. Please re-enter your OpenProject base URL.'
    )
  }

  if (typeof apiKeyCipher !== 'string' || apiKeyCipher.length === 0) {
    throw new CredentialReadError(
      'Stored API key is missing. Please re-enter your OpenProject API key.'
    )
  }

  if (storageMode !== 'safeStorage' && storageMode !== 'fallback') {
    throw new CredentialReadError(
      'Stored credentials are in an unknown format. Please re-enter them.'
    )
  }

  // Decrypt according to the mode recorded at save time. This avoids the
  // "safeStorage was available at save, unavailable at read" mismatch — if
  // safeStorage is no longer available, we surface a clear error and ask
  // the user to re-enter credentials (rather than silently mis-decrypting).
  let apiKey: string
  if (storageMode === 'safeStorage') {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new CredentialReadError(
        'The OS keychain is no longer available. Please re-enter your OpenProject API key.'
      )
    }
    let cipherBuf: Buffer
    try {
      cipherBuf = Buffer.from(apiKeyCipher, 'base64')
    } catch (e) {
      throw new CredentialReadError('Stored API key is corrupted.', e)
    }
    try {
      apiKey = safeStorage.decryptString(cipherBuf)
    } catch (e) {
      throw new CredentialReadError(
        'Could not decrypt the stored API key (OS keychain refused). ' +
          'Please re-enter your OpenProject API key.',
        e
      )
    }
  } else {
    // Fallback path: electron-store already decrypted the whole file using
    // its `encryptionKey`. The stored value is the raw key string.
    apiKey = apiKeyCipher
  }

  return { baseUrl: baseUrlResult.data, apiKey }
}

/**
 * Validate and persist credentials. `baseUrl` is stored in plaintext (not
 * secret); `apiKey` is encrypted before hitting disk — never plaintext, on
 * either the safeStorage or the fallback path.
 *
 * `apiKey` may be omitted (or empty) to mean *keep the stored key* — the
 * settings form never receives the current key, so "change only the URL"
 * has to be expressible without the renderer echoing the secret back. With
 * no key stored, an omitted `apiKey` is a validation error.
 *
 * Throws `CredentialValidationError` if the inputs fail validation; nothing
 * is written in that case.
 */
export async function saveCredentials(input: {
  baseUrl: string
  apiKey?: string
}): Promise<void> {
  if (!app.isReady()) throw new CredentialNotReadyError()

  // Validate both inputs via Zod before touching storage. The base URL
  // schema enforces http(s); the API key schema enforces non-empty.
  const baseUrlResult = OpenProjectBaseUrlSchema.safeParse(input.baseUrl)
  if (!baseUrlResult.success) {
    throw new CredentialValidationError(formatUrlZodError(baseUrlResult.error))
  }

  // No key supplied → reuse the stored one. `getCredentials()` throws
  // `CredentialReadError` on a corrupt store, which is the right answer:
  // we can't silently persist a URL against a key we can't read.
  let incomingApiKey = input.apiKey
  if (incomingApiKey === undefined || incomingApiKey.trim().length === 0) {
    const existing = await getCredentials()
    if (!existing) {
      throw new CredentialValidationError('API key is required.')
    }
    incomingApiKey = existing.apiKey
  }

  const apiKeyResult = OpenProjectApiKeySchema.safeParse(incomingApiKey)
  if (!apiKeyResult.success) {
    throw new CredentialValidationError(
      formatApiKeyZodError(apiKeyResult.error)
    )
  }

  const store = getStore()
  const safeStorageAvailable = safeStorage.isEncryptionAvailable()
  const mode: 'safeStorage' | 'fallback' = safeStorageAvailable
    ? 'safeStorage'
    : 'fallback'

  // Encrypt the API key. On the safeStorage path we encrypt ourselves and
  // store the base64 of the encrypted buffer. On the fallback path,
  // electron-store's `encryptionKey` encrypts the whole file, so we store
  // the raw key string and rely on the file-level encryption.
  if (safeStorageAvailable) {
    const cipherBuf = safeStorage.encryptString(apiKeyResult.data)
    const cipherB64 = cipherBuf.toString('base64')
    store.set(BASE_URL_KEY, baseUrlResult.data)
    store.set(API_KEY_CIPHER_KEY, cipherB64)
    store.set(STORAGE_MODE_KEY, mode)
  } else {
    store.set(BASE_URL_KEY, baseUrlResult.data)
    store.set(API_KEY_CIPHER_KEY, apiKeyResult.data)
    store.set(STORAGE_MODE_KEY, mode)
  }
}

/**
 * Remove stored credentials. Safe to call even if nothing is stored.
 */
export async function clearCredentials(): Promise<void> {
  if (!app.isReady()) throw new CredentialNotReadyError()
  const store = getStore()
  store.delete(BASE_URL_KEY)
  store.delete(API_KEY_CIPHER_KEY)
  store.delete(STORAGE_MODE_KEY)
}

/**
 * Test-only escape hatch: reset the cached store instance so a fresh
 * `electron-store` is created on next access. Not part of the public
 * credential API — exported only so unit/integration tests (task 9) can
 * swap environments between safeStorage-available and fallback scenarios.
 */
export function __resetStoreForTests(): void {
  storeInstance = null
}

export type StoredCredentialsShape = StoredCredentials