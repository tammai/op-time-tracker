import { ipcMain } from 'electron'

import {
  clearCredentials,
  getConnectionInfo,
  hasCredentials,
  saveCredentials,
  CredentialReadError,
  CredentialValidationError,
  CredentialNotReadyError
} from '../credentials'
import { IpcError } from './error'

/**
 * Register credential IPC handlers.
 *
 * Channel naming follows `.opencode/rules/conventions-server.md`:
 * `op:` prefix + kebab-case domain.
 *
 * Security note (`.opencode/rules/security.md`): there is intentionally NO
 * `op:credentials:get` handler. The renderer must never receive the API key
 * (or the credentials object) across IPC — it only learns *whether*
 * credentials are configured (`op:credentials:has`) and, for the settings
 * form, the non-secret base URL plus a `hasApiKey` flag
 * (`op:credentials:get-connection-info`). All OpenProject HTTP calls happen
 * in the main process (task 5) using `getCredentials()` directly.
 */
export function registerCredentialIpcHandlers(): void {
  ipcMain.handle('op:credentials:has', async () => {
    try {
      return await hasCredentials()
    } catch (e) {
      // Not-ready / store errors are operational, not a "no" answer.
      // Surface as a thrown error so the renderer can distinguish.
      throw toIpcError(e)
    }
  })

  // Non-secret read-back for the settings form: the configured base URL and
  // whether a key is stored. Never the key itself.
  ipcMain.handle('op:credentials:get-connection-info', async () => {
    try {
      return await getConnectionInfo()
    } catch (e) {
      throw toIpcError(e)
    }
  })

  // `apiKey` is optional — omitted means "keep the stored key", so the user
  // can change only the base URL without the renderer ever holding the key.
  ipcMain.handle(
    'op:credentials:save',
    async (_event, input: { baseUrl: string; apiKey?: string }) => {
      try {
        await saveCredentials(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle('op:credentials:clear', async () => {
    try {
      await clearCredentials()
    } catch (e) {
      throw toIpcError(e)
    }
  })
}

/**
 * Normalize internal credential errors into an `IpcError` (a proper `Error`
 * subclass with a stable `code` field). Electron's `ipcMain.handle`
 * preserves `Error.message` across IPC but serializes plain objects as
 * `[object Object]` — so we must throw an `Error`, not a plain object.
 *
 * Never includes the API key or credentials object — these errors are about
 * validation / readiness / corruption only.
 */
function toIpcError(e: unknown): IpcError {
  if (e instanceof CredentialValidationError) {
    return new IpcError(e.code, e.message)
  }
  if (e instanceof CredentialNotReadyError) {
    return new IpcError(e.code, e.message)
  }
  if (e instanceof CredentialReadError) {
    return new IpcError(e.code, e.message)
  }
  if (e instanceof Error) {
    return new IpcError('CREDENTIAL_UNKNOWN', e.message)
  }
  return new IpcError('CREDENTIAL_UNKNOWN', 'Unknown credential error.')
}