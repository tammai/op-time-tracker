/**
 * The typed contract for the `window.openproject.*` bridge exposed by the
 * preload script. The renderer imports types from here (via the
 * `@opentracker/preload` alias) — it never reaches into `src/main/` directly.
 *
 * This is the IPC contract between renderer and main process. Adding a new
 * method or optional field is fine; removing/renaming is a breaking change.
 * See `.opencode/rules/architecture.md`.
 *
 * The resource types (`WorkPackage`, `TimeEntry`, etc.) are re-exported
 * from the Zod schemas in `src/main/schemas/` — the schema is the single
 * source of truth for both the validator and the TS type. The renderer
 * never sees raw server shapes, only these validated types.
 *
 * Security note: there is intentionally NO `getCredentials()` method here.
 * The renderer must never receive the API key. It only learns *whether*
 * credentials are configured (`hasCredentials`) and can save/clear them.
 * See `.opencode/rules/security.md`.
 */

import type {
  WorkPackage,
  WorkPackageCollection,
  WorkPackageLinks
} from '../main/schemas/work-packages'
import type {
  TimeEntry,
  TimeEntryCollection,
  TimeEntryLinks,
  TimeEntryActivity,
  TimeEntryActivityCollection,
  CreateTimeEntryInput,
  parseHoursToDecimal
} from '../main/schemas/time-entries'
import type {
  Status,
  StatusCollection
} from '../main/schemas/statuses'
import type {
  WorkPackageFilters,
  TimeEntryFilters,
  OpenProjectError,
  OpenProjectAuthError,
  OpenProjectNotFoundError,
  OpenProjectServerError,
  OpenProjectHttpError,
  OpenProjectSchemaError,
  OpenProjectTimeoutError
} from '../main/openproject/client'

// Re-export so the renderer can import these types via
// `@opentracker/preload` (the IPC contract surface). The schemas in
// `src/main/schemas/` remain the single source of truth.
export type {
  WorkPackage,
  WorkPackageCollection,
  WorkPackageLinks,
  TimeEntry,
  TimeEntryCollection,
  TimeEntryLinks,
  TimeEntryActivity,
  TimeEntryActivityCollection,
  CreateTimeEntryInput,
  parseHoursToDecimal,
  Status,
  StatusCollection,
  WorkPackageFilters,
  TimeEntryFilters,
  OpenProjectError,
  OpenProjectAuthError,
  OpenProjectNotFoundError,
  OpenProjectServerError,
  OpenProjectHttpError,
  OpenProjectSchemaError,
  OpenProjectTimeoutError
}

export interface SaveCredentialsInput {
  baseUrl: string
  /**
   * Omit (or pass empty) to keep the API key already in the keychain — the
   * renderer can't echo back a key it never receives, so this is how a
   * URL-only change is expressed. Required when nothing is stored yet.
   */
  apiKey?: string
}

/** Input for the test-connection probe (unsaved form values). */
export interface TestConnectionInput {
  baseUrl: string
  /** Omit to probe with the stored key (resolved in the main process). */
  apiKey?: string
}

/**
 * The non-secret half of the stored credentials, for prefilling the settings
 * form. `hasApiKey` reports presence only — the key itself is never sent.
 */
export interface ConnectionInfo {
  baseUrl: string | null
  hasApiKey: boolean
}

/**
 * Result of the test-connection probe. On failure, `error` is a
 * human-readable message. Never includes the API key or base URL.
 */
export type TestConnectionResult =
  | { ok: true }
  | { ok: false; error: string }

/** Optional input for `listWorkPackages` / `listTimeEntries`. */
export interface ListWorkPackagesInput {
  filters?: WorkPackageFilters
}
export interface ListTimeEntriesInput {
  filters?: TimeEntryFilters
}

/**
 * Optional scoping for `listTimeEntryActivities`. Passing the work package
 * the user is logging against limits the activities to the ones allowed in
 * that work package's project.
 */
export interface ListTimeEntryActivitiesInput {
  workPackageId?: number
}

export interface OpenProjectBridge {
  /**
   * Scaffold-only placeholder. Confirms the preload bridge is wired.
   */
  ping(): Promise<string>

  /**
   * Returns true if credentials are saved. Cheap — does not expose the
   * API key. Used by the onboarding gate (task 4) to decide whether to
   * show the form or the main window.
   */
  hasCredentials(): Promise<boolean>

  /**
   * Read back the non-secret connection info so the settings form can show
   * the configured base URL and indicate that a key is stored. Never
   * returns the API key — `hasApiKey` is presence only.
   */
  getConnectionInfo(): Promise<ConnectionInfo>

  /**
   * Validate and persist credentials. Rejects (throws) on validation
   * failure with `{ code, message }` — the renderer should catch and
   * surface the message. Never returns the saved values. Omit `apiKey` to
   * keep the stored one.
   */
  saveCredentials(input: SaveCredentialsInput): Promise<void>

  /**
   * Remove stored credentials. Safe to call when none are stored.
   */
  clearCredentials(): Promise<void>

  /**
   * Probe the OpenProject server with the unsaved form values to verify
   * the URL + API key authenticate before saving. The key is user-entered,
   * used once for this probe in the main process, never logged, never
   * persisted, never returned in the result. See `.opencode/rules/security.md`.
   */
  testConnection(
    input: TestConnectionInput
  ): Promise<TestConnectionResult>

  /**
   * Fetch the work packages list from the configured OpenProject instance.
   * All HTTP + Zod validation happens in the main process; the renderer
   * receives only the validated `WorkPackageCollection`. Throws
   * `{ code, message }` on auth / network / schema errors.
   */
  listWorkPackages(
    input?: ListWorkPackagesInput
  ): Promise<WorkPackageCollection>

  /**
   * Fetch time entries from the configured OpenProject instance. The
   * calendar (task 7) passes `filters.spentOn: { between: [start, end] }`.
   * Throws `{ code, message }` on auth / network / schema errors.
   */
  listTimeEntries(
    input?: ListTimeEntriesInput
  ): Promise<TimeEntryCollection>

  /**
   * Fetch the list of status resources from the configured OpenProject
   * instance. Used by the renderer to resolve work-package status titles
   * to status resource IDs (the work-package `status` filter `=` operator
   * requires IDs, not titles). All HTTP + Zod validation happens in the
   * main process; the renderer receives only the validated
   * `StatusCollection`. Throws `{ code, message }` on auth / network /
   * schema errors.
   */
  listStatuses(): Promise<StatusCollection>

  /**
   * Create a time entry. The only **write** method on the bridge.
   *
   * `input` carries plain numeric ids — never hrefs or paths. The main
   * process Zod-validates it (`CreateTimeEntryInputSchema`) before building
   * a request and constructs the `_links` hrefs itself, so the renderer
   * cannot influence the request URL. Rejects with `{ code, message }`:
   * `OPENPROJECT_INVALID_INPUT` when the details fail validation,
   * `OPENPROJECT_VALIDATION_FAILED` when OpenProject itself refuses the
   * entry (HTTP 422 — e.g. the activity isn't allowed for that project).
   */
  createTimeEntry(input: CreateTimeEntryInput): Promise<TimeEntry>

  /**
   * Fetch the activities that may be assigned to a time entry — required
   * on every entry, so the form's Activity select is populated from here.
   * Pass `workPackageId` to scope the list to that work package's project.
   * Throws `{ code, message }` on auth / network / schema errors.
   */
  listTimeEntryActivities(
    input?: ListTimeEntryActivitiesInput
  ): Promise<TimeEntryActivityCollection>
}

declare global {
  interface Window {
    openproject: OpenProjectBridge
  }
}

export {}