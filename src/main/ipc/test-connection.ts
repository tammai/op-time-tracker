import { ipcMain } from 'electron'

import { OpenProjectApiKeySchema } from '@shared/validation/api-key'
import { OpenProjectBaseUrlSchema } from '@shared/validation/url'
import { getCredentials } from '../credentials'

/**
 * Input for the test-connection probe. The renderer passes the *unsaved*
 * form values (base URL + API key) so the user can verify the connection
 * before persisting.
 *
 * `apiKey` is optional: the settings form never receives the stored key, so
 * an omitted key means "probe with the one already in the keychain". The
 * key is resolved inside the main process — it never reaches the renderer.
 *
 * Security note: a supplied API key is user-entered, not yet stored. It is
 * used once for this probe inside the main process and never logged, never
 * returned in the response, never persisted. The response is just `{ ok }`.
 * See `.opencode/rules/security.md`.
 */
export interface TestConnectionInput {
  baseUrl: string
  apiKey?: string
}

/**
 * Typed result of the test-connection probe. On failure, `error` is a
 * human-readable message safe to surface in the renderer. Never includes
 * the API key or the base URL.
 */
export type TestConnectionResult =
  | { ok: true }
  | { ok: false; error: string }

/** Abort the probe after this many milliseconds. */
const PROBE_TIMEOUT_MS = 10_000

/**
 * Register the test-connection IPC handler.
 *
 * Channel: `op:openproject:test-connection`
 *
 * This is a minimal probe so the onboarding flow (task 4) can verify the
 * URL + key authenticate against the OpenProject server before saving. It
 * GETs the OpenProject API root (`/api/v3`) with the same `Basic` auth the
 * full client (task 5) will use and treats a 2xx as success. Task 5 will
 * fold this into the full OpenProject client — keep this handler thin.
 *
 * The fetch happens in the main process only. The key never crosses IPC as
 * a stored value — it arrives as user input from the renderer's form, is
 * used once for the probe, and is discarded. It is never logged.
 */
export function registerTestConnectionIpcHandler(): void {
  ipcMain.handle(
    'op:openproject:test-connection',
    async (_event, input: TestConnectionInput): Promise<TestConnectionResult> => {
      // Validate both inputs via the shared Zod schemas before any network
      // call. Reuses the same source of truth as the credential save path.
      const baseUrlResult = OpenProjectBaseUrlSchema.safeParse(input?.baseUrl)
      if (!baseUrlResult.success) {
        return {
          ok: false,
          error: baseUrlResult.error.issues[0]?.message ?? 'Invalid base URL.'
        }
      }

      // No key in the payload → probe with the stored one (the settings form
      // leaves the field blank when the user isn't changing the key).
      let candidateKey = input?.apiKey
      if (candidateKey === undefined || candidateKey.trim().length === 0) {
        try {
          const stored = await getCredentials()
          if (!stored) {
            return { ok: false, error: 'Enter an API key to test the connection.' }
          }
          candidateKey = stored.apiKey
        } catch (e) {
          // Corrupt / undecryptable store. The message is safe to surface —
          // it never contains the key.
          return { ok: false, error: (e as Error).message }
        }
      }

      const apiKeyResult = OpenProjectApiKeySchema.safeParse(candidateKey)
      if (!apiKeyResult.success) {
        return {
          ok: false,
          error: apiKeyResult.error.issues[0]?.message ?? 'Invalid API key.'
        }
      }

      // Build the probe URL from the validated origin (strips userinfo /
      // query / hash). `/api/v3` is the OpenProject API root.
      const probeUrl = `${new URL(baseUrlResult.data).origin}/api/v3`

      // OpenProject API key auth: `Basic base64("apikey:<key>")`.
      // The key is a secret — never logged. The Authorization header lives
      // only in this fetch, inside the main process.
      const auth = `Basic ${Buffer.from(`apikey:${apiKeyResult.data}`).toString('base64')}`

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

      try {
        const res = await fetch(probeUrl, {
          method: 'GET',
          headers: { Authorization: auth, Accept: 'application/json' },
          signal: controller.signal
        })
        if (res.ok) {
          return { ok: true }
        }
        // Normalize a few common statuses into actionable messages. The key
        // is never included.
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            error: `Authentication failed (HTTP ${res.status}). Check your API key.`
          }
        }
        if (res.status === 404) {
          return {
            ok: false,
            error: `The server responded with HTTP 404. Check the base URL.`
          }
        }
        return {
          ok: false,
          error: `The server responded with HTTP ${res.status}.`
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
          return {
            ok: false,
            error: `Connection timed out after ${PROBE_TIMEOUT_MS / 1000}s.`
          }
        }
        return {
          ok: false,
          error: `Could not reach the OpenProject server: ${(e as Error).message}`
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  )
}