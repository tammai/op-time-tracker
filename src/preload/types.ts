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
  WorkPackageLinks,
  WorkPackageForm,
  WorkPackageFormField,
  WorkPackageCreateForm,
  WorkPackageCreateDefaults,
  AllowedValue,
  Formattable,
  WorkPackageFormInput,
  WorkPackageCreateFormInput,
  AvailableAssigneesInput,
  UpdateWorkPackageInput,
  CreateWorkPackageInput
} from '../main/schemas/work-packages'
import type {
  Principal,
  PrincipalCollection
} from '../main/schemas/principals'
import type { Project, ProjectCollection } from '../main/schemas/projects'
import type {
  TimeEntry,
  TimeEntryCollection,
  TimeEntryLinks,
  TimeEntryActivity,
  TimeEntryActivityCollection,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  DeleteTimeEntryInput,
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
  OpenProjectTimeoutError,
  OpenProjectConflictError
} from '../main/openproject/client'

// Re-export so the renderer can import these types via
// `@opentracker/preload` (the IPC contract surface). The schemas in
// `src/main/schemas/` remain the single source of truth.
export type {
  WorkPackage,
  WorkPackageCollection,
  WorkPackageLinks,
  WorkPackageForm,
  WorkPackageFormField,
  WorkPackageCreateForm,
  WorkPackageCreateDefaults,
  AllowedValue,
  Formattable,
  WorkPackageFormInput,
  WorkPackageCreateFormInput,
  AvailableAssigneesInput,
  UpdateWorkPackageInput,
  CreateWorkPackageInput,
  Principal,
  PrincipalCollection,
  Project,
  ProjectCollection,
  TimeEntry,
  TimeEntryCollection,
  TimeEntryLinks,
  TimeEntryActivity,
  TimeEntryActivityCollection,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  DeleteTimeEntryInput,
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
  OpenProjectTimeoutError,
  OpenProjectConflictError
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

/**
 * Input for `openWorkPackageInBrowser`.
 *
 * A numeric id and nothing else — deliberately not a URL, an href, or a path.
 * The main process builds the URL itself from the stored base URL, so the
 * renderer has no way to influence what is handed to the operating system.
 * See `src/main/ipc/shell.ts`.
 */
export interface OpenWorkPackageInBrowserInput {
  workPackageId: number
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
   * Create a time entry.
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
   * Update an existing time entry, returning the entry as OpenProject echoes
   * it back.
   *
   * Same trust model as `createTimeEntry` — plain numeric ids only, validated
   * in the main process (`UpdateTimeEntryInputSchema`), with every href built
   * there. The entry `id` is the one value that reaches the request path and
   * is validated as a positive integer first.
   *
   * **Full replacement, not a partial patch**: every field is sent, so an
   * omitted `comment` clears the stored one. Rejects with `{ code, message }`
   * as `createTimeEntry` does, plus `OPENPROJECT_NOT_FOUND` when the entry is
   * gone or not visible to the configured key.
   */
  updateTimeEntry(input: UpdateTimeEntryInput): Promise<TimeEntry>

  /**
   * Delete a time entry. Resolves on success — OpenProject answers 204 with
   * an empty body, so there is nothing to return. Irreversible; there is no
   * server-side undo.
   *
   * Rejects with `{ code, message }`: `OPENPROJECT_INVALID_INPUT` for a
   * non-positive-integer id (rejected before any request is made),
   * `OPENPROJECT_NOT_FOUND` when the entry is already gone or not visible.
   */
  deleteTimeEntry(input: DeleteTimeEntryInput): Promise<void>

  /**
   * Fetch the activities that may be assigned to a time entry — required
   * on every entry, so the form's Activity select is populated from here.
   * Pass `workPackageId` to scope the list to that work package's project.
   * Throws `{ code, message }` on auth / network / schema errors.
   */
  listTimeEntryActivities(
    input?: ListTimeEntryActivitiesInput
  ): Promise<TimeEntryActivityCollection>

  /**
   * Open a work package in the user's default browser. Resolves once the OS
   * has accepted the request — there is nothing to return.
   *
   * The only value crossing IPC is the numeric `workPackageId`. The main
   * process Zod-validates it as a positive integer and builds
   * `<baseUrl>/work_packages/<id>` from the **stored** base URL; it never
   * builds the URL from a server-supplied `_links.self.href`, and it
   * re-asserts http(s) before handing anything to the OS. The API key is not
   * involved and never appears in the opened URL.
   *
   * Rejects with `{ code, message }`: `SHELL_INVALID_INPUT` for anything that
   * isn't a positive integer id (rejected before credentials are even read),
   * `CREDENTIAL_NOT_CONFIGURED` when no usable OpenProject URL is stored,
   * `SHELL_UNSAFE_TARGET` if the resolved URL is not http(s), and
   * `SHELL_OPEN_FAILED` when the OS refuses to open it (no handler
   * registered for the scheme). See `.opencode/rules/security.md`.
   */
  openWorkPackageInBrowser(
    input: OpenWorkPackageInBrowserInput
  ): Promise<void>

  /**
   * Read the editable schema of one work package: which fields may be written,
   * and — for status, type and priority — which values that work package's
   * workflow actually allows. This is the only source that honours "only legal
   * transitions"; the global `listStatuses()` cannot know which are reachable
   * from where the work package currently is.
   *
   * A POST that reads. OpenProject's form endpoint validates a hypothetical
   * payload and answers with the resulting schema without persisting anything.
   * The body is built in the **main process** and holds exactly the validated
   * `lockVersion` — nothing supplied here is ever forwarded, so this channel
   * cannot be used as a write. `lockVersion` is required, not decorative: the
   * endpoint answers HTTP 409 without one.
   *
   * The response is flattened out of HAL before it crosses IPC: each field
   * arrives as `{ writable, allowedValues: { id, name }[] }`, so the renderer
   * never handles an href or an `_embedded` block.
   *
   * Rejects with `{ code, message }`: `OPENPROJECT_INVALID_INPUT` for a bad id
   * or lock version (before any request), `OPENPROJECT_CONFLICT` when the lock
   * version is already stale, `OPENPROJECT_NOT_FOUND` when the work package is
   * gone or invisible to the configured key.
   */
  getWorkPackageForm(input: WorkPackageFormInput): Promise<WorkPackageForm>

  /**
   * The principals a work package may be assigned to — its **project's**
   * assignable members.
   *
   * Takes a `projectId`, not a work package id: the work-package-scoped
   * `available_assignees` route does not exist (HTTP 404), and the form's
   * `assignee` allowed-values href points at the project collection instead.
   * The caller reads the project id off the work package it already holds and
   * sends the number; the main process rebuilds the path, so a server-supplied
   * href never steers the request.
   *
   * Elements may be `User`, `Group` or `PlaceholderUser` depending on the
   * instance. Rejects with `{ code, message }`: `OPENPROJECT_INVALID_INPUT`
   * for a non-positive-integer id, `OPENPROJECT_NOT_FOUND` when the project is
   * gone or invisible.
   */
  listAvailableAssignees(
    input: AvailableAssigneesInput
  ): Promise<PrincipalCollection>

  /**
   * The user the stored API key authenticates as (`GET /api/v3/users/me`).
   *
   * Takes no input, deliberately: the identity is the key's, so there is
   * nothing for the renderer to name and nothing that could steer the request.
   * The create form uses the returned `id` to default the assignee — matched
   * against `listAvailableAssignees` first, so a user who cannot be assigned in
   * the chosen project simply isn't defaulted.
   *
   * Returns a `Principal`, the same shape the assignee list holds. Rejects with
   * `{ code, message }` on auth / network / schema errors.
   */
  getCurrentUser(): Promise<Principal>

  /**
   * Update a work package, returning it as OpenProject echoes it back.
   *
   * **A partial update, not a replacement** — the opposite of
   * `updateTimeEntry`. Send only what changed: a field left out is untouched on
   * the server, while `null` on a date or on `assigneeId` explicitly *clears*
   * it. Those two are not interchangeable; passing every field would rewrite
   * data the user never edited.
   *
   * `lockVersion` makes the write conditional. It must be the value from the
   * work package as loaded; a save must therefore re-read it from the response
   * of the previous save, or the next one conflicts against itself.
   *
   * Same trust model as `createTimeEntry`: plain numeric ids only, all
   * validated in the main process (`UpdateWorkPackageInputSchema`), with every
   * `_links` href built there. `subject` is length-bounded and dates must be
   * real `YYYY-MM-DD` days before any request is made.
   *
   * Rejects with `{ code, message }`: `OPENPROJECT_INVALID_INPUT` (bad input,
   * no request made), **`OPENPROJECT_CONFLICT`** when someone else changed the
   * work package first — refetch and discard rather than retrying —
   * `OPENPROJECT_VALIDATION_FAILED` carrying OpenProject's own message when it
   * refuses the change (an illegal transition, a required custom field), and
   * `OPENPROJECT_NOT_FOUND` when the work package is gone.
   */
  updateWorkPackage(input: UpdateWorkPackageInput): Promise<WorkPackage>

  /**
   * The projects a work package may be **created** in.
   *
   * Reads `GET /api/v3/work_packages/available_projects`, not
   * `GET /api/v3/projects`: the latter lists what the API key can see, which
   * includes projects it cannot create in, and offering one produces a create
   * that fails only after the form is filled in. An empty collection is a real
   * answer — this key may create nowhere — not an error.
   *
   * Rejects with `{ code, message }` on auth / network / schema errors.
   */
  listProjects(): Promise<ProjectCollection>

  /**
   * The schema for a *new* work package in one project: which fields are
   * writable, which values type/status/priority allow there, and which ones
   * OpenProject would pick by default.
   *
   * Project-scoped, which is the shape of the whole create flow — until a
   * project is chosen there are no legal types, statuses or assignees, and
   * changing it invalidates all three.
   *
   * A POST that reads, like `getWorkPackageForm`, but it takes **no lock
   * version**: nothing exists yet to be stale against, so an empty payload is
   * accepted. Only `typeId` ever reaches the body, as one href the main process
   * rebuilds from the validated integer — nothing supplied here is forwarded,
   * so this channel cannot be used as a write. `typeId` is optional and matters
   * only on instances whose status workflows differ per type.
   *
   * `defaults` carries OpenProject's own initial `{ typeId, statusId,
   * priorityId }`, each `null` when the form offered none. Allowed values arrive
   * flattened to `{ id, name }[]` — no href, no `_embedded` block.
   *
   * Rejects with `{ code, message }`: `OPENPROJECT_INVALID_INPUT` for a bad
   * project or type id (before any request), `OPENPROJECT_NOT_FOUND` when the
   * project is gone or invisible to the configured key.
   */
  getWorkPackageCreateForm(
    input: WorkPackageCreateFormInput
  ): Promise<WorkPackageCreateForm>

  /**
   * Create a work package, returning it as OpenProject echoes it back.
   *
   * `projectId`, `typeId` and `subject` are required; everything else is
   * optional and simply not sent when absent, so OpenProject applies its own
   * default. Unlike `updateWorkPackage`, `null` is not accepted anywhere: there
   * is no stored value to clear on something that does not exist yet, and a
   * nullable field would be a second spelling of "absent".
   *
   * Same trust model as the rest of the write surface: plain numeric ids only,
   * all Zod-validated in the main process (`CreateWorkPackageInputSchema`), with
   * every `_links` href built there. `subject` and `description` are
   * length-bounded before any request, and the description's `format` is
   * **pinned in the main process** — a live instance accepted a client-chosen
   * format without complaint, so nothing downstream polices it.
   *
   * Rejects with `{ code, message }`: `OPENPROJECT_INVALID_INPUT` (bad input, no
   * request made), `OPENPROJECT_VALIDATION_FAILED` carrying OpenProject's own
   * message when it refuses the work package (a required custom field, a type
   * the project no longer allows) — the caller keeps the draft and shows it —
   * and `OPENPROJECT_NOT_FOUND` when the project is gone.
   */
  createWorkPackage(input: CreateWorkPackageInput): Promise<WorkPackage>
}

declare global {
  interface Window {
    openproject: OpenProjectBridge
  }
}

export {}