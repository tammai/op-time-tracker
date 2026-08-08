import { ipcMain } from 'electron'

import { getCredentials } from '../credentials'
import {
  OpenProjectClient,
  OpenProjectError,
  type WorkPackageFilters,
  type TimeEntryFilters,
  type CreateTimeEntryInput,
  type UpdateTimeEntryInput,
  type DeleteTimeEntryInput,
  type WorkPackageFormInput,
  type WorkPackageCreateFormInput,
  type AvailableAssigneesInput,
  type UpdateWorkPackageInput,
  type CreateWorkPackageInput
} from '../openproject/client'
import {
  CredentialReadError,
  CredentialNotReadyError
} from '../credentials'
import { IpcError } from './error'

/**
 * Register the OpenProject IPC handlers — the read surface plus the time
 * entry create/update/delete writes.
 *
 * Channel naming follows `.opencode/rules/conventions-server.md`:
 * `op:` prefix + kebab-case domain. The renderer calls these via the typed
 * `window.openproject.*` bridge (see `src/preload/index.ts`).
 *
 * Security (`.opencode/rules/security.md`):
 * - Every handler reads credentials via `getCredentials()` (main-process
 *   only) and constructs an `OpenProjectClient` with them. The API key
 *   never crosses IPC — handlers return only Zod-validated data.
 * - Error normalization via `toIpcError()` strips the key, the auth
 *   header, and the raw response body from any error that reaches the
 *   renderer.
 */
