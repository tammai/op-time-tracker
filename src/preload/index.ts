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
  DeleteTimeEntryInput
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
    ipcRenderer.invoke('op:openproject:list-time-entry-activities', input)
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
  WorkPackage,
  WorkPackageCollection,
  WorkPackageLinks,
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