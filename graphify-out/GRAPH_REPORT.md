# Graph Report - op-time-tracker  (2026-08-08)

## Corpus Check
- 150 files · ~156,288 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1141 nodes · 1738 edges · 113 communities (65 shown, 48 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `af901898`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Work Package Picker
- App Shell & Calendar Header
- Test Connection & WP Fields
- Day Entries Modal
- Time Entry & Calendar Aggregation
- Work Package Detail Panel
- OpenProject HTTP Client
- Root tsconfig
- Test tsconfig
- IPC Handlers & Bridge Types
- Package Manifest
- Web tsconfig
- IPC Handler Wrappers
- Time Entry Form
- Governance & CI Rules
- Node tsconfig
- Main Entry & Credentials
- Bigin Guards Plugin
- OpenProject Error Classes
- Preload Bridge Surface
- Icon Builder Tool
- IPC Contract Knowledge
- Status & WP Create
- Time Entry Schemas
- IPC Integration Tests
- WP Creator Composable Tests
- Principal Schemas
- Spec Gate Guard
- Client Unit Tests
- Context Budget Tool
- DevDependencies
- Precompact Snapshot Guard
- Knowledge Validate Tool
- Architecture Rules (Mirrored)
- Bugfix Test Guard
- Calendar Dates Utility
- Hard Security Rules
- Injection Scan Guard
- Status Schemas & Tests
- Bash Guard
- Commit Message Guard
- Injection Gate Guard
- Project Schemas & Tests
- Project Queries
- WP Label Formatter
- Session Resume Check
- Calendar Screenshot
- Repo Onboarding Docs
- Graphify Usage Docs
- Typecheck Drift Gates
- Canary Seed
- Electron Vite Config
- WP Create & XSS Knowledge
- Graphify Plugin
- Disconnect Composable
- Day Total Utility
- Entry Hours Utility
- electron-builder dep
- electron-vite dep
- eslint dep
- @eslint/js dep
- eslint-plugin-vue dep
- globals dep
- @iconify-json/lucide dep
- @internationalized/date dep
- @nuxt/ui dep
- pinia dep
- @pinia/colada dep
- tailwindcss dep
- @tiptap/core dep
- @tiptap/extension-placeholder dep
- @tiptap/markdown dep
- @tiptap/pm dep
- @tiptap/starter-kit dep
- @tiptap/vue-3 dep
- @types/node dep
- @typescript-eslint/eslint-plugin dep
- @typescript-eslint/parser dep
- vitest dep
- vue dep
- vue-eslint-parser dep
- vue-tsc dep
- @vue/tsconfig dep
- commit-msg hook script
- pre-commit hook script
- vitest config
- Renderer Layer Concept
- Nuxt UI Vue Library Concept
- Base URL Validation Concept
- Windows Packaging Config
- Shell Surface Concept
- WP Search Strategy Concept
- Month Calendar UI Concept
- Renderer HTML Entry
- Knowledge Bundle Spec
- Packaging for Distribution
- Architecture Rules
- time-entries.ts
- Knowledge Bundle Rules
- Testing Conventions
- AI Task Guide
- TimeEntryActivityCollection
- graph.md
- security.md
- Current State
- CalendarView.vue
- SettingsModal.vue
- CalendarHeader.vue
- OnboardingView.vue

## God Nodes (most connected - your core abstractions)
1. `OpenProjectBridge` - 24 edges
2. `OpenProjectClient` - 23 edges
3. `registerOpenProjectIpcHandlers()` - 20 edges
4. `buildRequestUrl()` - 20 edges
5. `WorkPackage` - 19 edges
6. `compilerOptions` - 17 edges
7. `OpenProjectError` - 14 edges
8. `TimeEntry` - 14 edges
9. `scripts` - 12 edges
10. `parseHoursToDecimal()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `CI quality job (lint/build/typecheck/test/knowledge validate)` --conceptually_related_to--> `Renderer hardening (contextIsolation/nodeIntegration/sandbox)`  [AMBIGUOUS]
  .github/workflows/ci.yml → .opencode/rules/security.md
- `CI quality job (lint/build/typecheck/test/knowledge validate)` --references--> `knowledge/ domain knowledge bundle`  [INFERRED]
  .github/workflows/ci.yml → .opencode/rules/knowledge.md
- `Request Flow Pipeline (component → queries → bridge → IPC → client → fetch+Zod)` --implements--> `src/preload/types.ts as IPC Source of Truth (Zod schemas back the types, additive-first)`  [INFERRED]
  CLAUDE.md → knowledge/contracts/ipc-contract.md
- `useWorkPackagesBrowser()` --indirect_call--> `cancelDelete()`  [INFERRED]
  src/renderer/src/composables/useWorkPackagesBrowser.ts → src/renderer/src/components/DayEntriesModal.vue
- `mountPicker()` --calls--> `useWorkPackagePicker()`  [EXTRACTED]
  tests/renderer/composables/useWorkPackagePicker.test.ts → src/renderer/src/composables/useWorkPackagePicker.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **IPC request flow: IPC handler → getCredentials → HTTP client → Zod schema → renderer** — _opencode_rules_conventions_server_ipcboundary, _opencode_rules_conventions_server_getcredentials, _opencode_rules_conventions_server_httpclient, _opencode_rules_conventions_server_zodschemas, _opencode_rules_architecture_ipccontract [EXTRACTED 1.00]
- **API key security chain: safeStorage/electron-store → getCredentials → IPC handler → never crosses to renderer** — _opencode_rules_security_safestorage, _opencode_rules_security_electronstorefallback, _opencode_rules_conventions_server_getcredentials, _opencode_rules_architecture_securityboundary, _opencode_rules_security_rendererhardening [EXTRACTED 1.00]
- **Electron-mock test harness: vitest.config deps.inline + electron-mock.ts + vi.hoisted require** — _opencode_rules_testing_vitestconfig, _opencode_rules_testing_electronmock, _opencode_rules_security_safestorage [EXTRACTED 1.00]
- **IPC Request Flow Pipeline (renderer → preload bridge → main IPC handler → OpenProjectClient → Zod parse)** — claude_request_flow, knowledge_contracts_ipc-contract_preload_types_source, knowledge_domains_openproject-response-shapes_null_href_links [INFERRED 0.85]
- **Security Boundary Rule Trio (same API-key/Zod/contextIsolation rules across three governance files)** — agents_hard_rules, ai_review_checklist_security, knowledge_constraints_agent-rules_api_key_security [INFERRED 0.85]
- **Packaging & Distribution Pipeline (electron-builder config + playbook rationale + README procedure)** — electron-builder_mac_config, electron-builder_win_config, knowledge_playbooks_packaging-distribution_unsigned_deliberately, readme_release_procedure [INFERRED 0.85]
- **Calendar Month View Components** — docs_images_calendar_month_view_pn_calendar_month_view_screenshot, docs_images_calendar_month_view_pn_month_grid_layout, docs_images_calendar_month_view_pn_day_cell, docs_images_calendar_month_view_pn_time_entry_display [INFERRED 0.75]

## Communities (113 total, 48 thin omitted)

### Community 0 - "Work Package Picker"
Cohesion: 0.07
Nodes (38): WorkPackage, toItem(), useWorkPackagePicker(), UseWorkPackagePickerOptions, WorkPackage, WorkPackageItem, PENDING_ACTION_PROMPTS, PendingAction (+30 more)

### Community 1 - "App Shell & Calendar Header"
Cohesion: 0.09
Nodes (14): fabVisible, Gate, ui, created, creator, drawerOpen, isDiscardOpen, open (+6 more)

### Community 2 - "Test Connection & WP Fields"
Cohesion: 0.04
Nodes (37): emit, props, statusClass, statusMessage, WorkPackageCreator, description, emit, props (+29 more)

### Community 3 - "Day Entries Modal"
Cohesion: 0.05
Nodes (41): askDelete(), cancelDateChange(), cancelDelete(), canMove(), changingDateId, confirmDateChange(), confirmDelete(), confirmingDeleteId (+33 more)

### Community 4 - "Time Entry & Calendar Aggregation"
Cohesion: 0.14
Nodes (10): CreateTimeEntryInput, TimeEntry, UpdateTimeEntryInput, TimeEntryListQuery, timeEntryQueries, useMonthTimeEntries, aggregateTimeEntriesByDay(), DayAggregate (+2 more)

### Community 5 - "Work Package Detail Panel"
Cohesion: 0.07
Nodes (47): canChangeDate(), timeEntryCommentText(), TimeEntryDraft, timeEntryHours(), timeEntryWorkPackageNumber(), toDateChangeInput(), toTimeEntryDraft(), formatSpentHours() (+39 more)

### Community 6 - "OpenProject HTTP Client"
Cohesion: 0.08
Nodes (36): AllowedValue, AllowedValueSchema, AvailableAssigneesInputSchema, buildWorkPackageCreatePayload(), buildWorkPackagePatchPayload(), CalendarDateSchema, CreateWorkPackageInputSchema, descriptionPayload() (+28 more)

### Community 7 - "Root tsconfig"
Cohesion: 0.05
Nodes (36): compilerOptions, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module (+28 more)

### Community 8 - "Test tsconfig"
Cohesion: 0.06
Nodes (35): src/main/**/*.ts, src/preload/**/*.ts, src/renderer/src/composables/**/*.ts, src/renderer/src/utils/**/*.ts, src/shared/**/*.ts, tests/fixtures/**, tests/support/**/*.ts, tests/**/*.test.ts (+27 more)

### Community 9 - "IPC Handlers & Bridge Types"
Cohesion: 0.15
Nodes (19): TimeEntryFilters, WorkPackageFilters, DeleteTimeEntryInput, TimeEntryActivity, TimeEntryLinks, AvailableAssigneesInput, CreateWorkPackageInput, UpdateWorkPackageInput (+11 more)

### Community 10 - "Package Manifest"
Cohesion: 0.06
Nodes (32): electron-store, author, email, name, dependencies, electron-store, zod, description (+24 more)

### Community 11 - "Web tsconfig"
Cohesion: 0.07
Nodes (29): auto-imports.d.ts, components.d.ts, src/preload/types.ts, src/renderer/**/*.vue, @vue/tsconfig/tsconfig.dom.json, compilerOptions, baseUrl, composite (+21 more)

### Community 12 - "IPC Handler Wrappers"
Cohesion: 0.13
Nodes (16): registerOpenProjectIpcHandlers(), requireCredentials(), buildRequestUrl(), buildTimeEntryPayload(), clampPageSize(), encodeTimeEntryFilters(), encodeTimeEntryParams(), encodeWorkPackageParams() (+8 more)

### Community 13 - "Time Entry Form"
Cohesion: 0.08
Nodes (24): activitiesLoading, activityItems, {
  data: activitiesData,
  status: activitiesStatus,
  error: activitiesError,
  refresh: refreshActivities
}, emit, formSchema, FormState, hasNoActivities, hasNoActivityOptions (+16 more)

### Community 14 - "Governance & CI Rules"
Cohesion: 0.09
Nodes (24): safeStorage (.claude mirror), electron-mock (.claude mirror), knowledge validate step (tools/knowledge_validate.mjs), CI quality job (lint/build/typecheck/test/knowledge validate), electron-builder packaging (per-platform, --publish never), SHA256SUMS checksum integrity handle, Dependency Direction: IPC handlers → client → schemas → credentials, Electron Main Layer (desktop app backend) (+16 more)

### Community 15 - "Node tsconfig"
Cohesion: 0.09
Nodes (23): electron.vite.config.ts, vitest.config.ts, compilerOptions, baseUrl, composite, lib, paths, tsBuildInfoFile (+15 more)

### Community 16 - "Main Entry & Credentials"
Cohesion: 0.07
Nodes (27): electron, registerCredentialIpcHandlers(), toIpcError(), IpcError, toIpcError(), buildWorkPackageWebUrl(), OpenWorkPackageInputSchema, registerShellIpcHandlers() (+19 more)

### Community 17 - "Bigin Guards Plugin"
Cohesion: 0.17
Nodes (19): BASH_BLOCKED, BiginGuardsPlugin(), branchVerdict(), checkBash(), checkCommitMessage(), checkSessionResume(), currentBranch(), editChangeSize() (+11 more)

### Community 18 - "OpenProject Error Classes"
Cohesion: 0.10
Nodes (10): OpenProjectAuthError, OpenProjectConflictError, OpenProjectError, OpenProjectHttpError, OpenProjectInvalidInputError, OpenProjectNotFoundError, OpenProjectSchemaError, OpenProjectServerError (+2 more)

### Community 19 - "Preload Bridge Surface"
Cohesion: 0.13
Nodes (3): StatusCollection, WorkPackageCollection, OpenProjectBridge

### Community 20 - "Icon Builder Tool"
Cohesion: 0.13
Nodes (17): BOTTOM, BUILD_DIR, chunk(), crc32(), CRC_TABLE, encodePng(), FACE, ICO_SIZES (+9 more)

### Community 21 - "IPC Contract Knowledge"
Cohesion: 0.14
Nodes (18): Contract Checklist (IPC types.ts sync, Zod schema first, breaking IPC changes coordinated), Request Flow Pipeline (component → queries → bridge → IPC → client → fetch+Zod), macOS Packaging Config (universal DMG+zip, unsigned, identity null), IPC Handler Constraint (read ipc-contract.md first, additive changes preferred), src/preload/types.ts as IPC Source of Truth (Zod schemas back the types, additive-first), Work-Package Edit Surface (getWorkPackageForm, listAvailableAssignees, updateWorkPackage — partial PATCH, lockVersion, 409 conflict), Time Entry Write Surface (createTimeEntry, updateTimeEntry, deleteTimeEntry, numeric ids only), Assignees as Project Resource (GET /work_packages/{id}/available_assignees is 404, list is project-scoped) (+10 more)

### Community 22 - "Status & WP Create"
Cohesion: 0.12
Nodes (12): Status, WorkPackageCreateForm, WorkPackageCreateFormInput, OpenWorkPackageInBrowserInput, StatusListQuery, statusQueries, useStatusResolution(), SEARCH_SORT (+4 more)

### Community 23 - "Time Entry Schemas"
Cohesion: 0.18
Nodes (10): Citations, Credential read-back, Drift gate, Identity, IPC Contract, Read vs write surface, Rules, Shell surface (+2 more)

### Community 24 - "IPC Integration Tests"
Cohesion: 0.08
Nodes (8): HalLinkSchema, ProjectCollectionSchema, ProjectSchema, StatusCollectionSchema, StatusSchema, electron, fixture, StatusFixture

### Community 25 - "WP Creator Composable Tests"
Cohesion: 0.19
Nodes (11): useWorkPackageCreator(), ASSIGNEES_12, ASSIGNEES_7, creatorInProject7(), flush(), FORM_12, FORM_7, mountCreator() (+3 more)

### Community 26 - "Principal Schemas"
Cohesion: 0.20
Nodes (9): Components, Formatting, Frontend Conventions (Renderer), Naming, Nuxt UI v4 (as a Vue library, not Nuxt), Preload bridge, Renderer tree layout, Server State: Pinia Colada (+1 more)

### Community 27 - "Spec Gate Guard"
Cohesion: 0.24
Nodes (8): branchVerdict(), changeSize(), currentBranch(), data, lineCount(), planVerdict(), TRIVIAL_PATTERNS, verdict

### Community 28 - "Client Unit Tests"
Cohesion: 0.22
Nodes (8): Auth (main process), HTTP client, IPC Boundary (replaces the Nuxt BFF proxy), IPC errors, Main Process Conventions, Naming, Preload build format, Zod Schemas

### Community 29 - "Context Budget Tool"
Cohesion: 0.22
Nodes (7): BRIEFS, errors, est, meterSkill(), readDescription(), RULE_DIRS, seen

### Community 30 - "DevDependencies"
Cohesion: 0.22
Nodes (9): electron, devDependencies, electron, typescript, vite, @vitejs/plugin-vue, typescript, vite (+1 more)

### Community 31 - "Precompact Snapshot Guard"
Cohesion: 0.50
Nodes (7): freshSessionMd(), gatherState(), git(), main(), readStdinPayload(), renderUncommittedSection(), updateExisting()

### Community 32 - "Knowledge Validate Tool"
Cohesion: 0.46
Nodes (7): ALLOWED_TYPES, bundleRelativeLinks(), iso8601(), loadBundle(), main(), parseFrontmatter(), stripQuotes()

### Community 33 - "Architecture Rules (Mirrored)"
Cohesion: 0.29
Nodes (7): IPC Contract (.claude mirror), IPC Contract (window.openproject.*), Electron Preload Layer (contextBridge surface), Pinia Colada server-state (useQuery/useMutation), Plugin install order: Pinia → PiniaColada → Nuxt UI, Preload bridge (contextBridge.exposeInMainWorld), Preload CJS build requirement (index.cjs)

### Community 34 - "Bugfix Test Guard"
Cohesion: 0.29
Nodes (5): data, files, scrubbed, TEST_PATTERNS, TRIVIAL_PATTERNS

### Community 35 - "Calendar Dates Utility"
Cohesion: 0.57
Nodes (5): CALENDAR_FIRST_DAY_OF_WEEK, CalendarCell, formatYmd(), getCalendarGridDays(), getMonthRange()

### Community 36 - "Hard Security Rules"
Cohesion: 0.40
Nodes (6): Non-Negotiable Hard Rules (security, contextIsolation, Zod validation), Security Checklist (API key isolation, contextIsolation, Zod validation, no PII logging), PLAN.md Spec Gate (blocks edits until spec approved, dual harness enforcement), API Key Security Rule (never expose to renderer, safeStorage + electron-store fallback), Spec-Before-Code Rule (non-trivial features need approved spec with security considerations), Zod Validation Before IPC (every OpenProject response .parse()d in main process)

### Community 37 - "Injection Scan Guard"
Cohesion: 0.33
Nodes (3): INJECTION_PATTERNS, ZERO_WIDTH_CODEPOINTS, ZERO_WIDTH_RE

### Community 38 - "Status Schemas & Tests"
Cohesion: 0.25
Nodes (7): Agent Rules, Before touching IPC handlers / `window.openproject.*`, Citations, Never expose the API key to the renderer, Never let raw OpenProject server shapes reach the renderer, Security-sensitive code, Spec-before-code

### Community 39 - "Bash Guard"
Cohesion: 0.40
Nodes (3): BLOCKED, data, scrubbed

### Community 41 - "Injection Gate Guard"
Cohesion: 0.40
Nodes (3): canaryPath, data, flagPath

### Community 42 - "Project Schemas & Tests"
Cohesion: 0.25
Nodes (7): Citations, Creating a work package, Diagnosing the next one, OpenProject Response Shapes, Searching by title: local first, then `subjectOrId **`, The work-package form endpoint, Variations seen on real instances

### Community 43 - "Project Queries"
Cohesion: 0.40
Nodes (3): Project, ProjectCollection, projectQueries

### Community 44 - "WP Label Formatter"
Cohesion: 0.70
Nodes (3): formatWorkPackageLabel(), KnownWorkPackageSubject, workPackageSelectionLabel()

### Community 45 - "Session Resume Check"
Cohesion: 0.50
Nodes (3): graphPath, lines, sessionPath

### Community 46 - "Calendar Screenshot"
Cohesion: 0.50
Nodes (4): Calendar Month View Screenshot, Day Cell, Month Grid Layout, Time Entry Display in Calendar

### Community 47 - "Repo Onboarding Docs"
Cohesion: 0.67
Nodes (3): Electron Three-Tree Architecture (renderer/main/preload), Repository Tree Layout (src/main, src/preload, src/renderer, src/shared), AI Onboarding (dual harness, symlinked rules, git hook install)

### Community 48 - "Graphify Usage Docs"
Cohesion: 0.67
Nodes (3): Graphify Usage Rules (query/path/explain, update after code changes), Graphify Confidence Tags (EXTRACTED, INFERRED, AMBIGUOUS), Graphify CLI Tool (local tree-sitter knowledge graph, update/query/path/explain)

### Community 49 - "Typecheck Drift Gates"
Cohesion: 0.67
Nodes (3): Review Gates (pnpm lint, type-check, test --run), Three Typecheck Projects (tsconfig.node, tsconfig.web, tsconfig.test), Drift Gate (three typecheck projects catch renderer contract drift, never fold into tsconfig.json)

### Community 52 - "WP Create & XSS Knowledge"
Cohesion: 0.67
Nodes (3): Work-Package Create Surface (listProjects, getWorkPackageCreateForm, createWorkPackage — no lockVersion, null not accepted), Creating a Work Package (available_projects not /api/v3/projects, no lockVersion, embedded defaults, type-disallows-200 trap), Description Format XSS Vulnerability (server accepts format: custom with script html, format pinned in main process)

### Community 98 - "Knowledge Bundle Spec"
Cohesion: 0.25
Nodes (7): Frontmatter schema, Knowledge Bundle Spec, Linking & citations, Purpose, Staleness policy, Structure, Validation

### Community 99 - "Packaging for Distribution"
Cohesion: 0.25
Nodes (7): Not configured, Packaging for Distribution, pnpm symlinks, The dependency-classification trap, Unsigned, deliberately, Why releases run in CI, Windows specifics

### Community 100 - "Architecture Rules"
Cohesion: 0.29
Nodes (6): Architecture Rules, Dependency Direction, Domain Boundaries, Electron Layers & Boundaries, [Electron] Security Boundary (replaces the Nuxt BFF Boundary), IPC Contract (replaces the Nuxt BFF contract)

### Community 101 - "time-entries.ts"
Cohesion: 0.27
Nodes (6): HalLinkSchema, Principal, PrincipalCollection, PrincipalCollectionSchema, PrincipalSchema, principalQueries

### Community 102 - "Knowledge Bundle Rules"
Cohesion: 0.33
Nodes (5): Before non-trivial changes, Knowledge Bundle Rules, Link, don't copy, Staleness, Writing or updating a concept file

### Community 103 - "Testing Conventions"
Cohesion: 0.33
Nodes (5): Electron auto-imports, Imports, In-process vs IPC, Location, Testing Conventions

### Community 104 - "AI Task Guide"
Cohesion: 0.40
Nodes (4): AI Task Guide, Scope discipline, What it does, so you know what you're approving, Why `PLAN.md` matters to you

### Community 105 - "TimeEntryActivityCollection"
Cohesion: 0.15
Nodes (19): OpenProjectFilter, CreateTimeEntryInputSchema, DeleteTimeEntryInputSchema, extractActivitiesFromForm(), HalLinkSchema, TimeEntryActivityCollection, TimeEntryActivityCollectionSchema, TimeEntryActivitySchema (+11 more)

### Community 108 - "Current State"
Cohesion: 0.22
Nodes (8): Context Notes, Current State, Decisions Made, Next Steps, Session Handoff, Tasks, Uncommitted Changes, What We Were Working On

### Community 109 - "CalendarView.vue"
Cohesion: 0.22
Nodes (6): bridgeError, grid, todayYmd, ui, weekdayLabels, {
  year,
  month,
  aggregate,
  isInitialLoading,
  error,
  isLoading,
  refresh
}

### Community 110 - "SettingsModal.vue"
Cohesion: 0.33
Nodes (5): { disconnecting, disconnectError, disconnect }, emit, open, {
  state,
  formSchema,
  apiKeyPlaceholder,
  hasStoredApiKey,
  testing,
  saving,
  testResult,
  testResultVisible,
  saveError,
  load,
  onTestConnection,
  onSave,
  reset
}, toast

## Ambiguous Edges - Review These
- `Renderer hardening (contextIsolation/nodeIntegration/sandbox)` → `CI quality job (lint/build/typecheck/test/knowledge validate)`  [AMBIGUOUS]
  .github/workflows/ci.yml · relation: conceptually_related_to

## Knowledge Gaps
- **470 isolated node(s):** `What We Were Working On`, `Tasks`, `Decisions Made`, `Uncommitted Changes`, `Next Steps` (+465 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Renderer hardening (contextIsolation/nodeIntegration/sandbox)` and `CI quality job (lint/build/typecheck/test/knowledge validate)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `electron` connect `Main Entry & Credentials` to `IPC Handlers & Bridge Types`, `Package Manifest`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `onlyBuiltDependencies` connect `Package Manifest` to `Main Entry & Credentials`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **What connects `What We Were Working On`, `Tasks`, `Decisions Made` to the rest of the system?**
  _470 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Work Package Picker` be split into smaller, more focused modules?**
  _Cohesion score 0.06688311688311688 - nodes in this community are weakly interconnected._
- **Should `App Shell & Calendar Header` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Test Connection & WP Fields` be split into smaller, more focused modules?**
  _Cohesion score 0.041666666666666664 - nodes in this community are weakly interconnected._