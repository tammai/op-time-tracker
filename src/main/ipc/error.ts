/**
 * Shared IPC error class — a proper `Error` subclass that carries a stable
 * `code` field. Electron's `ipcMain.handle` serializes thrown `Error`
 * instances across IPC (preserving `message` + `name`), but plain objects
 * become `[object Object]` and lose their fields. Always throw an
 * `IpcError` (or an `Error` subclass) from IPC handlers — never a plain
 * `{ code, message }` object.
 *
 * The renderer reads `error.message` for display and `error.code` (via
 * `(error as { code?: string }).code`) for branching.
 */
export class IpcError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'IpcError'
    this.code = code
  }
}