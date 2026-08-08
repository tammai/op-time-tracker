import { contextBridge, ipcRenderer } from 'electron'
import type {
  OpenProjectBridge,
  SaveCredentialsInput,
  TestConnectionInput,
  ListWorkPackagesInput,
  ListTimeEntriesInput,
  ListTimeEntryActivitiesInput,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  DeleteTimeEntryInput,
  OpenWorkPackageInBrowserInput,
  WorkPackageFormInput,
  WorkPackageCreateFormInput,
  AvailableAssigneesInput,
  UpdateWorkPackageInput,
  CreateWorkPackageInput
} from './types'

const bridge: OpenProjectBridge = {
  // Scaffold-only placeholder. Confirms the preload bridge is wired.
  ping: () => ipcRenderer.invoke('op:ping'),

  // Credential surface (task 3). The renderer learns *whether* credentials
  // are configured and can save/clear them — it never receives the API key
  // or the credentials object. See `.opencode/rules/security.md`.
  hasCredentials: () => ipcRenderer.invoke('op:credentials:has'),
  // Non-secret read-back for the settings form: base URL + a hasApiKey flag.
  getConnectionInfo: () =>
    ipcRenderer.invoke('op:credentials:get-connection-info'),
  saveCredentials: (input: SaveCredentialsInput) =>
    ipcRenderer.invoke('op:credentials:save', input),
  clearCredentials: () => ipcRenderer.invoke('op:credentials:clear'),

  // Test-connection probe (task 4). Passes the unsaved form values to the
  // main process for a one-shot auth probe. The key is user-entered, used
  // once in the main process, never logged, never persisted.
  testConnection: (input: TestConnectionInput) =>
    ipcRenderer.invoke('op:openproject:test-connection', input),

  // OpenProject read surface (task 5). All HTTP + Zod validation happens
  // in the main process; these return only the validated collections.
  // See `.opencode/rules/architecture.md` (IPC contract).
  listWorkPackages: (input?: ListWorkPackagesInput) =>
    ipcRenderer.invoke('op:openproject:list-work-packages', input),
  listTimeEntries: (input?: ListTimeEntriesInput) =>
    ipcRenderer.invoke('op:openproject:list-time-entries', input),
  listStatuses: () => ipcRenderer.invoke('op:openproject:list-statuses'),

  // The write surface. Numeric ids only — the main process validates them
  // and builds every href itself, so nothing from the renderer reaches a
  // request path. See `.opencode/rules/security.md`.
  createTimeEntry: (input: CreateTimeEntryInput) =>
    ipcRenderer.invoke('op:openproject:create-time-entry', input),
  updateTimeEntry: (input: UpdateTimeEntryInput) =>
    ipcRenderer.invoke('op:openproject:update-time-entry', input),
  deleteTimeEntry: (input: DeleteTimeEntryInput) =>
    ipcRenderer.invoke('op:openproject:delete-time-entry', input),
  listTimeEntryActivities: (input?: ListTimeEntryActivitiesInput) =>
    ipcRenderer.invoke('op:openproject:list-time-entry-activities', input),

  // Work package editing (stage 2). `getWorkPackageForm` is a POST that reads:
  // its body is built in the main process from the validated lock version and
  // carries nothing from here. `updateWorkPackage` is a *partial* update — an
  // omitted field is left alone, `null` clears.
  getWorkPackageForm: (input: WorkPackageFormInput) =>
    ipcRenderer.invoke('op:openproject:get-work-package-form', input),
  listAvailableAssignees: (input: AvailableAssigneesInput) =>
    ipcRenderer.invoke('op:openproject:list-available-assignees', input),
  getCurrentUser: () => ipcRenderer.invoke('op:openproject:get-current-user'),
  updateWorkPackage: (input: UpdateWorkPackageInput) =>
    ipcRenderer.invoke('op:openproject:update-work-package', input),

  // Work package creation (stage 3). `listProjects` reads the *available*
  // projects — the ones this key may actually create in.
  // `getWorkPackageCreateForm` is a POST that reads, taking no lock version;
  // only a validated type id ever reaches its body. `createWorkPackage` sends
  // numeric ids, and the description's format is pinned in the main process.
  listProjects: () => ipcRenderer.invoke('op:openproject:list-projects'),
  getWorkPackageCreateForm: (input: WorkPackageCreateFormInput) =>
    ipcRenderer.invoke('op:openproject:get-work-package-create-form', input),
  createWorkPackage: (input: CreateWorkPackageInput) =>
    ipcRenderer.invoke('op:openproject:create-work-package', input),

  // The one channel that hands a URL to the operating system. It takes a
  // numeric id, never a URL — the main process builds the target itself from
  // the stored base URL and re-asserts http(s) before opening it. See
  // `src/main/ipc/shell.ts` and `.opencode/rules/security.md`.
  openWorkPackageInBrowser: (input: OpenWorkPackageInBrowserInput) =>
    ipcRenderer.invoke('op:shell:open-work-package', input)
}

// Expose only the narrowly-typed bridge — never the API key, never a generic
// fetch, never Node APIs. See `.opencode/rules/security.md`.
contextBridge.exposeInMainWorld('openproject', bridge)

export type {
  OpenProjectBridge,
  ConnectionInfo,
  SaveCredentialsInput,
  TestConnectionInput,
  TestConnectionResult,
  ListWorkPackagesInput,
  ListTimeEntriesInput,
  ListTimeEntryActivitiesInput,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  DeleteTimeEntryInput,
  OpenWorkPackageInBrowserInput,
  WorkPackageFormInput,
  WorkPackageCreateFormInput,
  AvailableAssigneesInput,
  UpdateWorkPackageInput,
  CreateWorkPackageInput,
  WorkPackage,
  WorkPackageCollection,
  WorkPackageLinks,
  WorkPackageForm,
  WorkPackageFormField,
  WorkPackageCreateForm,
  WorkPackageCreateDefaults,
  AllowedValue,
  Formattable,
  Principal,
  PrincipalCollection,
  Project,
  ProjectCollection,
  TimeEntry,
  TimeEntryCollection,
  TimeEntryLinks,
  TimeEntryActivity,
  TimeEntryActivityCollection,
  Status,
  StatusCollection,
  WorkPackageFilters,
  TimeEntryFilters,
  parseHoursToDecimal
} from './types'