export function registerOpenProjectIpcHandlers(): void {
  ipcMain.handle(
    'op:openproject:list-work-packages',
    async (_event, input?: { filters?: WorkPackageFilters }) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.listWorkPackages(input?.filters)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:list-time-entries',
    async (_event, input?: { filters?: TimeEntryFilters }) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.listTimeEntries(input?.filters)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:list-statuses',
    async () => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.listStatuses()
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  /**
   * The write channels. `input` arrives from the renderer, so it is **not**
   * trusted here — each client method Zod-validates it before building any
   * request and rejects with `OPENPROJECT_INVALID_INPUT` otherwise. The
   * client also builds every `_links` href from the validated numeric ids,
   * and the update/delete entry id is a validated positive integer before it
   * reaches the request path, so no renderer string reaches a request URL.
   */
  ipcMain.handle(
    'op:openproject:create-time-entry',
    async (_event, input: CreateTimeEntryInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.createTimeEntry(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:update-time-entry',
    async (_event, input: UpdateTimeEntryInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.updateTimeEntry(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:delete-time-entry',
    async (_event, input: DeleteTimeEntryInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        await client.deleteTimeEntry(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  /**
   * The work-package edit channels (stage 2).
   *
   * Same contract as the time-entry writes above: `input` is renderer-supplied
   * and therefore untrusted, so each client method Zod-validates it before a
   * request exists. Two things are specific to this trio:
   *
   * - `get-work-package-form` is a POST that reads. Its body is built in the
   *   client from one validated integer and carries nothing from here, so the
   *   channel cannot be used to write (`.opencode/rules/security.md`).
   * - `update-work-package` is a **partial** update: an absent field is left
   *   alone, `null` clears. A stale `lockVersion` comes back as
   *   `OPENPROJECT_CONFLICT`, which the renderer handles by refetching rather
   *   than retrying.
   */
  ipcMain.handle(
    'op:openproject:get-work-package-form',
    async (_event, input: WorkPackageFormInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.getWorkPackageForm(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:list-available-assignees',
    async (_event, input: AvailableAssigneesInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.listAvailableAssignees(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  /**
   * Who the stored key belongs to. Takes no input by design — the identity is
   * the key's, so the renderer has nothing to say about it.
   */
  ipcMain.handle('op:openproject:get-current-user', async () => {
    try {
      const creds = await requireCredentials()
      const client = new OpenProjectClient(creds)
      return await client.getCurrentUser()
    } catch (e) {
      throw toIpcError(e)
    }
  })

  ipcMain.handle(
    'op:openproject:update-work-package',
    async (_event, input: UpdateWorkPackageInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.updateWorkPackage(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  /**
   * The work-package create channels (stage 3).
   *
   * `list-projects` is the only one taking no input at all. The other two are
   * renderer-supplied and therefore untrusted, and each client method
   * Zod-validates before a request exists:
   *
   * - `get-work-package-create-form` is a POST that reads, like its edit-mode
   *   sibling — but it needs no lock version, so with no type chosen its body is
   *   empty and with one it is a single href rebuilt in the client from the
   *   validated integer. Nothing from here is forwarded.
   * - `create-work-package` sends numeric ids only; the client builds every
   *   `_links` href and pins the description's `format`
   *   (`.opencode/rules/security.md`). A 422 comes back as
   *   `OPENPROJECT_VALIDATION_FAILED` carrying OpenProject's own message, which
   *   the renderer shows while keeping the draft.
   */
  ipcMain.handle('op:openproject:list-projects', async () => {
    try {
      const creds = await requireCredentials()
      const client = new OpenProjectClient(creds)
      return await client.listProjects()
    } catch (e) {
      throw toIpcError(e)
    }
  })

  ipcMain.handle(
    'op:openproject:get-work-package-create-form',
    async (_event, input: WorkPackageCreateFormInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.getWorkPackageCreateForm(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:create-work-package',
    async (_event, input: CreateWorkPackageInput) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.createWorkPackage(input)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )

  ipcMain.handle(
    'op:openproject:list-time-entry-activities',
    async (_event, input?: { workPackageId?: number }) => {
      try {
        const creds = await requireCredentials()
        const client = new OpenProjectClient(creds)
        return await client.listTimeEntryActivities(input?.workPackageId)
      } catch (e) {
        throw toIpcError(e)
      }
    }
  )
}

/**
 * Read credentials or throw a typed "not configured" error. The renderer
 * uses this to gate the main window behind onboarding — but a defensive
 * check here means a renderer that calls the API before configuring still
 * gets a clear error instead of a crash.
 */
async function requireCredentials() {
  const creds = await getCredentials()
  if (creds === null) {
    const err = new Error(
      'No OpenProject credentials are configured. Please complete onboarding.'
    )
    err.name = 'CredentialNotConfigured'
    ;(err as { code?: string }).code = 'CREDENTIAL_NOT_CONFIGURED'
    throw err
  }
  return creds
}

/**
 * Normalize internal errors into an `IpcError` (a proper `Error` subclass
 * with a stable `code` field). Electron's `ipcMain.handle` preserves
 * `Error.message` across IPC but serializes plain objects as
 * `[object Object]` — so we must throw an `Error`, not a plain object.
 *
 * Never includes the API key, the auth header, the credentials object, or
 * the raw response body — only a stable `code` and a human-facing `message`.
 */
export function toIpcError(e: unknown): IpcError {
  // Already normalized — hand it straight back. A handler that raises its own
  // typed failure (`src/main/ipc/shell.ts` does, for input, target, and sink
  // errors) still funnels through here for the unexpected cases, and without
  // this branch its code would be flattened to `OPENPROJECT_UNKNOWN` on the way
  // out. An `IpcError` can only be constructed by our own code, with a message
  // already written for the renderer, so passing it through leaks nothing.
  if (e instanceof IpcError) {
    return e
  }
  if (e instanceof OpenProjectError) {
    return new IpcError(e.code, e.message)
  }
  if (e instanceof CredentialReadError) {
    return new IpcError(e.code, e.message)
  }
  if (e instanceof CredentialNotReadyError) {
    return new IpcError(e.code, e.message)
  }
  // The "not configured" sentinel thrown by `requireCredentials`.
  if (
    e instanceof Error &&
    (e as { code?: string }).code === 'CREDENTIAL_NOT_CONFIGURED'
  ) {
    return new IpcError('CREDENTIAL_NOT_CONFIGURED', e.message)
  }
  // Unknown error — surface a generic message. Never include any
  // potential secret-bearing detail from an unexpected error type.
  return new IpcError(
    'OPENPROJECT_UNKNOWN',
    'An unexpected error occurred while contacting OpenProject.'
  )
}