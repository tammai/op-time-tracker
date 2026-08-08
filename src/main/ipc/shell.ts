import { ipcMain, shell } from 'electron'
import { z } from 'zod'

import { getConnectionInfo } from '../credentials'
import { buildRequestUrl } from '../openproject/client'
import { IpcError } from './error'
import { toIpcError } from './openproject'

/**
 * The shell IPC surface — currently one channel: open a work package in the
 * user's default browser.
 *
 * This is the app's only sink that hands a URL to the **operating system**, so
 * it is deliberately the narrowest possible channel. It makes no OpenProject
 * request and never reads the API key.
 *
 * Security model (`.opencode/rules/security.md`):
 *
 * 1. **The renderer sends a number, never a URL.** The only value crossing IPC
 *    is `workPackageId`, Zod-validated as a positive integer before anything is
 *    built. Every other key on the input object is ignored, so a hostile
 *    renderer cannot smuggle an href, a path, or a scheme through.
 * 2. **The URL is built here, from the stored base URL.** It is *never* built
 *    from `_links.self.href`: that field is server-supplied, and a hostile or
 *    compromised OpenProject instance could otherwise carry an arbitrary href
 *    straight into `shell.openExternal`. Reusing the client's
 *    `buildRequestUrl()` also strips userinfo and normalizes the path join.
 * 3. **The scheme is re-asserted at the sink.** `OpenProjectBaseUrlSchema`
 *    already enforces http(s) when credentials are saved *and* when they are
 *    read back, so {@link buildWorkPackageWebUrl}'s protocol check is
 *    unreachable through the normal path by design. It exists for the case
 *    where those two disagree — a hand-edited or corrupted store — so that a
 *    tampered credential store still cannot produce a `file:`/`smb:` launch.
 *    It is tested directly rather than through the handler for that reason.
 * 4. **Nothing about the failure is forwarded.** The OS error text is replaced
 *    with our own message, and everything else is normalized through the
 *    existing `toIpcError()`, so no credential detail reaches the renderer.
 *
 * Note on the read: this handler uses `getConnectionInfo()`, not
 * `getCredentials()`. It needs only the non-secret base URL, and
 * `getConnectionInfo()` is the accessor that never decrypts the key — reading
 * the secret on a path that has no use for it would be gratuitous.
 */

/** OpenProject's **web** path for a work package (not the `/api/v3` one). */
const WORK_PACKAGE_WEB_PATH = '/work_packages'

/**
 * The one value the renderer may send. A positive integer and nothing else:
 * `z.number()` rejects `NaN` and non-numbers, `.int()` rejects `1.5` and
 * `Infinity`, `.positive()` rejects `0` and negatives. Unknown keys are
 * ignored rather than rejected — extra properties can't influence the URL, and
 * the contract stays additive for stages 2–3.
 */
const OpenWorkPackageInputSchema = z.object({
  workPackageId: z.number().int().positive()
})

/**
 * Build the browser URL for a work package: `<baseUrl>/work_packages/<id>`.
 *
 * Exported for its own unit tests — this is the security-critical half of the
 * channel, and asserting the scheme guard through the handler is impossible
 * once the credential layer has (correctly) refused the same input first.
 *
 * @throws {IpcError} `SHELL_UNSAFE_TARGET` if the resolved URL is not http(s),
 *   or the base URL cannot be parsed at all.
 */
export function buildWorkPackageWebUrl(
  baseUrl: string,
  workPackageId: number
): URL {
  let url: URL
  try {
    url = buildRequestUrl(baseUrl, `${WORK_PACKAGE_WEB_PATH}/${workPackageId}`)
  } catch {
    throw new IpcError(
      'SHELL_UNSAFE_TARGET',
      'The configured OpenProject URL could not be used to build a link.'
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IpcError(
      'SHELL_UNSAFE_TARGET',
      'Refusing to open a link that is not an http(s) address.'
    )
  }
  return url
}

/**
 * Register the shell IPC handlers. Called from `src/main/index.ts` on
 * `app.whenReady()`, alongside the other `register*IpcHandlers()` calls.
 */
export function registerShellIpcHandlers(): void {
  ipcMain.handle('op:shell:open-work-package', async (_event, input: unknown) => {
    try {
      // Validate before anything else — including before reading credentials.
      // A bad id is the renderer's problem and must be reported as such, not
      // as a configuration error the user would go looking for.
      const parsed = OpenWorkPackageInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new IpcError(
          'SHELL_INVALID_INPUT',
          'A work package id must be a positive integer.'
        )
      }

      const { baseUrl } = await getConnectionInfo()
      if (!baseUrl) {
        // Covers both "nothing saved" and "what's saved isn't a usable
        // http(s) URL" — `getConnectionInfo()` reports the latter as `null`.
        // One remedy fits both.
        throw new IpcError(
          'CREDENTIAL_NOT_CONFIGURED',
          'No usable OpenProject URL is configured. Open Settings and re-enter it.'
        )
      }

      const url = buildWorkPackageWebUrl(baseUrl, parsed.data.workPackageId)

      try {
        await shell.openExternal(url.href)
      } catch {
        // The OS error text is not ours to trust or forward — on some platforms
        // it echoes the whole target back. Replace it with a fixed message.
        throw new IpcError(
          'SHELL_OPEN_FAILED',
          'Could not open the work package in your browser.'
        )
      }
    } catch (e) {
      throw toIpcError(e)
    }
  })
}
